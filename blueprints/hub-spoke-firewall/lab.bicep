param labName string
param location string
param tags object
param spokeCount int

@description('labctl deploys 1 (hub + policy), 2 (firewall), 3 (routes + spokes) with readiness gates in between.')
param stage int = 3

var hubName = '${labName}-hub'
var fwName = '${labName}-fw'

module hub 'br/public:avm/res/network/virtual-network:0.10.2' = {
  name: 'hub'
  params: {
    name: hubName
    location: location
    tags: tags
    enableTelemetry: false
    addressPrefixes: ['10.0.0.0/16']
    subnets: [
      { name: 'AzureFirewallSubnet', addressPrefix: '10.0.1.0/26' }
      // Basic tier always needs a management NIC in its own subnet.
      { name: 'AzureFirewallManagementSubnet', addressPrefix: '10.0.1.64/26' }
    ]
  }
}

module policy 'br/public:avm/res/network/firewall-policy:0.3.6' = {
  name: 'fw-policy'
  params: {
    name: '${fwName}-policy'
    location: location
    tags: tags
    enableTelemetry: false
    tier: 'Basic'
    // Basic supports threat intelligence in Alert mode only.
    threatIntelMode: 'Alert'
    ruleCollectionGroups: [
      {
        name: 'lab-rules'
        priority: 200
        ruleCollections: [
          {
            name: 'allow-east-west'
            priority: 100
            ruleCollectionType: 'FirewallPolicyFilterRuleCollection'
            action: { type: 'Allow' }
            rules: [
              {
                name: 'spokes-to-spokes'
                ruleType: 'NetworkRule'
                ipProtocols: ['Any']
                sourceAddresses: ['10.0.0.0/8']
                destinationAddresses: ['10.0.0.0/8']
                destinationPorts: ['*']
              }
            ]
          }
          {
            name: 'allow-web-egress'
            priority: 200
            ruleCollectionType: 'FirewallPolicyFilterRuleCollection'
            action: { type: 'Allow' }
            rules: [
              {
                name: 'microsoft-and-tools'
                ruleType: 'ApplicationRule'
                sourceAddresses: ['10.0.0.0/8']
                protocols: [
                  { protocolType: 'Http', port: 80 }
                  { protocolType: 'Https', port: 443 }
                ]
                targetFqdns: ['*.microsoft.com', '*.azure.com', '*.windows.net', '*.ubuntu.com', 'ifconfig.me', 'httpbin.org']
              }
            ]
          }
        ]
      }
    ]
  }
}

module firewall 'br/public:avm/res/network/azure-firewall:0.11.1' = if (stage >= 2) {
  name: 'firewall'
  params: {
    name: fwName
    location: location
    tags: tags
    enableTelemetry: false
    azureSkuTier: 'Basic'
    threatIntelMode: 'Alert'
    availabilityZones: []
    virtualNetworkResourceId: hub.outputs.resourceId
    firewallPolicyId: policy.outputs.resourceId
    publicIPAddressObject: { name: '${fwName}-pip', availabilityZones: [], tags: tags }
    managementIPAddressObject: { name: '${fwName}-mgmt-pip', availabilityZones: [], tags: tags }
  }
}

module routes 'br/public:avm/res/network/route-table:0.5.0' = if (stage >= 3) {
  name: 'spoke-routes'
  params: {
    name: '${labName}-spoke-rt'
    location: location
    tags: tags
    enableTelemetry: false
    disableBgpRoutePropagation: true
    routes: [
      {
        name: 'default-via-firewall'
        properties: {
          addressPrefix: '0.0.0.0/0'
          nextHopType: 'VirtualAppliance'
          nextHopIpAddress: firewall!.outputs.privateIp
        }
      }
    ]
  }
}

module workloadNsg 'br/public:avm/res/network/network-security-group:0.5.3' = {
  name: 'workload-nsg'
  params: {
    name: '${labName}-workload-nsg'
    location: location
    tags: tags
    enableTelemetry: false
  }
}

module spokes 'br/public:avm/res/network/virtual-network:0.10.2' = [
  for i in range(1, spokeCount): if (stage >= 3) {
    name: 'spoke-${i}'
    params: {
      name: '${labName}-spoke${i}'
      location: location
      tags: tags
      enableTelemetry: false
      addressPrefixes: ['10.${i}.0.0/16']
      subnets: [
        {
          name: 'workload'
          addressPrefix: '10.${i}.1.0/24'
          routeTableResourceId: routes!.outputs.resourceId
          networkSecurityGroupResourceId: workloadNsg.outputs.resourceId
        }
      ]
      peerings: [
        {
          name: 'to-hub'
          remoteVirtualNetworkResourceId: hub.outputs.resourceId
          allowForwardedTraffic: true
          allowVirtualNetworkAccess: true
          remotePeeringEnabled: true
          remotePeeringName: 'to-spoke${i}'
          remotePeeringAllowForwardedTraffic: true
          remotePeeringAllowVirtualNetworkAccess: true
        }
      ]
    }
  }
]

output firewallPrivateIp string = stage >= 2 ? firewall!.outputs.privateIp : ''
output hubVnet string = hub.outputs.name
var spokeNames = [for i in range(1, spokeCount): '${labName}-spoke${i}']
output spokeVnets array = stage >= 3 ? spokeNames : []
