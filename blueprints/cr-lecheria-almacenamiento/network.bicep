param labName string
param location string
param tags object

// A subnet with the Storage service endpoint: when the class turns the firewall on, this is the network that is let in.
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${labName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.30.0.0/16'] }
    subnets: [
      {
        name: 'oficinas'
        properties: {
          addressPrefix: '10.30.1.0/24'
          serviceEndpoints: [{ service: 'Microsoft.Storage', locations: [location] }]
        }
      }
    ]
  }
}

output subnetId string = vnet.properties.subnets[0].id
