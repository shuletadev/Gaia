param labName string
param location string
param tags object
param planId string
param healthCheck bool
param insightsConnection string
param page string
param server string

// The page and a tiny Node server travel as app settings, so neither production nor staging needs a deployment step.
var appB64 = base64(replace(server, '__PAGE__', base64(page)))
var startup = 'sh -c "echo $APP_B64 | base64 -d > /tmp/server.js && node /tmp/server.js"'

var common = [
  { name: 'APP_B64', value: appB64 }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insightsConnection }
  { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
]

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: '${labName}-app'
  location: location
  tags: tags
  kind: 'app,linux'
  properties: {
    serverFarmId: planId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: healthCheck ? '/health' : null
      appCommandLine: startup
      appSettings: concat(common, [{ name: 'APP_VERSION', value: '1' }])
    }
  }
}

// The same app with a newer version: students swap it into production without downtime.
resource staging 'Microsoft.Web/sites/slots@2023-12-01' = {
  parent: site
  name: 'staging'
  location: location
  tags: tags
  kind: 'app,linux'
  properties: {
    serverFarmId: planId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: healthCheck ? '/health' : null
      appCommandLine: startup
      appSettings: concat(common, [{ name: 'APP_VERSION', value: '2' }])
    }
  }
}

output name string = site.name
output url string = 'https://${site.properties.defaultHostName}'
output stagingUrl string = 'https://${staging.properties.defaultHostName}'
