using './main.bicep'

// Sample parameters file. Copy to main.bicepparam (without .sample) and edit before deploying.
param workbookDisplayName = 'Arc Drift Dashboard'
param logAnalyticsWorkspaceId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arc/providers/Microsoft.OperationalInsights/workspaces/law-arc'
