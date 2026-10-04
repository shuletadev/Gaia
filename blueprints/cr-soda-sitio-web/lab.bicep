param labName string
param location string
param tags object
param redundancy string
param accessTier string

module storage 'storage.bicep' = {
  name: 'storage'
  params: { labName: labName, location: location, tags: tags, redundancy: redundancy, accessTier: accessTier }
}

module dns 'dns.bicep' = {
  name: 'dns'
  params: { tags: tags, siteHost: storage.outputs.webHost }
}

output url string = storage.outputs.webUrl
output accountName string = storage.outputs.name
output dnsZone string = dns.outputs.zoneName
