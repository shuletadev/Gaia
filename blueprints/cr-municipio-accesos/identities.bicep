param labName string
param location string
param tags object

// Stand-ins for three people or teams, so the class can assign roles without creating users in the directory
// (users and groups live in the tenant, not in the subscription). A managed identity is a principal like any other.
resource auditor 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${labName}-auditoria'
  location: location
  tags: tags
}

resource operator 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${labName}-operaciones'
  location: location
  tags: tags
}

resource technician 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${labName}-datos'
  location: location
  tags: tags
}

output auditorId string = auditor.properties.principalId
output operatorId string = operator.properties.principalId
output technicianId string = technician.properties.principalId
