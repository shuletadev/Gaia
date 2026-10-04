param labName string
param location string
param tags object
param vmSize string
@secure()
param adminPassword string
param subnetId string
param page string
param adminUsername string = 'cooperativaAdmin'

var lbName = '${labName}-lb'
var cloudInit = replace(loadTextContent('cloud-init.yaml'), '__PAGE__', base64(page))

resource pip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${labName}-lb-pip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: { domainNameLabel: '${labName}-lb' }
  }
}

// Standard load balancer: it spreads port 80 across both servers and only sends traffic to ones that answer the probe.
// The outbound rule lets the servers reach the internet to install nginx (they have no public IPs of their own).
resource lb 'Microsoft.Network/loadBalancers@2024-05-01' = {
  name: lbName
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    frontendIPConfigurations: [{ name: 'frontend', properties: { publicIPAddress: { id: pip.id } } }]
    backendAddressPools: [{ name: 'web' }]
    probes: [{ name: 'http', properties: { protocol: 'Http', port: 80, requestPath: '/', intervalInSeconds: 5, numberOfProbes: 2 } }]
    loadBalancingRules: [
      {
        name: 'http'
        properties: {
          frontendIPConfiguration: { id: resourceId('Microsoft.Network/loadBalancers/frontendIPConfigurations', lbName, 'frontend') }
          backendAddressPool: { id: resourceId('Microsoft.Network/loadBalancers/backendAddressPools', lbName, 'web') }
          probe: { id: resourceId('Microsoft.Network/loadBalancers/probes', lbName, 'http') }
          protocol: 'Tcp'
          frontendPort: 80
          backendPort: 80
          enableTcpReset: true
          idleTimeoutInMinutes: 4
          disableOutboundSnat: true
        }
      }
    ]
    outboundRules: [
      {
        name: 'salida'
        properties: {
          frontendIPConfigurations: [{ id: resourceId('Microsoft.Network/loadBalancers/frontendIPConfigurations', lbName, 'frontend') }]
          backendAddressPool: { id: resourceId('Microsoft.Network/loadBalancers/backendAddressPools', lbName, 'web') }
          protocol: 'All'
          idleTimeoutInMinutes: 4
        }
      }
    ]
  }
}

// Two servers in an availability set, so a planned update or a rack failure never takes both down.
resource avset 'Microsoft.Compute/availabilitySets@2024-07-01' = {
  name: '${labName}-av'
  location: location
  tags: tags
  sku: { name: 'Aligned' }
  properties: { platformFaultDomainCount: 2, platformUpdateDomainCount: 2 }
}

resource nics 'Microsoft.Network/networkInterfaces@2024-05-01' = [for i in range(1, 2): {
  name: '${labName}-web${i}-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: { id: subnetId }
          privateIPAllocationMethod: 'Dynamic'
          loadBalancerBackendAddressPools: [{ id: resourceId('Microsoft.Network/loadBalancers/backendAddressPools', lbName, 'web') }]
        }
      }
    ]
  }
  dependsOn: [lb]
}]

resource vms 'Microsoft.Compute/virtualMachines@2024-07-01' = [for i in range(1, 2): {
  name: '${labName}-web${i}'
  location: location
  tags: tags
  properties: {
    availabilitySet: { id: avset.id }
    hardwareProfile: { vmSize: vmSize }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts-gen2', version: 'latest' }
      osDisk: { createOption: 'FromImage', deleteOption: 'Delete', diskSizeGB: 30, managedDisk: { storageAccountType: 'StandardSSD_LRS' } }
    }
    osProfile: {
      computerName: 'web${i}'
      adminUsername: adminUsername
      adminPassword: adminPassword
      customData: base64(cloudInit)
      linuxConfiguration: { disablePasswordAuthentication: false, provisionVMAgent: true }
    }
    networkProfile: { networkInterfaces: [{ id: nics[i - 1].id, properties: { deleteOption: 'Delete' } }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } }
  }
}]

output fqdn string = pip.properties.dnsSettings.fqdn
output ip string = pip.properties.ipAddress
