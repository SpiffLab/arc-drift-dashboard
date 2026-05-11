# Deployment guide

This guide deploys the Arc Drift Dashboard as an Azure Monitor Workbook. The deployed workbook is a read-only view for surfacing drift across Azure Arc-enabled servers: missing baseline controls, non-compliance, patch posture differences, security recommendations, and in-OS changes.

## Prerequisites

- Azure CLI installed and signed in.
- A target resource group for the Workbook.
- A Log Analytics workspace that receives data from the Arc-enabled servers you want to inspect.
- Azure Resource Graph access to the subscriptions that contain the target servers.
- Optional: Azure Policy and Machine Configuration data if you want the Policy and Machine Config tabs to populate.

## Required permissions

| Scope | Role | Required for |
| --- | --- | --- |
| Workbook resource group | Contributor, Monitoring Contributor, or Workbook Contributor | Deploying the Workbook resource |
| Arc server subscriptions | Reader | Inventory, extension, tag, policy, guest config, and update queries |
| Log Analytics workspace | Log Analytics Reader | OS Changes and OS Inventory tabs |

Viewers do not need deployment rights. They only need read access to the Workbook and the data sources it queries.

## Deploy with inline parameters

```powershell
az deployment group create `
  --resource-group <resource-group> `
  --template-file infra/main.bicep `
  --parameters workbookDisplayName='Arc Drift Dashboard' `
               logAnalyticsWorkspaceId='/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.OperationalInsights/workspaces/<workspace>'
```

## Deploy with a parameter file

Copy the sample parameter file:

```powershell
Copy-Item infra/main.sample.bicepparam infra/main.bicepparam
```

Edit `infra/main.bicepparam`, then deploy:

```powershell
az deployment group create `
  --resource-group <resource-group> `
  --parameters infra/main.bicepparam
```

## Stable Workbook resource name

The Workbook's friendly display name is controlled by `workbookDisplayName`.

The ARM resource name is controlled by `workbookId`. If omitted, Bicep creates a deterministic GUID from the resource group ID and display name:

```bicep
param workbookId string = guid(resourceGroup().id, workbookDisplayName)
```

Set `workbookId` explicitly when you want a predictable URL or when you want to update an existing Workbook resource:

```powershell
az deployment group create `
  --resource-group <resource-group> `
  --template-file infra/main.bicep `
  --parameters workbookDisplayName='Arc Drift Dashboard' `
               workbookId='arc-drift-dashboard' `
               logAnalyticsWorkspaceId='<workspace-resource-id>'
```

Changing `workbookId` creates a new Workbook resource.

## Validate data before demo

Use these checks to confirm the data needed by each workbook area exists before opening the workbook.

### Arc machine inventory

```powershell
az graph query -q "resources | where type =~ 'microsoft.hybridcompute/machines' | summarize machines=count(), connected=countif(tostring(properties.status) =~ 'Connected')" -o table
```

### Change Tracking tables

```powershell
$workspaceId = '<workspace-customer-id>'

az monitor log-analytics query `
  -w $workspaceId `
  --analytics-query "ConfigurationChange | where TimeGenerated > ago(30d) | summarize Changes=count(), Computers=dcount(Computer), Last=max(TimeGenerated)" `
  -o table

az monitor log-analytics query `
  -w $workspaceId `
  --analytics-query "ConfigurationData | where TimeGenerated > ago(30d) | summarize Records=count(), Computers=dcount(Computer), Last=max(TimeGenerated)" `
  -o table
```

### Update Manager data

```powershell
az graph query -q "patchassessmentresources | summarize count() by type" -o table
```

### Policy and Machine Configuration data

```powershell
az graph query -q "policyresources | where type == 'microsoft.policyinsights/policystates' | summarize count() by tostring(properties.complianceState)" -o table

az graph query -q "guestconfigurationresources | summarize count() by type, tostring(properties.complianceStatus)" -o table
```

## Workbook tab prerequisites

| Tab | Required data |
| --- | --- |
| Overview | Arc machine resources in Azure Resource Graph |
| Priority | Arc machine resources, extension resources, Change Tracking, and Heartbeat data |
| Machine Detail | Same sources as Priority, filtered by machine name |
| Policy | `policyresources` policy state rows for Arc machines |
| Machine Config | `guestconfigurationresources` assignment rows |
| Extensions/Tags | Arc machine and extension resources in `resources` |
| Updates | `patchassessmentresources` software patch assessment rows |
| Defender | `ConfigurationData` Defender Antivirus software inventory and `Heartbeat` rows in the selected workspace |
| OS Changes | `ConfigurationChange` rows in the selected Log Analytics workspace |
| App Config | `ConfigurationChange` plus tracked file/inventory rows where applicable |
| OS Inventory | `Heartbeat` and `ConfigurationData` rows in the selected workspace |

## Open the Workbook

After deployment, open **Azure Portal > Monitor > Workbooks > Arc Drift Dashboard**.

If the Workbook opens but a tab is empty, see [Troubleshooting](troubleshooting.md).

