param labName string
param location string
param tags object
param paasTier string
param page string

// A tiny Node server that returns the page. It travels as an app setting, so no deployment step is needed.
var server = replace(loadTextContent('server.js'), '__PAGE__', base64(page))

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${labName}-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: paasTier == 'F1' ? { name: 'F1', tier: 'Free' } : { name: 'B1', tier: 'Basic' }
  properties: { reserved: true }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: '${labName}-app'
  location: location
  tags: tags
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: paasTier != 'F1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appCommandLine: 'sh -c "echo $APP_B64 | base64 -d > /tmp/server.js && node /tmp/server.js"'
      appSettings: [{ name: 'APP_B64', value: base64(server) }]
    }
  }
}

output name string = site.name
output url string = 'https://${site.properties.defaultHostName}'
