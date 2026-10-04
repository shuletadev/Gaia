param labName string
param location string
param tags object

// The clinic's app subnet: HTTPS in, and the remote-admin ports closed on purpose (the default rules would also block them,
// but an explicit rule is what students can read and point at).
resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${labName}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowHttpsInbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        name: 'DenyRemoteAdminFromInternet'
        properties: {
          priority: 200
          direction: 'Inbound'
          access: 'Deny'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRanges: ['22', '3389']
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
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'app'
        properties: { addressPrefix: '10.40.1.0/24', networkSecurityGroup: { id: nsg.id } }
      }
    ]
  }
}

output nsgName string = nsg.name
