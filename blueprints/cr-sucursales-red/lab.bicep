param labName string
param location string
param tags object
param vmSize string
param clientVm bool
@secure()
param adminPassword string

var page = loadTextContent('page.html')

module network 'network.bicep' = {
  name: 'network'
  params: { labName: labName, location: location, tags: tags }
}

module web 'web.bicep' = {
  name: 'web'
  params: {
    labName: labName
    location: location
    tags: tags
    vmSize: vmSize
    adminPassword: adminPassword
    subnetId: network.outputs.webSubnetId
    page: page
  }
}

// A client in the second branch. Spoke to spoke is NOT peered, so reaching the web servers from here is the lesson.
module client 'client.bicep' = if (clientVm) {
  name: 'client'
  params: {
    labName: labName
    location: location
    tags: tags
    vmSize: vmSize
    adminPassword: adminPassword
    subnetId: network.outputs.clientSubnetId
  }
}

output url string = 'http://${web.outputs.fqdn}'
output loadBalancerIp string = web.outputs.ip
output dnsZone string = network.outputs.zoneName
output webServers string = 'web1, web2'
output clientVm string = clientVm ? '${labName}-cli' : 'none'
