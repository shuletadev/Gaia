param labName string
param tags object
param contactEmail string
param errorThreshold int
param maintenanceRule bool
param siteId string
param insightsId string

// Who is told, and how: one action group shared by every alert below.
resource group 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${labName}-avisar'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'tornillo'
    enabled: true
    emailReceivers: [{ name: 'dueno', emailAddress: contactEmail, useCommonAlertSchema: true }]
  }
}

// Metric alert: a number the platform already measures, checked every minute (cheap and fast).
resource serverErrors 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${labName}-errores-5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'La tienda respondió con errores del servidor.'
    severity: 2
    enabled: true
    scopes: [siteId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'errores5xx'
          metricName: 'Http5xx'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: errorThreshold
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: group.id }]
  }
}

resource slow 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${labName}-respuesta-lenta'
  location: 'global'
  tags: tags
  properties: {
    description: 'El tiempo medio de respuesta pasó de 3 segundos.'
    severity: 3
    enabled: true
    scopes: [siteId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'respuestaLenta'
          metricName: 'HttpResponseTime'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: 3
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [{ actionGroupId: group.id }]
  }
}

// Log alert: a KQL query over Application Insights data (more flexible, a few minutes slower, billed per evaluation).
resource failedRequests 'Microsoft.Insights/scheduledQueryRules@2022-06-15' = {
  name: '${labName}-solicitudes-fallidas'
  location: resourceGroup().location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'Solicitudes fallidas (consulta KQL)'
    description: 'Más de 5 solicitudes con código 5xx en cinco minutos.'
    severity: 3
    enabled: true
    scopes: [insightsId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: 'requests | where resultCode startswith "5"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 5
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [group.id] }
  }
}

// Activity log alert: tells you when someone deletes the web app (who did it is in the activity log).
resource deleted 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {
  name: '${labName}-sitio-eliminado'
  location: 'global'
  tags: tags
  properties: {
    description: 'Alguien eliminó la aplicación web.'
    enabled: true
    scopes: [resourceGroup().id]
    condition: {
      allOf: [
        { field: 'category', equals: 'Administrative' }
        { field: 'operationName', equals: 'Microsoft.Web/sites/delete' }
      ]
    }
    actions: { actionGroups: [{ actionGroupId: group.id }] }
  }
}

// Service health alert: a problem on Microsoft's side, not yours.
resource health 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {
  name: '${labName}-salud-del-servicio'
  location: 'global'
  tags: tags
  properties: {
    description: 'Un incidente de Azure puede afectar a la suscripción.'
    enabled: true
    scopes: [subscription().id]
    condition: {
      allOf: [{ field: 'category', equals: 'ServiceHealth' }]
    }
    actions: { actionGroups: [{ actionGroupId: group.id }] }
  }
}

// Alert processing rule: during the weekly maintenance window the alerts still fire but nobody is notified.
resource maintenance 'Microsoft.AlertsManagement/actionRules@2021-08-08' = if (maintenanceRule) {
  name: '${labName}-mantenimiento'
  location: 'global'
  tags: tags
  properties: {
    description: 'Silencia los avisos los domingos de 2:00 a 4:00.'
    enabled: true
    scopes: [resourceGroup().id]
    schedule: {
      timeZone: 'Central America Standard Time'
      recurrences: [
        { recurrenceType: 'Weekly', daysOfWeek: ['Sunday'], startTime: '02:00:00', endTime: '04:00:00' }
      ]
    }
    actions: [{ actionType: 'RemoveAllActionGroups' }]
  }
}
