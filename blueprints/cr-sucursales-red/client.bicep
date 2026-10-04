param labName string
param location string
param tags object
param vmSize string
@secure()
param adminPassword string
param subnetId string
param adminUsername string = 'cooperativaAdmin'

// A client in the Grecia branch with no public IP: students use Run Command in the portal to test connections from here.
resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${labName}-cli-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [{ name: 'ipconfig1', properties: { subnet: { id: subnetId }, privateIPAllocationMethod: 'Dynamic' } }]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${labName}-cli'
  location: location
  tags: tags
  properties: {
    hardwareProfile: { vmSize: vmSize }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts-gen2', version: 'latest' }
      osDisk: { createOption: 'FromImage', deleteOption: 'Delete', diskSizeGB: 30, managedDisk: { storageAccountType: 'StandardSSD_LRS' } }
    }
    osProfile: {
      computerName: 'sucursal'
      adminUsername: adminUsername
      adminPassword: adminPassword
      linuxConfiguration: { disablePasswordAuthentication: false, provisionVMAgent: true }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id, properties: { deleteOption: 'Delete' } }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } }
  }
}

output name string = vm.name
