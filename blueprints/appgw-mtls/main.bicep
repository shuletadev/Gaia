// Application Gateway Standard_v2 with frontend mutual TLS (client certificates) publishing httpbin.
targetScope = 'subscription'

param labName string
param location string
param tags object

@description('Also require the client certificate issuer DN to match the trusted CA.')
param verifyIssuerDn bool = false

@description('Forward the client certificate subject and verification result to the backend as headers.')
param forwardCertHeaders bool = true

@secure()
@description('Server certificate (PFX, base64); labctl generates it before stage 2.')
param serverPfx string = ''
@secure()
param serverPfxPassword string = ''
@description('Trusted client CA (PEM, base64); labctl generates it before stage 2.')
param clientCaCert string = ''

@minValue(1)
@maxValue(2)
@description('labctl deploys 1 (network + public IP), then 2 (Application Gateway).')
param stage int = 2

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: labName
  location: location
  tags: tags
}

module lab 'lab.bicep' = {
  scope: rg
  name: 'lab'
  params: {
    labName: labName
    location: location
    tags: tags
    verifyIssuerDn: verifyIssuerDn
    forwardCertHeaders: forwardCertHeaders
    serverPfx: serverPfx
    serverPfxPassword: serverPfxPassword
    clientCaCert: clientCaCert
    stage: stage
  }
}

output gatewayName string = lab.outputs.gatewayName
output gatewayHost string = lab.outputs.gatewayHost
output sampleRequest string = lab.outputs.sampleRequest
