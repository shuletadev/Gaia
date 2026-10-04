param labName string
param location string
param tags object

// One storage account per department, each tagged with its cost center so Cost Analysis can group by tag.
var departments = [
  { key: 'cont', centroCosto: 'contabilidad' }
  { key: 'cred', centroCosto: 'creditos' }
  { key: 'aho', centroCosto: 'ahorros' }
]

resource accounts 'Microsoft.Storage/storageAccounts@2023-05-01' = [for d in departments: {
  name: take('${replace(labName, '-', '')}${d.key}${uniqueString(resourceGroup().id)}', 24)
  location: location
  tags: union(tags, { centroCosto: d.centroCosto })
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}]

// The accounting books must not be deleted by accident. A lab destroy removes the lock first.
resource lock 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'no-borrar-libros-contables'
  scope: accounts[0]
  properties: {
    level: 'CanNotDelete'
    notes: 'Libros contables de la cooperativa: no se pueden borrar mientras exista este candado.'
  }
}

output lockedAccount string = accounts[0].name
