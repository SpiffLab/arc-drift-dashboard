# Arc Drift Dashboard

An Azure-native dashboard for surfacing configuration drift across Azure Arc-enabled servers. It is delivered as an Azure Monitor Workbook plus supporting Azure Resource Graph (ARG), Log Analytics KQL, Bicep deployment, and a reference Azure Policy initiative.

The goal is to help operations and platform teams quickly answer: **what changed, what no longer matches the expected baseline, and which machines need attention first?**

The workbook is intentionally lightweight: no app hosting, no database, no custom identity, and no external service. Viewers use their own Entra identity and see only what Azure RBAC allows them to see.

## Screenshots

Screenshots below are captured from a live Azure Portal deployment with **TimeRange = Last 7 days** and cropped to the workbook canvas.

| Overview | Extensions and tags |
| --- | --- |
| ![Overview tab showing Arc machine connection state and drift summary charts](docs/screenshots/overview.png) | ![Extensions and tags tab showing required extension and tag baseline drift](docs/screenshots/extensions-tags.png) |

| Updates | OS Changes |
| --- | --- |
| ![Updates tab showing pending patch classification and machine-level patch posture](docs/screenshots/updates.png) | ![OS Changes tab showing Change Tracking drift by change type](docs/screenshots/os-changes.png) |

**OS Inventory**

![OS Inventory tab showing software inventory and heartbeat freshness](docs/screenshots/os-inventory.png)

## What "drift" means here

This dashboard surfaces two practical kinds of drift:

- **Baseline drift**: a machine no longer matches the expected operational baseline, such as required tags, required extensions, policy assignments, machine configuration, patch posture, or Defender recommendations.
- **Change drift**: files, registry keys, services, software, or daemons changed inside the OS, as reported by Change Tracking and Inventory.

It does not remediate drift directly. It gives teams a read-only, RBAC-scoped view of where drift exists so they can investigate and remediate through their standard operational processes.

## What it detects

### Priority and drill-through

| View | Purpose |
| --- | --- |
| Priority | Scores machines so teams can investigate the highest-risk drift first. Baseline score uses connectivity, required tags, required extensions, and extension provisioning state. Change score uses Change Tracking volume, sensitive changes, and after-hours changes. |
| Machine Detail | Drill-through page for one machine selected from a machine-profile dropdown or from the Priority tab. Shows profile, tag/extension posture, policy failures, machine configuration failures, pending updates, heartbeat freshness, and recent in-OS changes. |

### Azure control-plane drift

| Source | Drift surfaced |
| --- | --- |
| Azure Resource Graph inventory | Machines that are disconnected, stale, or different from the expected fleet shape |
| Azure Policy | Machines drifting from assigned policy and initiative requirements |
| Machine Configuration | Guest configuration assignments that are non-compliant or not reporting cleanly |
| Tags and extensions | Missing required metadata or operational extensions |
| Update Manager | Patch posture drift by classification, severity, and machine |
| Defender for Cloud | Security posture drift through open recommendations scoped to hybrid machines, plus Defender extension, security intelligence, and antimalware platform version drift where inventory data exists |

### In-OS drift

| Source | Drift surfaced |
| --- | --- |
| Change Tracking and Inventory | File, registry, service, software, and daemon changes from `ConfigurationChange` |
| Inventory collection | Software, services, daemons, files, and heartbeat freshness drift from `ConfigurationData` and `Heartbeat` |
| App Config tab | Incident-window drift, sensitive configuration changes, and fleet-level file hash differences |

## Repository layout

```text
workbooks/      Azure Monitor Workbook JSON template
queries/arg/    Standalone Azure Resource Graph queries
queries/kql/    Standalone Log Analytics KQL queries
infra/          Bicep deployment files
policies/       Reference Azure Policy initiative for an Arc baseline
docs/           Architecture, deployment, customization, and troubleshooting
```

## Quick deploy

Prerequisites:

- Azure CLI signed into the target tenant
- A resource group to host the workbook
- A Log Analytics workspace receiving Arc / AMA / Change Tracking data
- Reader access to the subscriptions that contain Arc-enabled servers

```powershell
az deployment group create `
  --resource-group <resource-group> `
  --template-file infra/main.bicep `
  --parameters workbookDisplayName='Arc Drift Dashboard' `
               logAnalyticsWorkspaceId='/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.OperationalInsights/workspaces/<workspace>'
```

After deployment, open **Azure Portal > Monitor > Workbooks > Arc Drift Dashboard**.

See [Deployment guide](docs/deployment.md) for detailed setup, RBAC, validation, and troubleshooting steps.

## Customization

The default drift baseline is intentionally simple and easy to modify:

- Required tags: `environment`, `owner`, `costCenter`, `dataClassification`
- Required extensions: Azure Monitor Agent, Change Tracking, Defender, and Azure Policy
- Update posture: Update Manager patch assessment data from Arc machines or Azure VMs
- OS drift: Change Tracking and Inventory tables in Log Analytics

See [Customization guide](docs/customization.md) for where to adjust baselines, labels, tabs, and KQL.

## Required RBAC

| Scope | Role | Why |
| --- | --- | --- |
| Subscription(s) with Arc machines | Reader | ARG inventory, policy state, guest config, update assessment |
| Log Analytics workspace | Log Analytics Reader | Change Tracking, inventory, heartbeat, and OS drift views |
| Defender for Cloud subscription scope | Security Reader | Defender recommendations |
| Workbook resource group | Workbook Reader or Reader | Open the workbook |

## Validation

```powershell
az bicep build --file infra/main.bicep --outfile $env:TEMP\arc-drift-main.json
node -e "JSON.parse(require('fs').readFileSync('workbooks/arc-drift-dashboard.workbook.json','utf8')); console.log('workbook json ok')"
```

## License

MIT - see [LICENSE](LICENSE).
