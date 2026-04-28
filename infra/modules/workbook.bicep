@description('GUID used as the workbook resource name.')
param name string

@description('Display name shown in the Workbooks gallery.')
param displayName string

param location string
param category string = 'workbook'

@description('Fallback resource id for the workbook (typically a Log Analytics workspace).')
param sourceId string

@description('Workbook template content as a JSON string.')
param serializedData string

resource wb 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: name
  location: location
  kind: 'shared'
  properties: {
    displayName: displayName
    serializedData: serializedData
    category: category
    sourceId: sourceId
    version: '1.0'
  }
}

output id string = wb.id
