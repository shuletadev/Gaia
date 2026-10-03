param labName string
param location string
param tags object
param sku string
param publisherEmail string
param publisherName string
@secure()
param gatewayToken string
@secure()
param adminPassword string
@allowed(['vm', 'containerapps'])
param gatewayHost string
param adminUsername string = 'labadmin'
param stage int

var apimName = '${labName}-apim'
var gatewayName = 'lab-gateway'

// ---- Stage 1: API Management, gateway resource, API assigned to the gateway ---------------------

module apim 'br/public:avm/res/api-management/service:0.14.4' = {
  name: 'apim'
  params: {
    name: apimName
    location: location
    tags: tags
    sku: sku
    skuCapacity: 1
    availabilityZones: []
    publisherEmail: publisherEmail
    publisherName: publisherName
    enableTelemetry: false
    apis: [
      {
        name: 'httpbin'
        displayName: 'httpbin (sample)'
        path: 'httpbin'
        serviceUrl: 'https://httpbin.org'
        protocols: ['http', 'https']
        subscriptionRequired: false
        operations: [
          { name: 'get', displayName: 'GET /get', method: 'GET', urlTemplate: '/get' }
          { name: 'headers', displayName: 'GET /headers', method: 'GET', urlTemplate: '/headers' }
        ]
      }
    ]
  }
}

resource apimRef 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: apimName
}

resource gateway 'Microsoft.ApiManagement/service/gateways@2024-05-01' = {
  parent: apimRef
  name: gatewayName
  properties: {
    description: 'labctl self-hosted gateway (Azure Container Instances)'
    locationData: { name: 'lab-container', city: location }
  }
  dependsOn: [apim]
}

resource gatewayApi 'Microsoft.ApiManagement/service/gateways/apis@2024-05-01' = {
  parent: gateway
  name: 'httpbin'
  properties: { provisioningState: 'created' }
}

// ---- Stage 2: the gateway container ------------------------------------------------------------
// The gateway's settings use dotted names (config.service.endpoint), which Container Instances rejects
// as environment variables. A small VM running Docker is the default host (VM capacity is the most
// dependable); Container Apps is the managed alternative.

var onVm = stage >= 2 && gatewayHost == 'vm'
var onAca = stage >= 2 && gatewayHost == 'containerapps'
var endpoint = '${apimName}.configuration.azure-api.net'

// Docker env file (dotted names are fine there), delivered base64-encoded by cloud-init.
var envFile = 'config.service.endpoint=${endpoint}\nconfig.service.auth=${gatewayToken}\nruntime.deployment.artifact.source=Azure Portal\nruntime.deployment.mechanism=YAML\n'
var cloudInit = '#cloud-config\npackage_update: true\npackages: [docker.io]\nwrite_files:\n  - path: /etc/apim-gateway.env\n    permissions: "0600"\n    encoding: b64\n    content: ${base64(envFile)}\nruncmd:\n  - systemctl enable --now docker\n  - docker run -d --restart always --name gateway -p 8080:8080 -p 8081:8081 --env-file /etc/apim-gateway.env mcr.microsoft.com/azure-api-management/gateway:v2\n'

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = if (onVm) {
  name: '${labName}-shgw-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowGateway'
        properties: { priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourceAddressPrefix: 'Internet', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRanges: ['8080', '8081'] }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = if (onVm) {
  name: '${labName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.70.0.0/16'] }
    subnets: [{ name: 'gateway', properties: { addressPrefix: '10.70.1.0/24', networkSecurityGroup: { id: nsg.id } } }]
  }
}

resource pip 'Microsoft.Network/publicIPAddresses@2024-05-01' = if (onVm) {
  name: '${labName}-shgw-pip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static', dnsSettings: { domainNameLabel: '${labName}-shgw' } }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = if (onVm) {
  name: '${labName}-shgw-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      { name: 'ipconfig1', properties: { subnet: { id: '${vnet.id}/subnets/gateway' }, publicIPAddress: { id: pip.id }, privateIPAllocationMethod: 'Dynamic' } }
    ]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = if (onVm) {
  name: '${labName}-shgw'
  location: location
  tags: tags
  properties: {
    hardwareProfile: { vmSize: 'Standard_B2s' }
    osProfile: {
      computerName: 'shgw'
      adminUsername: adminUsername
      adminPassword: adminPassword
      customData: base64(cloudInit)
      linuxConfiguration: { disablePasswordAuthentication: false }
    }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts-gen2', version: 'latest' }
      osDisk: { createOption: 'FromImage', deleteOption: 'Delete', managedDisk: { storageAccountType: 'StandardSSD_LRS' } }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id, properties: { deleteOption: 'Delete' } }] }
  }
  dependsOn: [gatewayApi]
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = if (onAca) {
  name: '${labName}-env'
  location: location
  tags: tags
  properties: {
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
  }
}

resource shgw 'Microsoft.App/containerApps@2024-03-01' = if (onAca) {
  name: '${labName}-shgw'
  location: location
  tags: tags
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      secrets: [{ name: 'gateway-auth', value: gatewayToken }]
      ingress: { external: true, targetPort: 8080, transport: 'http', allowInsecure: false }
    }
    template: {
      containers: [
        {
          name: 'gateway'
          image: 'mcr.microsoft.com/azure-api-management/gateway:v2'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'config.service.endpoint', value: endpoint }
            { name: 'config.service.auth', secretRef: 'gateway-auth' }
            { name: 'runtime.deployment.artifact.source', value: 'Azure Portal' }
            { name: 'runtime.deployment.mechanism', value: 'YAML' }
          ]
          probes: [
            { type: 'Readiness', httpGet: { path: '/status-0123456789abcdef', port: 8080 }, initialDelaySeconds: 10, periodSeconds: 10 }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [gatewayApi]
}

var shgwBase = onVm ? 'http://${pip!.properties.dnsSettings.fqdn}:8080' : onAca ? 'https://${shgw!.properties.configuration.ingress.fqdn}' : ''

output apimName string = apimName
output gatewayName string = gatewayName
output gatewayUrl string = 'https://${apimName}.azure-api.net'
output selfHostedUrl string = shgwBase
output sampleRequest string = stage >= 2 ? 'curl ${shgwBase}/httpbin/get' : 'curl https://${apimName}.azure-api.net/httpbin/get'