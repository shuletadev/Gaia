param labName string
param location string
param tags object
param registrySku string

// Starts empty: the instructor imports an image into it in class (az acr import) and shows the repository in the portal.
// The admin user stays off; access is by identity.
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: take('${replace(labName, '-', '')}acr${uniqueString(resourceGroup().id)}', 50)
  location: location
  tags: tags
  sku: { name: registrySku }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

output name string = registry.name
output loginServer string = registry.properties.loginServer
