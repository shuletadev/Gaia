param labName string
param location string
param tags object
param apimSku string
param frontDoorSku string
param lockToFrontDoor bool
param publisherEmail string
param publisherName string
param stage int

var apimName = '${labName}-apim'
var apimHost = '${apimName}.azure-api.net'

// ---- Stage 1: API Management v2 -----------------------------------------------------------------

module apim 'br/public:avm/res/api-management/service:0.14.4' = {
  name: 'apim'
  params: {
    name: apimName
    location: location
    tags: tags
    sku: apimSku
    skuCapacity: 1
    availabilityZones: []
    publisherEmail: publisherEmail
    publisherName: publisherName
    enableTelemetry: false
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

// ---- Stage 2: Front Door ------------------------------------------------------------------------

resource afd 'Microsoft.Cdn/profiles@2024-02-01' = if (stage >= 2) {
  name: '${labName}-afd'
  location: 'global'
  tags: tags
  sku: { name: frontDoorSku }
  properties: { originResponseTimeoutSeconds: 60 }
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = if (stage >= 2) {
  parent: afd
  name: labName
  location: 'global'
  tags: tags
  properties: { enabledState: 'Enabled' }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = if (stage >= 2) {
  parent: afd
  name: 'apim'
  properties: {
    loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3, additionalLatencyInMilliseconds: 50 }
    healthProbeSettings: {
      probePath: '/status-0123456789abcdef'
      probeRequestType: 'GET'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 100
    }
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = if (stage >= 2) {
  parent: originGroup
  name: 'apim-gateway'
  properties: {
    hostName: apimHost
    originHostHeader: apimHost
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
  dependsOn: [apim]
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = if (stage >= 2) {
  parent: endpoint
  name: 'all'
  properties: {
    originGroup: { id: originGroup.id }
    supportedProtocols: ['Https']
    patternsToMatch: ['/*']
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Disabled'
    enabledState: 'Enabled'
  }
  dependsOn: [origin]
}

resource apimRef 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: apimName
}

// Global policy: only accept traffic stamped with this profile's Front Door ID.
resource fdidPolicy 'Microsoft.ApiManagement/service/policies@2024-05-01' = if (stage >= 2 && lockToFrontDoor) {
  parent: apimRef
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: '<policies><inbound><check-header name="X-Azure-FDID" failed-check-httpcode="403" failed-check-error-message="Use Front Door" ignore-case="true"><value>${afd!.properties.frontDoorId}</value></check-header></inbound><backend><forward-request /></backend><outbound /><on-error /></policies>'
  }
  dependsOn: [apim]
}

output apimName string = apimName
output gatewayUrl string = 'https://${apimHost}'
output frontDoorUrl string = stage >= 2 ? 'https://${endpoint!.properties.hostName}' : ''
output sampleRequest string = stage >= 2 ? 'curl https://${endpoint!.properties.hostName}/httpbin/get' : 'curl https://${apimHost}/httpbin/get'
