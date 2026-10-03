param apimName string
param vnetId string
param tags object

// Resolved when this module starts, i.e. after the APIM deployment it depends on has finished.
resource apim 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: apimName
}

var privateIp = apim.properties.privateIPAddresses[0]
var hosts = [apimName, '${apimName}.portal', '${apimName}.developer', '${apimName}.management', '${apimName}.scm']

module zone 'br/public:avm/res/network/private-dns-zone:0.8.1' = {
  name: 'azure-api-zone'
  params: {
    name: 'azure-api.net'
    tags: tags
    enableTelemetry: false
    a: [for h in hosts: { name: h, ttl: 300, aRecords: [{ ipv4Address: privateIp }] }]
    virtualNetworkLinks: [
      { name: 'lab-vnet', virtualNetworkResourceId: vnetId, registrationEnabled: false }
    ]
  }
}

output privateIp string = privateIp
