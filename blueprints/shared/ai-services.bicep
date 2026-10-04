// An Azure AI services account (vision, language, document intelligence, translation in one resource).
// Pay per use: an idle account costs nothing. The name starts with the lab name so a destroy can purge it
// when it is soft-deleted (see purgeSoftDeleted in the engine).
param labName string
param location string
param tags object

resource ai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: '${labName}-ai'
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  properties: {
    // Required for token (Entra) authentication and Studio sign-in.
    customSubDomainName: '${labName}-ai'
    publicNetworkAccess: 'Enabled'
  }
}

output name string = ai.name
output endpoint string = ai.properties.endpoint
