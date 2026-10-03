param labName string
param location string
param tags object
param sku string
param publisherEmail string
param publisherName string

var apimName = '${labName}-apim'

module apim 'br/public:avm/res/api-management/service:0.14.4' = {
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
          { name: 'post', displayName: 'POST /post', method: 'POST', urlTemplate: '/post' }
          { name: 'headers', displayName: 'GET /headers', method: 'GET', urlTemplate: '/headers' }
        ]
      }
    ]
  }
}

output apimName string = apim.outputs.name
output gatewayUrl string = 'https://${apimName}.azure-api.net'
output sampleRequest string = 'curl https://${apimName}.azure-api.net/httpbin/get'
