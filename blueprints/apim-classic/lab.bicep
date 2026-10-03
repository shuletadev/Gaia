param labName string
param location string
param tags object
param sku string
param units int
param networkMode string
param sampleApi bool
param secondRegion string
param publisherEmail string
param publisherName string
param stage int

var apimName = '${labName}-apim'
var injected = networkMode != 'None'

// stv2 VNet requirements: https://learn.microsoft.com/azure/api-management/virtual-network-reference
var inbound = concat(
  [
    { name: 'AllowApimManagement', properties: { priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'ApiManagement', sourcePortRange: '*', destinationAddressPrefix: 'VirtualNetwork', destinationPortRange: '3443' } }
    { name: 'AllowAzureLoadBalancer', properties: { priority: 110, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'AzureLoadBalancer', sourcePortRange: '*', destinationAddressPrefix: 'VirtualNetwork', destinationPortRange: '6390' } }
    { name: 'AllowVnetClients', properties: { priority: 130, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'VirtualNetwork', sourcePortRange: '*', destinationAddressPrefix: 'VirtualNetwork', destinationPortRanges: ['80', '443'] } }
  ],
  networkMode == 'External'
    ? [{ name: 'AllowInternetClients', properties: { priority: 120, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'Internet', sourcePortRange: '*', destinationAddressPrefix: 'VirtualNetwork', destinationPortRanges: ['80', '443'] } }]
    : []
)
var outbound = [
  { name: 'AllowStorage', properties: { priority: 100, direction: 'Outbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'VirtualNetwork', sourcePortRange: '*', destinationAddressPrefix: 'Storage', destinationPortRange: '443' } }
  { name: 'AllowSql', properties: { priority: 110, direction: 'Outbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'VirtualNetwork', sourcePortRange: '*', destinationAddressPrefix: 'Sql', destinationPortRange: '1433' } }
  { name: 'AllowKeyVault', properties: { priority: 120, direction: 'Outbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'VirtualNetwork', sourcePortRange: '*', destinationAddressPrefix: 'AzureKeyVault', destinationPortRange: '443' } }
  { name: 'AllowAzureMonitor', properties: { priority: 130, direction: 'Outbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'VirtualNetwork', sourcePortRange: '*', destinationAddressPrefix: 'AzureMonitor', destinationPortRanges: ['1886', '443'] } }
]

// ---- Stage 1: network (only for VNet modes) -----------------------------------------------------

module nsg 'br/public:avm/res/network/network-security-group:0.5.3' = if (injected) {
  name: 'apim-nsg'
  params: {
    name: '${labName}-apim-nsg'
    location: location
    tags: tags
    enableTelemetry: false
    securityRules: concat(inbound, outbound)
  }
}

module vnet 'br/public:avm/res/network/virtual-network:0.10.2' = if (injected) {
  name: 'vnet'
  params: {
    name: '${labName}-vnet'
    location: location
    tags: tags
    enableTelemetry: false
    addressPrefixes: ['10.30.0.0/16']
    subnets: [
      { name: 'apim', addressPrefix: '10.30.1.0/27', networkSecurityGroupResourceId: nsg!.outputs.resourceId }
      { name: 'clients', addressPrefix: '10.30.2.0/24' }
    ]
  }
}

module pip 'br/public:avm/res/network/public-ip-address:0.13.0' = if (injected) {
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

// ---- Stage 2: API Management ------------------------------------------------------------------

module apim 'br/public:avm/res/api-management/service:0.14.4' = if (stage >= 2) {
  name: 'apim'
  params: {
    name: apimName
    location: location
    tags: tags
    sku: sku
    skuCapacity: units
    availabilityZones: []
    publisherEmail: publisherEmail
    publisherName: publisherName
    enableTelemetry: false
    virtualNetworkType: networkMode
    subnetResourceId: injected ? vnet!.outputs.subnetResourceIds[0] : null
    publicIpAddressResourceId: injected ? pip!.outputs.resourceId : null
    additionalLocations: empty(secondRegion) ? [] : [{ location: secondRegion, sku: { name: sku, capacity: units }, availabilityZones: [] }]
    apis: sampleApi
      ? [
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
      : []
  }
}

output apimName string = apimName
output gatewayUrl string = 'https://${apimName}.azure-api.net'
output managementUrl string = 'https://${apimName}.management.azure-api.net'
output sampleRequest string = stage >= 2 && sampleApi && networkMode != 'Internal' ? 'curl https://${apimName}.azure-api.net/httpbin/get' : ''
output regions string = empty(secondRegion) ? location : '${location}, ${secondRegion}'
output privateIp string = stage >= 2 && injected ? (apimRef.properties.privateIPAddresses[?0] ?? '') : ''

resource apimRef 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: apimName
}
