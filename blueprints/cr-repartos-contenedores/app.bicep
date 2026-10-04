param labName string
param location string
param tags object
param minReplicas int
param maxReplicas int

// A consumption environment: no servers to size, and no hourly charge for the environment itself.
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${labName}-env'
  location: location
  tags: tags
  properties: {}
}

// Scales on HTTP traffic: one more replica for every 10 concurrent requests, down to zero when nobody calls.
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${labName}-app'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      ingress: { external: true, targetPort: 80, transport: 'auto' }
    }
    template: {
      containers: [
        {
          name: 'repartos'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [{ name: 'trafico-http', http: { metadata: { concurrentRequests: '10' } } }]
      }
    }
  }
}

output name string = app.name
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
