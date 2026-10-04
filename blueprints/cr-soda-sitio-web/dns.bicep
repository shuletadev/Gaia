param tags object
param siteHost string

// The zone is not delegated to a real domain, so nothing resolves on the internet: students practice the records.
resource zone 'Microsoft.Network/dnsZones@2018-05-01' = {
  name: 'sodadonarosa.example'
  location: 'global'
  tags: tags
}

resource www 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: zone
  name: 'www'
  properties: { TTL: 3600, CNAMERecord: { cname: siteHost } }
}

// 203.0.113.0/24 is reserved for documentation, so this address never points at a real server.
resource apex 'Microsoft.Network/dnsZones/A@2018-05-01' = {
  parent: zone
  name: '@'
  properties: { TTL: 3600, ARecords: [{ ipv4Address: '203.0.113.10' }] }
}

resource txt 'Microsoft.Network/dnsZones/TXT@2018-05-01' = {
  parent: zone
  name: '@'
  properties: { TTL: 3600, TXTRecords: [{ value: ['v=spf1 -all'] }] }
}

output zoneName string = zone.name
