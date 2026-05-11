# Troubleshooting

## OS Changes tab is empty

The OS Changes tab requires `ConfigurationChange` data in the selected Log Analytics workspace.

Check the table:

```powershell
az monitor log-analytics query `
  -w <workspace-customer-id> `
  --analytics-query "ConfigurationChange | where TimeGenerated > ago(30d) | summarize Changes=count(), Computers=dcount(Computer), Last=max(TimeGenerated)" `
  -o table
```

If the table does not exist or returns no rows:

- Confirm Change Tracking and Inventory is enabled.
- Confirm the target machines have the Change Tracking extension.
- Confirm machines are associated with the Change Tracking data collection rule.
- Confirm the Workbook is pointed at the workspace receiving Change Tracking data.

## OS Inventory tab reports an `OSType` error

`ConfigurationData` does not always include `OSType`. The Workbook derives OS from `Heartbeat` and joins it to inventory data. If you customize OS Inventory queries, do not filter `ConfigurationData` directly on `OSType` unless your workspace schema has that column.

Use this pattern instead:

```kusto
let _osMap = Heartbeat
| summarize arg_max(TimeGenerated, OSType) by Computer
| project Computer, _OSType = OSType;
ConfigurationData
| lookup kind=leftouter _osMap on Computer
| where '{OSFilter}' == 'All' or _OSType =~ '{OSFilter}'
```

## Updates tab is empty

The Updates tab reads Azure Update Manager patch assessment rows from `patchassessmentresources`.

Check available rows:

```powershell
az graph query -q "patchassessmentresources | summarize count() by type" -o table
```

If no rows exist, run or schedule an Update Manager assessment for the target machines. If only Azure VM rows exist, the Workbook can still show them because it supports both Arc machine and Azure VM patch assessment resource types.

## Defender tab is empty

The Defender tab requires Defender for Cloud recommendations and appropriate RBAC.

Check:

```powershell
az graph query -q "securityresources | where type =~ 'microsoft.security/assessments' | take 5" -o table
```

If data exists but the Workbook is empty, confirm the viewer has Security Reader at the right scope.

## Policy or Machine Config tabs are empty

These tabs depend on assignments existing in the selected scope.

Check policy state:

```powershell
az graph query -q "policyresources | where type =~ 'microsoft.policyinsights/policystates' | take 5" -o table
```

Check machine configuration:

```powershell
az graph query -q "guestconfigurationresources | take 5" -o table
```

## Workbook opens but parameters are blank

Confirm the deployment used a valid workspace resource ID:

```powershell
az resource show `
  --ids <workbook-resource-id> `
  --api-version 2023-06-01 `
  --query "properties.sourceId" `
  -o tsv
```

Redeploy with the correct `logAnalyticsWorkspaceId` if needed.

