param accountName string

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: accountName
}

// Collections and contracts move to Cool after 30 days and to Archive after 180. The rule runs daily, so in class
// students read it and edit it rather than waiting for it.
resource policy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'documentos-antiguos'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['documentos/'] }
            actions: {
              baseBlob: {
                tierToCool: { daysAfterModificationGreaterThan: 30 }
                tierToArchive: { daysAfterModificationGreaterThan: 180 }
              }
            }
          }
        }
      ]
    }
  }
}
