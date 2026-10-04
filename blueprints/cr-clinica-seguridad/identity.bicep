param labName string
param location string
param tags object
param vaultName string

// Built-in role "Key Vault Secrets User": can read secret values, cannot change anything.
var secretsUserRole = '4633458b-17de-408a-b874-0445c86b69e6'

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: vaultName
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${labName}-app-id'
  location: location
  tags: tags
}

resource grant 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, secretsUserRole)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsUserRole)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output name string = identity.name
