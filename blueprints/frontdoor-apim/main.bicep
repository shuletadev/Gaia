// Azure Front Door (Standard/Premium) in front of an API Management v2 gateway.
targetScope = 'subscription'

param labName string
param location string
param tags object

@allowed(['BasicV2', 'StandardV2'])
param apimSku string = 'BasicV2'

@allowed(['Standard_AzureFrontDoor', 'Premium_AzureFrontDoor'])
param frontDoorSku string = 'Standard_AzureFrontDoor'

@description('Reject calls that do not come through this Front Door profile (X-Azure-FDID check).')
param lockToFrontDoor bool = true

param publisherEmail string
param publisherName string = 'labctl'

@minValue(1)
@maxValue(2)
@description('labctl deploys 1 (API Management), then 2 (Front Door + origin lock).')
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
    apimSku: apimSku
    frontDoorSku: frontDoorSku
    lockToFrontDoor: lockToFrontDoor
    publisherEmail: publisherEmail
    publisherName: publisherName
    stage: stage
  }
}

output apimName string = lab.outputs.apimName
output gatewayUrl string = lab.outputs.gatewayUrl
output frontDoorUrl string = lab.outputs.frontDoorUrl
output sampleRequest string = lab.outputs.sampleRequest
