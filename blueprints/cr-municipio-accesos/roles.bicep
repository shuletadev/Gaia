param storageAccount string
param container string
param auditorId string
param operatorId string
param technicianId string
param appPrincipalId string
param appHasAccess bool

// Built-in role definition IDs (the same in every tenant).
var reader = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
var contributor = 'b24988ac-6180-42a0-ab88-20f7382dd24c'
var blobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var blobDataReader = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccount
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: account
  name: 'default'
}

resource reports 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  parent: blobs
  name: container
}

// Scope 1, the whole resource group: the audit team can look at everything and change nothing.
resource auditRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, auditorId, reader)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', reader)
    principalId: auditorId
    principalType: 'ServicePrincipal'
    description: 'Auditoría: solo lectura en todo el grupo de recursos'
  }
}

// Scope 2, one resource: operations can manage the storage account (but cannot read its blobs through Entra, and cannot grant access).
resource operatorManage 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, operatorId, contributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributor)
    principalId: operatorId
    principalType: 'ServicePrincipal'
    description: 'Operaciones: administrar la cuenta de almacenamiento'
  }
}

// Scope 3, one container: the data team reads and writes the reports and nothing else (a data-plane role).
resource technicianData 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: reports
  name: guid(reports.id, technicianId, blobDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributor)
    principalId: technicianId
    principalType: 'ServicePrincipal'
    description: 'Datos: leer y escribir informes en este contenedor'
  }
}

// The web app's own identity may read the reports. The class removes this and watches the page fail, then adds it back.
resource appRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (appHasAccess) {
  scope: reports
  name: guid(reports.id, appPrincipalId, blobDataReader)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataReader)
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    description: 'Aplicación web: leer informes con su identidad administrada'
  }
}
