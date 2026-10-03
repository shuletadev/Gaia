// API Management on a classic tier (Developer, Basic, Standard, Premium) — vanilla, optionally VNet-injected.
targetScope = 'subscription'

param labName string
param location string
param tags object

@allowed(['Developer', 'Basic', 'Standard', 'Premium'])
param sku string = 'Developer'

@minValue(1)
@maxValue(12)
param units int = 1

@allowed(['None', 'External', 'Internal'])
@description('VNet injection mode (External/Internal require Developer or Premium).')
param networkMode string = 'None'

param sampleApi bool = true

@description('Premium only: a second region (additional location) with the same units.')
param secondRegion string = ''
param publisherEmail string
param publisherName string = 'labctl'

@minValue(1)
@maxValue(2)
@description('labctl deploys 1 (network) then 2 (API Management) with readiness gates in between.')
param stage int = 2

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
    sku: sku
    units: units
    networkMode: networkMode
    sampleApi: sampleApi
    secondRegion: secondRegion
    publisherEmail: publisherEmail
    publisherName: publisherName
    stage: stage
  }
}

output apimName string = lab.outputs.apimName
output gatewayUrl string = lab.outputs.gatewayUrl
output managementUrl string = lab.outputs.managementUrl
output sampleRequest string = lab.outputs.sampleRequest
output privateIp string = lab.outputs.privateIp
output regions string = lab.outputs.regions
