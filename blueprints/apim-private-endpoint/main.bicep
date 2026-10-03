// API Management reached privately through an inbound Private Endpoint (privatelink.azure-api.net).
targetScope = 'subscription'

param labName string
param location string
param tags object

@allowed(['Developer', 'Basic', 'Standard', 'Premium'])
param sku string = 'Developer'

@description('Turn off the public gateway once the private endpoint is up (must be enabled while the service is created).')
param disablePublicAccess bool = true

param publisherEmail string
param publisherName string = 'labctl'

@minValue(1)
@maxValue(4)
@description('labctl deploys 1 (network), 2 (API Management), 3 (private endpoint + DNS), 4 (disable public access).')
param stage int = 4

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
    disablePublicAccess: disablePublicAccess
    publisherEmail: publisherEmail
    publisherName: publisherName
    stage: stage
  }
}

output apimName string = lab.outputs.apimName
output privateEndpointName string = lab.outputs.privateEndpointName
output privateFqdn string = lab.outputs.privateFqdn
output publicAccess string = lab.outputs.publicAccess
