param labName string
param location string
param tags object
param auditLogs bool
param workspaceId string

// The name starts with the lab name so a destroy can purge the soft-deleted vault and free the name.
// Purge protection stays off on purpose: a classroom lab must be fully removable.
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${labName}-kv'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    // Access is granted with Azure roles (RBAC), not with per-vault access policies.
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

// A made-up connection string: the point is where a secret lives, not what it says.
resource secret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'cadena-conexion-pacientes'
  properties: { value: 'Server=clinica.example;Database=pacientes;User=app;Password=EJEMPLO-no-es-real' }
}

resource audit 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (auditLogs) {
  name: 'auditoria'
  scope: vault
  properties: {
    workspaceId: workspaceId
    logs: [{ categoryGroup: 'audit', enabled: true }]
  }
}

output name string = vault.name
output uri string = vault.properties.vaultUri
