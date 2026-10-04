param labName string
param location string
param tags object
param redundancy string
param includeReplica bool

module network 'network.bicep' = {
  name: 'network'
  params: { labName: labName, location: location, tags: tags }
}

module storage 'storage.bicep' = {
  name: 'storage'
  params: {
    labName: labName
    location: location
    tags: tags
    role: 'orig'
    skuName: 'Standard_${redundancy}'
    subnetId: network.outputs.subnetId
  }
}

module replica 'storage.bicep' = if (includeReplica) {
  name: 'replica'
  params: {
    labName: labName
    location: location
    tags: tags
    role: 'repl'
    skuName: 'Standard_LRS'
    subnetId: ''
  }
}

module lifecycle 'lifecycle.bicep' = {
  name: 'lifecycle'
  params: { accountName: storage.outputs.name }
}

output accountId string = storage.outputs.id
output name string = storage.outputs.name
output replicaName string = replica.?outputs.name ?? ''
