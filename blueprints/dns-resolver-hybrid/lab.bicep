param labName string
param location string
param tags object
param spoke bool
param stage int

var inboundIp = '10.95.0.4'
var onPremDns = '10.200.0.4'
var onPremDomain = 'onprem.contoso.test.'
var delegation = [{ name: 'dnsResolvers', properties: { serviceName: 'Microsoft.Network/dnsResolvers' } }]

// ---- Stage 1: hub, spoke, private zone ----------------------------------------------------------

resource hub 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${labName}-hub'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.95.0.0/16'] }
    subnets: [
      { name: 'dns-inbound', properties: { addressPrefix: '10.95.0.0/28', delegations: delegation } }
      { name: 'dns-outbound', properties: { addressPrefix: '10.95.0.16/28', delegations: delegation } }
      { name: 'workload', properties: { addressPrefix: '10.95.1.0/24' } }
    ]
  }
}

resource spokeVnet 'Microsoft.Network/virtualNetworks@2024-05-01' = if (spoke) {
  name: '${labName}-spoke'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.96.0.0/16'] }
    // Workloads in the spoke resolve through the hub's inbound endpoint.
    dhcpOptions: { dnsServers: [inboundIp] }
    subnets: [{ name: 'workload', properties: { addressPrefix: '10.96.1.0/24' } }]
  }
}

resource hubToSpoke 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01' = if (spoke) {
  parent: hub
  name: 'to-spoke'
  properties: { remoteVirtualNetwork: { id: spokeVnet.id }, allowVirtualNetworkAccess: true, allowForwardedTraffic: true }
}

resource spokePeering 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2024-05-01' = if (spoke) {
  parent: spokeVnet
  name: 'to-hub'
  properties: { remoteVirtualNetwork: { id: hub.id }, allowVirtualNetworkAccess: true, allowForwardedTraffic: true }
}

resource zone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'lab.internal'
  location: 'global'
  tags: tags
}

resource record 'Microsoft.Network/privateDnsZones/A@2024-06-01' = {
  parent: zone
  name: 'app'
  properties: { ttl: 60, aRecords: [{ ipv4Address: '10.95.1.10' }] }
}

resource zoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: zone
  name: 'hub'
  location: 'global'
  tags: tags
  properties: { virtualNetwork: { id: hub.id }, registrationEnabled: false }
}

// ---- Stage 2: resolver, endpoints, forwarding ruleset --------------------------------------------

resource resolver 'Microsoft.Network/dnsResolvers@2022-07-01' = if (stage >= 2) {
  name: '${labName}-resolver'
  location: location
  tags: tags
  properties: { virtualNetwork: { id: hub.id } }
}

resource inbound 'Microsoft.Network/dnsResolvers/inboundEndpoints@2022-07-01' = if (stage >= 2) {
  parent: resolver
  name: 'inbound'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [{ subnet: { id: '${hub.id}/subnets/dns-inbound' }, privateIpAllocationMethod: 'Static', privateIpAddress: inboundIp }]
  }
}

resource outbound 'Microsoft.Network/dnsResolvers/outboundEndpoints@2022-07-01' = if (stage >= 2) {
  parent: resolver
  name: 'outbound'
  location: location
  tags: tags
  properties: { subnet: { id: '${hub.id}/subnets/dns-outbound' } }
}

resource ruleset 'Microsoft.Network/dnsForwardingRulesets@2022-07-01' = if (stage >= 2) {
  name: '${labName}-ruleset'
  location: location
  tags: tags
  properties: { dnsResolverOutboundEndpoints: [{ id: outbound.id }] }
}

resource rule 'Microsoft.Network/dnsForwardingRulesets/forwardingRules@2022-07-01' = if (stage >= 2) {
  parent: ruleset
  name: 'onprem'
  properties: { domainName: onPremDomain, forwardingRuleState: 'Enabled', targetDnsServers: [{ ipAddress: onPremDns, port: 53 }] }
}

resource rulesetLink 'Microsoft.Network/dnsForwardingRulesets/virtualNetworkLinks@2022-07-01' = if (stage >= 2 && spoke) {
  parent: ruleset
  name: 'spoke'
  properties: { virtualNetwork: { id: spokeVnet.id } }
}

output resolverName string = stage >= 2 ? resolver.name : ''
output inboundIp string = inboundIp
output onPremForwarders string = 'On-prem DNS: conditional forwarders for lab.internal and privatelink.* zones -> ${inboundIp}'
output forwardingRule string = '${onPremDomain} -> ${onPremDns}:53 (simulated on-prem DNS)'
