// Azure DNS Private Resolver for hybrid DNS: inbound endpoint (on-prem -> Azure), outbound endpoint
// with a forwarding ruleset (Azure -> on-prem), a private zone and a spoke that uses the resolver.
targetScope = 'subscription'

param labName string
param location string
param tags object

@description('Add a peered spoke VNet whose DNS server is the inbound endpoint, linked to the forwarding ruleset.')
param spoke bool = true

@minValue(1)
@maxValue(2)
@description('labctl deploys 1 (networks + private zone), then 2 (resolver, endpoints, ruleset).')
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
    spoke: spoke
    stage: stage
  }
}

output resolverName string = lab.outputs.resolverName
output inboundIp string = lab.outputs.inboundIp
output onPremForwarders string = lab.outputs.onPremForwarders
output forwardingRule string = lab.outputs.forwardingRule
