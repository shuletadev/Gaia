param labName string
param location string
param tags object
param gatewaySku string
param publisherEmail string
param publisherName string
param stage int

var apimName = '${labName}-apim'
var workspaceName = 'team-a'
var gatewayName = '${labName}-wsgw'

// ---- Stage 1: API Management Premium ------------------------------------------------------------

module apim 'br/public:avm/res/api-management/service:0.14.4' = {
  name: 'apim'
  params: {
    name: apimName
    location: location
    tags: tags
    sku: 'Premium'
    skuCapacity: 1
    availabilityZones: []
    publisherEmail: publisherEmail
    publisherName: publisherName
    enableTelemetry: false
  }
}

resource apimRef 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: apimName
}

// ---- Stage 2: workspace, its API and a workspace gateway ----------------------------------------

resource workspace 'Microsoft.ApiManagement/service/workspaces@2024-05-01' = if (stage >= 2) {
  parent: apimRef
  name: workspaceName
  properties: { displayName: 'Team A', description: 'labctl workspace' }
  dependsOn: [apim]
}

resource api 'Microsoft.ApiManagement/service/workspaces/apis@2024-05-01' = if (stage >= 2) {
  parent: workspace
  name: 'httpbin'
  properties: {
    displayName: 'httpbin (workspace)'
    path: 'httpbin'
    serviceUrl: 'https://httpbin.org'
    protocols: ['https']
    subscriptionRequired: false
  }
}

resource op 'Microsoft.ApiManagement/service/workspaces/apis/operations@2024-05-01' = if (stage >= 2) {
  parent: api
  name: 'get'
  properties: { displayName: 'GET /get', method: 'GET', urlTemplate: '/get' }
}

resource gateway 'Microsoft.ApiManagement/gateways@2024-05-01' = if (stage >= 2) {
  name: gatewayName
  location: location
  tags: tags
  sku: { name: gatewaySku, capacity: 1 }
  properties: { backend: {}, virtualNetworkType: 'None' }
}

resource connection 'Microsoft.ApiManagement/gateways/configConnections@2024-06-01-preview' = if (stage >= 2) {
  parent: gateway
  name: 'team-a'
  properties: { sourceId: workspace.id }
}

output apimName string = apimName
output workspace string = workspaceName
output workspaceGatewayName string = stage >= 2 ? gatewayName : ''
output workspaceGatewayUrl string = stage >= 2 ? 'https://${connection!.properties.defaultHostname}' : ''
output sampleRequest string = stage >= 2 ? 'curl https://${connection!.properties.defaultHostname}/httpbin/get' : ''
