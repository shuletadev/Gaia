param labName string
param location string
param tags object
param allowedRegions string
param requireTag bool
param restrictStorage bool
param enforce bool
param budgetUsd int
param contactEmail string
param budgetStart string

var regions = allowedRegions == 'one' ? [location] : ['centralus', 'eastus', 'eastus2', 'westus2', 'westus3']

module storage 'storage.bicep' = {
  name: 'storage'
  params: { labName: labName, location: location, tags: tags }
}

// Policies come after the resources so the lab's own deployment is never blocked by them.
module policies 'policies.bicep' = {
  name: 'policies'
  dependsOn: [storage]
  params: {
    labName: labName
    allowedLocations: regions
    requireTag: requireTag
    restrictStorage: restrictStorage
    enforce: enforce
  }
}

module budget 'budget.bicep' = {
  name: 'budget'
  params: { labName: labName, budgetUsd: budgetUsd, contactEmail: contactEmail, budgetStart: budgetStart }
}

output lockedAccount string = storage.outputs.lockedAccount
output policyCount int = policies.outputs.count
