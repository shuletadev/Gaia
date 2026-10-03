param labName string
param location string
param tags object
param verifyIssuerDn bool
param forwardCertHeaders bool
@secure()
param serverPfx string
@secure()
param serverPfxPassword string
param clientCaCert string
param stage int

var agwName = '${labName}-agw'
var agwId = resourceId('Microsoft.Network/applicationGateways', agwName)
var host = '${labName}.${location}.cloudapp.azure.com'

// ---- Stage 1: network and public IP ------------------------------------------------------------

module vnet 'br/public:avm/res/network/virtual-network:0.10.2' = {
  name: 'vnet'
  params: {
    name: '${labName}-vnet'
    location: location
    tags: tags
    enableTelemetry: false
    addressPrefixes: ['10.60.0.0/16']
    subnets: [{ name: 'appgw', addressPrefix: '10.60.1.0/24' }]
  }
}

module pip 'br/public:avm/res/network/public-ip-address:0.13.0' = {
  name: 'agw-pip'
  params: {
    name: '${agwName}-pip'
    location: location
    tags: tags
    enableTelemetry: false
    availabilityZones: []
    dnsSettings: { domainNameLabel: labName }
  }
}

// ---- Stage 2: Application Gateway with an mTLS SSL profile -------------------------------------

resource agw 'Microsoft.Network/applicationGateways@2024-05-01' = if (stage >= 2) {
  name: agwName
  location: location
  tags: tags
  properties: {
    sku: { name: 'Standard_v2', tier: 'Standard_v2' }
    autoscaleConfiguration: { minCapacity: 0, maxCapacity: 2 }
    gatewayIPConfigurations: [{ name: 'gw', properties: { subnet: { id: vnet.outputs.subnetResourceIds[0] } } }]
    frontendIPConfigurations: [{ name: 'public', properties: { publicIPAddress: { id: pip.outputs.resourceId } } }]
    frontendPorts: [{ name: 'https', properties: { port: 443 } }]
    sslCertificates: [{ name: 'server', properties: { data: serverPfx, password: serverPfxPassword } }]
    trustedClientCertificates: [{ name: 'lab-ca', properties: { data: clientCaCert } }]
    sslProfiles: [
      {
        name: 'mtls'
        properties: {
          clientAuthConfiguration: { verifyClientCertIssuerDN: verifyIssuerDn, verifyClientRevocation: 'None' }
          trustedClientCertificates: [{ id: '${agwId}/trustedClientCertificates/lab-ca' }]
          sslPolicy: { policyType: 'Predefined', policyName: 'AppGwSslPolicy20220101' }
        }
      }
    ]
    httpListeners: [
      {
        name: 'https'
        properties: {
          frontendIPConfiguration: { id: '${agwId}/frontendIPConfigurations/public' }
          frontendPort: { id: '${agwId}/frontendPorts/https' }
          protocol: 'Https'
          sslCertificate: { id: '${agwId}/sslCertificates/server' }
          sslProfile: { id: '${agwId}/sslProfiles/mtls' }
        }
      }
    ]
    backendAddressPools: [{ name: 'httpbin', properties: { backendAddresses: [{ fqdn: 'httpbin.org' }] } }]
    probes: [
      {
        name: 'httpbin'
        properties: {
          protocol: 'Https'
          path: '/get'
          interval: 30
          timeout: 30
          unhealthyThreshold: 3
          pickHostNameFromBackendHttpSettings: true
          match: { statusCodes: ['200-399'] }
        }
      }
    ]
    backendHttpSettingsCollection: [
      {
        name: 'https'
        properties: {
          port: 443
          protocol: 'Https'
          pickHostNameFromBackendAddress: true
          requestTimeout: 30
          probe: { id: '${agwId}/probes/httpbin' }
        }
      }
    ]
    rewriteRuleSets: forwardCertHeaders
      ? [
          {
            name: 'client-cert'
            properties: {
              rewriteRules: [
                {
                  name: 'forward-cert'
                  ruleSequence: 100
                  actionSet: {
                    requestHeaderConfigurations: [
                      { headerName: 'X-Client-Cert-Subject', headerValue: '{var_client_certificate_subject}' }
                      { headerName: 'X-Client-Cert-Verification', headerValue: '{var_client_certificate_verification}' }
                      { headerName: 'X-Client-Cert-Fingerprint', headerValue: '{var_client_certificate_fingerprint}' }
                    ]
                  }
                }
              ]
            }
          }
        ]
      : []
    requestRoutingRules: [
      {
        name: 'rule'
        properties: {
          ruleType: 'Basic'
          priority: 100
          httpListener: { id: '${agwId}/httpListeners/https' }
          backendAddressPool: { id: '${agwId}/backendAddressPools/httpbin' }
          backendHttpSettings: { id: '${agwId}/backendHttpSettingsCollection/https' }
          rewriteRuleSet: forwardCertHeaders ? { id: '${agwId}/rewriteRuleSets/client-cert' } : null
        }
      }
    ]
  }
}

output gatewayName string = agwName
output gatewayHost string = host
output sampleRequest string = stage >= 2 ? 'curl --cert client.pem --key client.key --cacert ca.pem https://${host}/headers' : ''
