param labName string
param allowedLocations array
param requireTag bool
param restrictStorage bool
param enforce bool

var mode = enforce ? 'Default' : 'DoNotEnforce'

// Built-in definitions (IDs are the same in every tenant).
var locationsId = tenantResourceId('Microsoft.Authorization/policyDefinitions', 'e56962a6-4747-49cd-b67b-bf8b01975c4c')
var requireTagId = tenantResourceId('Microsoft.Authorization/policyDefinitions', '871b6d14-10aa-478d-b590-94f262ecfa99')
var storageSkuId = tenantResourceId('Microsoft.Authorization/policyDefinitions', '7433c107-6db4-4ad1-b57a-a76dce0154a1')

resource locations 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: '${labName}-regiones'
  properties: {
    displayName: 'Cooperativa: regiones permitidas'
    description: 'Solo se pueden crear recursos en las regiones aprobadas.'
    policyDefinitionId: locationsId
    enforcementMode: mode
    parameters: {
      listOfAllowedLocations: { value: allowedLocations }
      effect: { value: 'Deny' }
    }
  }
}

resource tagRule 'Microsoft.Authorization/policyAssignments@2024-04-01' = if (requireTag) {
  name: '${labName}-etiqueta'
  properties: {
    displayName: 'Cooperativa: todo recurso lleva centroCosto'
    description: 'Sin la etiqueta centroCosto no se puede asignar el gasto a un departamento.'
    policyDefinitionId: requireTagId
    enforcementMode: mode
    parameters: {
      tagName: { value: 'centroCosto' }
    }
  }
}

resource storageSku 'Microsoft.Authorization/policyAssignments@2024-04-01' = if (restrictStorage) {
  name: '${labName}-almacenamiento'
  properties: {
    displayName: 'Cooperativa: almacenamiento solo Standard_LRS'
    description: 'Las cuentas de almacenamiento premium o con replicación geográfica no están aprobadas.'
    policyDefinitionId: storageSkuId
    enforcementMode: mode
    parameters: {
      listOfAllowedSKUs: { value: ['Standard_LRS'] }
      effect: { value: 'Deny' }
    }
  }
}

output count int = 1 + (requireTag ? 1 : 0) + (restrictStorage ? 1 : 0)
