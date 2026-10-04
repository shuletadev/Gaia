param labName string
param location string
param tags object
param adminUsername string = 'clinicaAdmin'
@secure()
param adminPassword string

var vmName = '${labName}-vm'

// No inbound rule at all: the server needs no visitors, only outbound access so the backup extension can reach Azure.
resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${labName}-nsg'
  location: location
  tags: tags
  properties: { securityRules: [] }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${labName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [{ name: 'servidores', properties: { addressPrefix: '10.40.1.0/24', networkSecurityGroup: { id: nsg.id } } }]
  }
}

resource pip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${labName}-pip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${labName}-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: { id: vnet.properties.subnets[0].id }
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: { id: pip.id, properties: { deleteOption: 'Delete' } }
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
    hardwareProfile: { vmSize: 'Standard_B1s' }
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
      // Writes the data folder the class deletes and then recovers from a restore point.
      customData: base64(loadTextContent('cloud-init.yaml'))
      linuxConfiguration: { disablePasswordAuthentication: false, provisionVMAgent: true }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id, properties: { deleteOption: 'Delete' } }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } }
  }
}

output id string = vm.id
output name string = vm.name
