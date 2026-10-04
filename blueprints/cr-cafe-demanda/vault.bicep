param labName string
param location string
param tags object

// Machine Learning keeps the workspace's secrets here and adds its own access policy. Purge protection stays off
// so a classroom lab can be removed completely.
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${labName}-kv'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    accessPolicies: []
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

output name string = vault.name
