param labName string
param location string
param tags object

// One container, started for as long as it exists: billed per second for the CPU and memory it asks for.
resource group 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: '${labName}-aci'
  location: location
  tags: tags
  properties: {
    osType: 'Linux'
    restartPolicy: 'Always'
    ipAddress: {
      type: 'Public'
      dnsNameLabel: '${labName}-aci'
      ports: [{ protocol: 'TCP', port: 80 }]
    }
    containers: [
      {
        name: 'repartos'
        properties: {
          image: 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'
          ports: [{ port: 80 }]
          resources: { requests: { cpu: json('0.5'), memoryInGB: json('1.0') } }
        }
      }
    ]
  }
}

output url string = 'http://${group.properties.ipAddress.fqdn}'
