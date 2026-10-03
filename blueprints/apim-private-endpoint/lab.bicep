param labName string
param location string
param tags object
param sku string
param disablePublicAccess bool
param publisherEmail string
param publisherName string
param stage int

var apimName = '${labName}-apim'
var locked = disablePublicAccess && stage >= 4

// ---- Stage 1: network ---------------------------------------------------------------------------

module vnet 'br/public:avm/res/network/virtual-network:0.10.2' = {
  name: 'vnet'
  params: {
    name: '${labName}-vnet'
    location: location
    tags: tags
    enableTelemetry: false
    addressPrefixes: ['10.40.0.0/16']
    subnets: [
      { name: 'private-endpoints', addressPrefix: '10.40.1.0/24' }
      { name: 'clients', addressPrefix: '10.40.2.0/24' }
    ]
  }
}

// ---- Stage 2: API Management (public access must be enabled at creation) ------------------------
// Stage 4 re-applies the same service with public access disabled.

module apim 'br/public:avm/res/api-management/service:0.14.4' = if (stage >= 2) {
  name: 'apim'
  params: {
    name: apimName
    location: location
    tags: tags
    sku: sku
    skuCapacity: 1
    availabilityZones: []
    publisherEmail: publisherEmail
    publisherName: publisherName
    enableTelemetry: false
    publicNetworkAccess: locked ? 'Disabled' : 'Enabled'
    apis: [
      {
        name: 'httpbin'
        displayName: 'httpbin (sample)'
        path: 'httpbin'
        serviceUrl: 'https://httpbin.org'
        protocols: ['https']
        subscriptionRequired: false
        operations: [{ name: 'get', displayName: 'GET /get', method: 'GET', urlTemplate: '/get' }]
      }
    ]
  }
}

// ---- Stage 3: private endpoint + privatelink zone ----------------------------------------------

module zone 'br/public:avm/res/network/private-dns-zone:0.8.1' = if (stage >= 3) {
  name: 'pe-dns'
  params: {
    name: 'privatelink.azure-api.net'
    tags: tags
    enableTelemetry: false
    virtualNetworkLinks: [{ name: 'lab-vnet', virtualNetworkResourceId: vnet.outputs.resourceId, registrationEnabled: false }]
  }
}

module pe 'br/public:avm/res/network/private-endpoint:0.12.1' = if (stage >= 3) {
  name: 'pe'
  params: {
    name: '${apimName}-pe'
    location: location
    tags: tags
    enableTelemetry: false
    subnetResourceId: vnet.outputs.subnetResourceIds[0]
    privateLinkServiceConnections: [
      {
        name: 'gateway'
        properties: {
          privateLinkServiceId: resourceId('Microsoft.ApiManagement/service', apimName)
          groupIds: ['Gateway']
        }
      }
    ]
    privateDnsZoneGroup: {
      privateDnsZoneGroupConfigs: [{ name: 'azure-api', privateDnsZoneResourceId: zone!.outputs.resourceId }]
    }
  }
  dependsOn: [apim]
}

output apimName string = apimName
output privateFqdn string = '${apimName}.azure-api.net'
output privateEndpointName string = stage >= 3 ? '${apimName}-pe' : ''
output publicAccess string = locked ? 'Disabled' : 'Enabled'
