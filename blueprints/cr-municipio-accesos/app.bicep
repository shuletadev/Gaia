param labName string
param location string
param tags object
param appTier string
param storageAccount string
param page string
param server string

// The page and a tiny Node server travel as an app setting, so there is no deployment step.
var appB64 = base64(replace(server, '__PAGE__', base64(page)))

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${labName}-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: appTier == 'F1' ? { name: 'F1', tier: 'Free' } : { name: 'B1', tier: 'Basic' }
  properties: { reserved: true }
}

// The system-assigned identity is created with the app and deleted with it.
resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: '${labName}-app'
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: appTier != 'F1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appCommandLine: 'sh -c "echo $APP_B64 | base64 -d > /tmp/server.js && node /tmp/server.js"'
      appSettings: [
        { name: 'APP_B64', value: appB64 }
        { name: 'STORAGE_ACCOUNT', value: storageAccount }
      ]
    }
  }
}

output name string = site.name
output url string = 'https://${site.properties.defaultHostName}'
output principalId string = site.identity.principalId
