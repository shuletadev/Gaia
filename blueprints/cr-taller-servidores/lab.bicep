param labName string
param location string
param tags object
param vmSize string
param paasTier string
param autoShutdown bool
param shutdownTime string
@secure()
param adminPassword string

// One page, two hosts: only the "who looks after it" column changes.
var page = loadTextContent('page.html')

module network 'network.bicep' = {
  name: 'network'
  params: { labName: labName, location: location, tags: tags }
}

module vm 'vm.bicep' = {
  name: 'vm'
  params: {
    labName: labName
    location: location
    tags: tags
    vmSize: vmSize
    adminPassword: adminPassword
    autoShutdown: autoShutdown
    shutdownTime: shutdownTime
    subnetId: network.outputs.subnetId
    nsgId: network.outputs.nsgId
    pipId: network.outputs.pipId
    page: replace(replace(replace(page, '__HOST__', 'Máquina virtual (IaaS)'), '__OSWHO__', 'Usted'), '__RUNWHO__', 'Usted')
  }
}

module paas 'paas.bicep' = {
  name: 'paas'
  params: {
    labName: labName
    location: location
    tags: tags
    paasTier: paasTier
    page: replace(replace(replace(page, '__HOST__', 'App Service (PaaS)'), '__OSWHO__', 'Azure'), '__RUNWHO__', 'Azure')
  }
}

output vmUrl string = 'http://${network.outputs.fqdn}'
output paasUrl string = paas.outputs.url
output vmName string = vm.outputs.name
output siteName string = paas.outputs.name
