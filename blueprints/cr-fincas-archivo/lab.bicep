param labName string
param location string
param tags object
param redundancy string
param enableVersioning bool
param lifecycleDays int

module storage 'storage.bicep' = {
  name: 'storage'
  params: { labName: labName, location: location, tags: tags, redundancy: redundancy, enableVersioning: enableVersioning }
}

module lifecycle 'lifecycle.bicep' = {
  name: 'lifecycle'
  params: { accountName: storage.outputs.name, lifecycleDays: lifecycleDays }
}

output accountId string = storage.outputs.id
output name string = storage.outputs.name
