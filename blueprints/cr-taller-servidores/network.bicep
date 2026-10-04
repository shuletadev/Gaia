param labName string
param location string
param tags object

// Only web traffic comes in. SSH stays closed: students use the portal's Run Command if they need a shell.
resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${labName}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowHttpInbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '80'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${labName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.20.0.0/16'] }
    subnets: [{ name: 'web', properties: { addressPrefix: '10.20.1.0/24' } }]
  }
}

resource pip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${labName}-pip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: { domainNameLabel: '${labName}-vm' }
  }
}

output subnetId string = vnet.properties.subnets[0].id
output nsgId string = nsg.id
output pipId string = pip.id
output fqdn string = pip.properties.dnsSettings.fqdn
