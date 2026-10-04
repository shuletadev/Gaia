param labName string
param location string
param tags object
param vmSize string
param adminUsername string = 'tallerAdmin'
@secure()
param adminPassword string
param autoShutdown bool
param shutdownTime string
param subnetId string
param nsgId string
param pipId string
param page string

var vmName = '${labName}-vm'
// The page is written after nginx is installed, because the package would otherwise overwrite it.
var cloudInit = replace(loadTextContent('cloud-init.yaml'), '__PAGE__', base64(page))

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${labName}-nic'
  location: location
  tags: tags
  properties: {
    networkSecurityGroup: { id: nsgId }
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: { id: subnetId }
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: { id: pipId, properties: { deleteOption: 'Delete' } }
        }
      }
    ]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: vmName
  location: location
  tags: tags
  properties: {
    hardwareProfile: { vmSize: vmSize }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts-gen2', version: 'latest' }
      osDisk: {
        createOption: 'FromImage'
        deleteOption: 'Delete'
        diskSizeGB: 30
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    osProfile: {
      computerName: take(replace(labName, '-', ''), 15)
      adminUsername: adminUsername
      adminPassword: adminPassword
      customData: base64(cloudInit)
      linuxConfiguration: { disablePasswordAuthentication: false, provisionVMAgent: true }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id, properties: { deleteOption: 'Delete' } }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } }
  }
}

// Auto-shutdown: the resource name must follow this exact pattern.
resource shutdown 'Microsoft.DevTestLab/schedules@2018-09-15' = if (autoShutdown) {
  name: 'shutdown-computevm-${vmName}'
  location: location
  tags: tags
  properties: {
    status: 'Enabled'
    taskType: 'ComputeVmShutdownTask'
    dailyRecurrence: { time: shutdownTime }
    timeZoneId: 'Central America Standard Time'
    targetResourceId: vm.id
    notificationSettings: { status: 'Disabled' }
  }
}

output name string = vm.name
