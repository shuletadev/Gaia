// API Management (Developer, internal VNet mode) published through Application Gateway WAF_v2.
// Classic reference architecture; APIM VNet injection takes 30–60 minutes.
targetScope = 'subscription'

param labName string
param location string
param tags object

param publisherEmail string
param publisherName string = 'labctl'

@allowed(['Detection', 'Prevention'])
param wafMode string = 'Prevention'

@minValue(1)
@maxValue(3)
@description('labctl deploys 1 (network), 2 (API Management), 3 (DNS + App Gateway) with readiness gates in between.')
param stage int = 3

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: labName
  location: location
  tags: tags
}

module lab 'lab.bicep' = {
  scope: rg
  name: 'lab'
  params: {
    labName: labName
    location: location
    tags: tags
    publisherEmail: publisherEmail
    publisherName: publisherName
    wafMode: wafMode
    stage: stage
  }
}

output appGatewayPublicIp string = lab.outputs.appGatewayPublicIp
output apimName string = lab.outputs.apimName
output apimPrivateIp string = lab.outputs.apimPrivateIp
output sampleRequest string = lab.outputs.sampleRequest
output healthCheck string = lab.outputs.healthCheck
