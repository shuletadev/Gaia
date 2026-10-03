param labName string
param location string
param tags object

// Free tier: the front end the cashier and the pharmacist open in the browser.
resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${labName}-web'
  location: location
  tags: tags
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

output url string = 'https://${site.properties.defaultHostname}'
