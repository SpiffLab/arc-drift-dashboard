# Customization guide

The Arc Drift Dashboard is designed to be copied, changed, and redeployed. The Workbook JSON is the source of truth for portal visuals; the standalone files under `queries/` make the important KQL easier to review and test.

Most customization is about defining what "expected state" means for your environment. Once that baseline is defined, the workbook surfaces machines that drift from it.

## Priority scoring

The `Priority` tab is intentionally opinionated but easy to tune. It has two scores:

- **Baseline drift score**: connection state, missing required tags, missing required extensions, and extension provisioning failures.
- **Change drift score**: recent Change Tracking volume, sensitive files/registry/services/daemons, and after-hours changes.

The baseline score intentionally uses Arc resource inventory, tags, extensions, and extension provisioning state so it works in one Azure Resource Graph workbook query. Policy, Machine Configuration, Update Manager, and Defender each have dedicated tabs because Azure Resource Graph limits which service-specific tables can be combined in a single workbook query.

Adjust the score weights in `workbooks/arc-drift-dashboard.workbook.json` in the `table-baseline-priority` and `table-change-priority` queries. For example, increase `missingExtensions * 10` if required extensions should dominate, or reduce `afterHoursChanges * 3` if after-hours changes are expected in your maintenance windows.

## Machine drill-through

The `Machine Detail` tab uses the `MachineName` workbook parameter. Users can select a machine profile from a dropdown populated by Azure Resource Graph, or click a machine name from the `Priority` tab. The drill-through view combines ARG baseline posture with Log Analytics heartbeat and Change Tracking data.

If customers have duplicate hostnames across environments, extend the filter to include resource group, subscription, or `_ResourceId` so drill-through is unique.

## Baseline tags

Tag drift is implemented in:

- `queries/arg/tag-drift.kql`
- the `Extensions/Tags` tab inside `workbooks/arc-drift-dashboard.workbook.json`

Default required tags:

- `environment`
- `owner`
- `costCenter`
- `dataClassification`

To add or remove required tags, update the `has<TagName>` columns and the `missingCount` calculation. This controls what the dashboard treats as metadata drift.

## Required extensions

Extension drift is implemented in:

- `queries/arg/extension-drift.kql`
- the `Extensions/Tags` tab inside `workbooks/arc-drift-dashboard.workbook.json`

Default checks include:

- Azure Monitor Agent
- Change Tracking
- Defender extension
- Azure Policy extension

Extension resource names differ by OS. Keep Windows and Linux checks separate when adding new required extensions. This controls what the dashboard treats as operational extension drift.

## Update Manager

The Updates tab reads `patchassessmentresources` from Azure Resource Graph and surfaces patch posture drift. It supports both:

- `Microsoft.HybridCompute/machines/.../patchAssessmentResults/softwarePatches`
- `Microsoft.Compute/virtualMachines/.../patchAssessmentResults/softwarePatches`

This lets the Workbook show patch posture for Arc-enabled servers and Azure VMs when both exist in the same estate.

## Defender

The Defender tab includes two kinds of drift:

- **Security posture drift** from Defender for Cloud recommendations in Azure Resource Graph.
- **Client/rules drift** from MDE Arc extension resources and Defender Antivirus software inventory in `ConfigurationData`.

The security intelligence and antimalware platform version views depend on Change Tracking and Inventory collecting software inventory. If those panels are empty, confirm the selected Log Analytics workspace contains `ConfigurationData` rows with software names like `Security Intelligence Update for Microsoft Defender Antivirus` or `Update for Microsoft Defender Antivirus antimalware platform`.

## OS Changes

The OS Changes tab uses `ConfigurationChange` to surface in-OS change drift.

Common useful customizations:

- Change the default `TimeRange` parameter.
- Add or remove sensitive paths in the App Config tab.
- Filter noise from known software publishers.
- Add organization-specific service names that should be highlighted.

## OS Inventory

The OS Inventory tab uses `ConfigurationData` and `Heartbeat` to surface inventory, software, and heartbeat drift.

`ConfigurationData` does not always contain an OS column, so the Workbook derives OS from `Heartbeat` and joins by computer name. If your environment has duplicate computer names across workspaces, scope the Workbook to the appropriate workspace or adjust the join to include `_ResourceId` where available.

## Workbook editing workflow

1. Edit `workbooks/arc-drift-dashboard.workbook.json`.
2. Validate JSON:

   ```powershell
   node -e "JSON.parse(require('fs').readFileSync('workbooks/arc-drift-dashboard.workbook.json','utf8')); console.log('workbook json ok')"
   ```

3. Build Bicep:

   ```powershell
   az bicep build --file infra/main.bicep --outfile $env:TEMP\arc-drift-main.json
   ```

4. Redeploy:

   ```powershell
   az deployment group create `
     --resource-group <resource-group> `
     --template-file infra/main.bicep `
     --parameters workbookDisplayName='Arc Drift Dashboard' `
                  logAnalyticsWorkspaceId='<workspace-resource-id>'
   ```

## Advanced editor export

You can also make changes in Azure Portal:

1. Open the Workbook.
2. Select **Edit**.
3. Select **Advanced Editor**.
4. Copy the JSON back into `workbooks/arc-drift-dashboard.workbook.json`.
5. Validate and redeploy from source control.

Avoid making portal-only edits that are not copied back to the repo; they will be overwritten on the next deployment.

