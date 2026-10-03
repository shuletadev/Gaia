// API Management Premium with a workspace, an API in it, and a dedicated workspace gateway.
targetScope = 'subscription'

param labName string
param location string
param tags object

@allowed(['WorkspaceGatewayStandard', 'WorkspaceGatewayPremium'])
param gatewaySku string = 'WorkspaceGatewayStandard'

param publisherEmail string
param publisherName string = 'labctl'

@minValue(1)
@maxValue(2)
@description('labctl deploys 1 (API Management Premium), then 2 (workspace, API, workspace gateway).')
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
    gatewaySku: gatewaySku
    publisherEmail: publisherEmail
    publisherName: publisherName
    stage: stage
  }
}

output apimName string = lab.outputs.apimName
output workspace string = lab.outputs.workspace
output workspaceGatewayName string = lab.outputs.workspaceGatewayName
output workspaceGatewayUrl string = lab.outputs.workspaceGatewayUrl
output sampleRequest string = lab.outputs.sampleRequest
