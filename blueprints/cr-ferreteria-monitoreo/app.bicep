param labName string
param location string
param tags object
param workspaceId string
param insightsConnection string
param page string
param server string

// The page and a tiny Node server travel as an app setting, so there is no deployment step.
var appB64 = base64(replace(server, '__PAGE__', base64(page)))
var startup = 'sh -c "echo $APP_B64 | base64 -d > /tmp/server.js && node /tmp/server.js"'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${labName}-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: 'B1', tier: 'Basic', capacity: 1 }
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
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: '/health'
      appCommandLine: startup
      appSettings: [
        { name: 'APP_B64', value: appB64 }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insightsConnection }
        { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
      ]
    }
  }
}

// Send the web server's logs and metrics to the workspace, so the class can query them with KQL.
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: site
  name: 'a-log-analytics'
  properties: {
    workspaceId: workspaceId
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

output id string = site.id
output name string = site.name
output url string = 'https://${site.properties.defaultHostName}'
