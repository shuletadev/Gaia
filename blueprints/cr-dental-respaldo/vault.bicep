param labName string
param location string
param tags object
param vaultRedundancy string
param protectVm bool
param retentionDays int
param vmId string
param vmName string

// Recovery Services vault: backs up VMs, file shares and databases, and also holds Site Recovery.
resource vault 'Microsoft.RecoveryServices/vaults@2024-10-01' = {
  name: '${labName}-vault'
  location: location
  tags: tags
  sku: { name: 'RS0', tier: 'Standard' }
  properties: { publicNetworkAccess: 'Enabled' }
}

// The redundancy choice must be made before anything is protected.
resource storageConfig 'Microsoft.RecoveryServices/vaults/backupstorageconfig@2024-10-01' = {
  parent: vault
  name: 'vaultstorageconfig'
  properties: { storageModelType: vaultRedundancy, crossRegionRestoreFlag: false }
}

// One daily restore point at 02:00 UTC (8:00 p. m. in Costa Rica), kept for the chosen number of days.
resource policy 'Microsoft.RecoveryServices/vaults/backupPolicies@2024-10-01' = {
  parent: vault
  name: 'diaria'
  properties: {
    backupManagementType: 'AzureIaasVM'
    instantRpRetentionRangeInDays: 2
    schedulePolicy: {
      schedulePolicyType: 'SimpleSchedulePolicy'
      scheduleRunFrequency: 'Daily'
      scheduleRunTimes: ['2025-01-01T02:00:00Z']
    }
    retentionPolicy: {
      retentionPolicyType: 'LongTermRetentionPolicy'
      dailySchedule: {
        retentionTimes: ['2025-01-01T02:00:00Z']
        retentionDuration: { count: retentionDays, durationType: 'Days' }
      }
    }
    timeZone: 'UTC'
  }
}

var containerName = 'iaasvmcontainer;iaasvmcontainerv2;${resourceGroup().name};${vmName}'
var itemName = 'vm;iaasvmcontainerv2;${resourceGroup().name};${vmName}'

resource protectedVm 'Microsoft.RecoveryServices/vaults/backupFabrics/protectionContainers/protectedItems@2024-10-01' = if (protectVm) {
  name: '${vault.name}/Azure/${containerName}/${itemName}'
  dependsOn: [storageConfig]
  properties: {
    protectedItemType: 'Microsoft.Compute/virtualMachines'
    policyId: policy.id
    sourceResourceId: vmId
  }
}

// A Backup vault (the newer kind) for the workloads the Recovery Services vault does not handle: blobs, disks, databases.
// It starts empty; the class compares the two kinds side by side.
resource backupVault 'Microsoft.DataProtection/backupVaults@2024-04-01' = {
  name: '${labName}-bvault'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    storageSettings: [{ datastoreType: 'VaultStore', type: vaultRedundancy == 'GeoRedundant' ? 'GeoRedundant' : 'LocallyRedundant' }]
  }
}

output id string = vault.id
output name string = vault.name
output backupVaultName string = backupVault.name
