param labName string
param location string
param tags object
param publisherEmail string
param publisherName string
param wafMode string

@description('Deploy stages up to and including this one (labctl deploys 1, 2, 3 with readiness gates in between).')
param stage int = 3

var apimName = '${labName}-apim'
var agwName = '${labName}-agw'
var appGwSubnetPrefix = '10.20.1.0/24'
var agwId = resourceId('Microsoft.Network/applicationGateways', agwName)

// ---- Network -------------------------------------------------------------------------------------

// Rules API Management (stv2) needs in a VNet: https://learn.microsoft.com/azure/api-management/api-management-using-with-internal-vnet
module apimNsg 'br/public:avm/res/network/network-security-group:0.5.3' = {
  name: 'apim-nsg'
  params: {
    name: '${labName}-apim-nsg'
    location: location
    tags: tags
    enableTelemetry: false
    securityRules: [
      {
        name: 'AllowApimManagement'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'ApiManagement'
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRange: '3443'
        }
      }
      {
        name: 'AllowAzureLoadBalancer'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'AzureLoadBalancer'
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRange: '6390'
        }
      }
      {
        name: 'AllowAppGatewayToGateway'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: appGwSubnetPrefix
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRange: '443'
        }
      }
      {
        name: 'AllowVnetClients'
        properties: {
          priority: 130
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRanges: ['80', '443']
        }
      }
      {
        name: 'AllowStorage'
        properties: {
          priority: 100
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: 'Storage'
          destinationPortRange: '443'
        }
      }
      {
        name: 'AllowSql'
        properties: {
          priority: 110
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: 'Sql'
          destinationPortRange: '1433'
        }
      }
      {
        name: 'AllowKeyVault'
        properties: {
          priority: 120
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: 'AzureKeyVault'
          destinationPortRange: '443'
        }
      }
      {
        name: 'AllowAzureMonitor'
        properties: {
          priority: 130
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: 'AzureMonitor'
          destinationPortRanges: ['1886', '443']
        }
      }
    ]
  }
}

module vnet 'br/public:avm/res/network/virtual-network:0.10.2' = {
  name: 'vnet'
  params: {
    name: '${labName}-vnet'
    location: location
    tags: tags
    enableTelemetry: false
    addressPrefixes: ['10.20.0.0/16']
    subnets: [
      { name: 'appgw', addressPrefix: appGwSubnetPrefix }
      { name: 'apim', addressPrefix: '10.20.2.0/27', networkSecurityGroupResourceId: apimNsg.outputs.resourceId }
    ]
  }
}

// stv2 in a VNet uses a customer-owned Standard IP with a DNS label for management and outbound traffic.
module apimPip 'br/public:avm/res/network/public-ip-address:0.13.0' = {
  name: 'apim-pip'
  params: {
    name: '${apimName}-pip'
    location: location
    tags: tags
    enableTelemetry: false
    availabilityZones: []
    dnsSettings: { domainNameLabel: toLower(apimName) }
  }
}

module agwPip 'br/public:avm/res/network/public-ip-address:0.13.0' = {
  name: 'agw-pip'
  params: {
    name: '${agwName}-pip'
    location: location
    tags: tags
    enableTelemetry: false
    availabilityZones: []
  }
}

// ---- API Management ------------------------------------------------------------------------------

module apim 'br/public:avm/res/api-management/service:0.14.4' = if (stage >= 2) {
  name: 'apim'
  params: {
    name: apimName
    location: location
    tags: tags
    sku: 'Developer'
    skuCapacity: 1
    availabilityZones: []
    publisherEmail: publisherEmail
    publisherName: publisherName
    enableTelemetry: false
    virtualNetworkType: 'Internal'
    subnetResourceId: vnet.outputs.subnetResourceIds[1]
    publicIpAddressResourceId: apimPip.outputs.resourceId
    apis: [
      {
        name: 'httpbin'
        displayName: 'httpbin (sample)'
        path: 'httpbin'
        serviceUrl: 'https://httpbin.org'
        protocols: ['https']
        subscriptionRequired: false
        operations: [
          { name: 'get', displayName: 'GET /get', method: 'GET', urlTemplate: '/get' }
          { name: 'headers', displayName: 'GET /headers', method: 'GET', urlTemplate: '/headers' }
        ]
      }
    ]
  }
}

