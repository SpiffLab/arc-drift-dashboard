targetScope = 'resourceGroup'

@description('Display name shown in Azure Monitor Workbooks gallery.')
param workbookDisplayName string = 'Arc Drift Dashboard'

@description('Azure region for the workbook resource. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Resource ID of the Log Analytics workspace that receives Change Tracking + AMA data from your Arc machines. Used as the workbook fallback resource id so Logs queries resolve out of the box.')
param logAnalyticsWorkspaceId string

@description('Stable GUID used as the workbook resource name. Change to deploy a second copy.')
param workbookId string = guid(resourceGroup().id, workbookDisplayName)

@description('Optional category for the workbook gallery.')
param category string = 'workbook'

module workbook 'modules/workbook.bicep' = {
  name: 'arc-drift-workbook'
  params: {
    name: workbookId
    displayName: workbookDisplayName
    location: location
    category: category
    sourceId: logAnalyticsWorkspaceId
    serializedData: loadTextContent('../workbooks/arc-drift-dashboard.workbook.json')
  }
}

output workbookResourceId string = workbook.outputs.id
output workbookName string = workbookDisplayName
