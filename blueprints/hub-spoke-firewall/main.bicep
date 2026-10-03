// Hub-spoke with Azure Firewall Basic: spokes route 0.0.0.0/0 through the hub firewall.
targetScope = 'subscription'

param labName string
param location string
param tags object

@minValue(1)
@maxValue(3)
@description('Number of spoke VNets (10.1.0.0/16, 10.2.0.0/16, …).')
param spokeCount int = 1

@minValue(1)
@maxValue(3)
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
    spokeCount: spokeCount
    stage: stage
  }
}

output firewallPrivateIp string = lab.outputs.firewallPrivateIp
output hubVnet string = lab.outputs.hubVnet
output spokeVnets array = lab.outputs.spokeVnets
