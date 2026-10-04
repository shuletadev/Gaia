param labName string
param location string
param tags object

// Hub = the head office's shared services. Spoke A = the central web servers. Spoke B = a branch office (Grecia).
resource webNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${labName}-web-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowHttpFromInternet'
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

resource branchNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${labName}-sucursal-nsg'
  location: location
  tags: tags
  properties: { securityRules: [] }
}

resource hub 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${labName}-hub'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.50.0.0/16'] }
    subnets: [{ name: 'servicios', properties: { addressPrefix: '10.50.1.0/24' } }]
  }
}

resource spokeA 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${labName}-central'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.51.0.0/16'] }
    subnets: [{ name: 'web', properties: { addressPrefix: '10.51.1.0/24', networkSecurityGroup: { id: webNsg.id } } }]
  }
}

resource spokeB 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${labName}-grecia'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.52.0.0/16'] }
    subnets: [{ name: 'sucursal', properties: { addressPrefix: '10.52.1.0/24', networkSecurityGroup: { id: branchNsg.id } } }]
  }
}

// Peering is not transitive: the hub reaches both spokes, but the two spokes do not reach each other.
resource hubToCentral 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01' = {
  parent: hub
  name: 'hub-a-central'
  properties: { remoteVirtualNetwork: { id: spokeA.id }, allowVirtualNetworkAccess: true, allowForwardedTraffic: false }
}

resource centralToHub 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01' = {
  parent: spokeA
  name: 'central-a-hub'
  properties: { remoteVirtualNetwork: { id: hub.id }, allowVirtualNetworkAccess: true, allowForwardedTraffic: false }
}

resource hubToGrecia 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01' = {
  parent: hub
  name: 'hub-a-grecia'
  properties: { remoteVirtualNetwork: { id: spokeB.id }, allowVirtualNetworkAccess: true, allowForwardedTraffic: false }
}

resource greciaToHub 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01' = {
  parent: spokeB
  name: 'grecia-a-hub'
  properties: { remoteVirtualNetwork: { id: hub.id }, allowVirtualNetworkAccess: true, allowForwardedTraffic: false }
}

// Private names for the servers. Spoke A registers its VMs automatically; the other networks only resolve the names.
resource zone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'sucursales.interno'
  location: 'global'
  tags: tags
}

resource linkCentral 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: zone
  name: 'central'
  location: 'global'
  properties: { virtualNetwork: { id: spokeA.id }, registrationEnabled: true }
}

resource linkGrecia 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: zone
  name: 'grecia'
  location: 'global'
  properties: { virtualNetwork: { id: spokeB.id }, registrationEnabled: false }
}

resource linkHub 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: zone
  name: 'hub'
  location: 'global'
  properties: { virtualNetwork: { id: hub.id }, registrationEnabled: false }
}

output webSubnetId string = spokeA.properties.subnets[0].id
output clientSubnetId string = spokeB.properties.subnets[0].id
output zoneName string = zone.name