// Internal mode publishes no public DNS, so the VNet resolves *.azure-api.net through a private zone.
// The module looks up APIM's private IP itself: a reference in this template would be resolved when this
// deployment starts (before APIM exists); inside the module it resolves after dependsOn: [apim].
module dns '../shared/apim-dns.bicep' = if (stage >= 3) {
  name: 'apim-dns'
  dependsOn: [apim]
  params: {
    apimName: apimName
    vnetId: vnet.outputs.resourceId
    tags: tags
  }
}

// ---- Application Gateway -------------------------------------------------------------------------

module waf 'br/public:avm/res/network/application-gateway-web-application-firewall-policy:0.3.0' = {
  name: 'waf'
  params: {
    name: '${agwName}-waf'
    location: location
    tags: tags
    enableTelemetry: false
    policySettings: {
      state: 'Enabled'
      mode: wafMode
      requestBodyCheck: true
    }
    managedRules: {
      managedRuleSets: [
        { ruleSetType: 'Microsoft_DefaultRuleSet', ruleSetVersion: '2.1' }
      ]
    }
  }
}

module agw 'br/public:avm/res/network/application-gateway:0.10.0' = if (stage >= 3) {
  name: 'agw'
  dependsOn: [dns]
  params: {
    name: agwName
    location: location
    tags: tags
    enableTelemetry: false
    sku: 'WAF_v2'
    availabilityZones: []
    autoscaleMinCapacity: 0
    autoscaleMaxCapacity: 2
    firewallPolicyResourceId: waf.outputs.resourceId
    gatewayIPConfigurations: [
      { name: 'gateway', properties: { subnet: { id: vnet.outputs.subnetResourceIds[0] } } }
    ]
    frontendIPConfigurations: [
      { name: 'public', properties: { publicIPAddress: { id: agwPip.outputs.resourceId } } }
    ]
    frontendPorts: [
      { name: 'http', properties: { port: 80 } }
    ]
    backendAddressPools: [
      { name: 'apim', properties: { backendAddresses: [{ fqdn: '${apimName}.azure-api.net' }] } }
    ]
    probes: [
      {
        name: 'apim-status'
        properties: {
          protocol: 'Https'
          path: '/status-0123456789abcdef'
          interval: 30
          timeout: 30
          unhealthyThreshold: 3
          pickHostNameFromBackendHttpSettings: true
          match: { statusCodes: ['200-399'] }
        }
      }
    ]
    backendHttpSettingsCollection: [
      {
        name: 'apim-https'
        properties: {
          port: 443
          protocol: 'Https'
          cookieBasedAffinity: 'Disabled'
          // The gateway presents the public *.azure-api.net certificate, so the default trusted roots are enough.
          pickHostNameFromBackendAddress: true
          requestTimeout: 60
          probe: { id: '${agwId}/probes/apim-status' }
        }
      }
    ]
    httpListeners: [
      {
        name: 'http'
        properties: {
          frontendIPConfiguration: { id: '${agwId}/frontendIPConfigurations/public' }
          frontendPort: { id: '${agwId}/frontendPorts/http' }
          protocol: 'Http'
        }
      }
    ]
    requestRoutingRules: [
      {
        name: 'to-apim'
        properties: {
          ruleType: 'Basic'
          priority: 100
          httpListener: { id: '${agwId}/httpListeners/http' }
          backendAddressPool: { id: '${agwId}/backendAddressPools/apim' }
          backendHttpSettings: { id: '${agwId}/backendHttpSettingsCollection/apim-https' }
        }
      }
    ]
  }
}

output apimName string = apimName
output apimPrivateIp string = stage >= 3 ? dns!.outputs.privateIp : ''
output appGatewayPublicIp string = agwPip.outputs.ipAddress
output sampleRequest string = stage >= 3 ? 'curl http://${agwPip.outputs.ipAddress}/httpbin/get' : ''
output healthCheck string = stage >= 3 ? 'curl http://${agwPip.outputs.ipAddress}/status-0123456789abcdef' : ''
