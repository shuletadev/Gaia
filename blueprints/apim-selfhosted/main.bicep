// API Management self-hosted gateway (v2 container) running in Azure Container Instances.
targetScope = 'subscription'

param labName string
param location string
param tags object

@allowed(['Developer', 'Premium'])
param sku string = 'Developer'

param publisherEmail string
param publisherName string = 'labctl'

@secure()
@description('Gateway auth value ("GatewayKey <token>"); labctl generates it through ARM after stage 1.')
param gatewayToken string = ''

@secure()
@description('Gateway VM admin password; labctl generates it (no SSH port is opened).')
param adminPassword string = ''

@allowed(['vm', 'containerapps'])
@description('Where the gateway container runs.')
param gatewayHost string = 'vm'

@minValue(1)
@maxValue(2)
@description('labctl deploys 1 (API Management + gateway resource), then 2 (gateway container).')
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
    publisherEmail: publisherEmail
    publisherName: publisherName
    gatewayToken: gatewayToken
    adminPassword: adminPassword
    gatewayHost: gatewayHost
    stage: stage
  }
}

output apimName string = lab.outputs.apimName
output gatewayName string = lab.outputs.gatewayName
output gatewayUrl string = lab.outputs.gatewayUrl
output selfHostedUrl string = lab.outputs.selfHostedUrl
output sampleRequest string = lab.outputs.sampleRequest
