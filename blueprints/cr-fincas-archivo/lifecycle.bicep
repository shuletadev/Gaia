param accountName string
param lifecycleDays int

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: accountName
}

// Photos move to Cool, then Archive, then are deleted. The rule runs on a daily schedule, so in class
// students read the rule instead of waiting for it.
resource policy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'fotos-antiguas'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['fincas/'] }
            actions: {
              baseBlob: {
                tierToCool: { daysAfterModificationGreaterThan: lifecycleDays }
                tierToArchive: { daysAfterModificationGreaterThan: lifecycleDays * 3 }
                delete: { daysAfterModificationGreaterThan: lifecycleDays * 12 }
              }
            }
          }
        }
      ]
    }
  }
}
