# arc-drift-dashboard

An **Azure-native drift detection dashboard** for Azure Arc–enabled servers, delivered as an
Azure Monitor Workbook plus the supporting KQL / ARG queries, Bicep deployment, and reference
Azure Policy initiative. No external compute, no app code — auth and RBAC are inherited from
the Azure resource the Workbook is saved into.

## What it detects

### Azure control-plane drift
| Source | What it surfaces |
| --- | --- |
| **Azure Policy** compliance state | Non-compliant Arc machines vs. assigned policies / initiatives |
| **Azure Resource Graph** baseline diff | Resource property drift (location, SKU, tags, extension set) vs. an expected baseline |
| **Machine Configuration** (guest config) assignments | Assignment status + last reported compliance per machine |
| **Tags / extensions installed** | Missing required tags, missing/unexpected Arc extensions (AMA, MDE, MCfg, …) |
| **Update Manager** patch compliance | Pending / failed patches per machine |
| **Defender for Cloud** recommendations | Open recommendations scoped to `Microsoft.HybridCompute/machines` |

### In-OS drift (via the Arc agent)
| Source | What it surfaces |
| --- | --- |
| **Change Tracking & Inventory** | File / registry / service / software / daemon changes from the `ConfigurationChange` and `ConfigurationData` tables |
| **AMA + custom KQL** | Any Log Analytics query you point at `Heartbeat`, `Event`, `Syslog`, `Perf`, `ConfigurationChange`, etc. |

## Repository layout

```
workbooks/      Azure Monitor Workbook gallery templates (JSON)
queries/arg/    Standalone Resource Graph (KQL) queries — also embedded in the workbook
queries/kql/    Standalone Log Analytics (KQL) queries — also embedded in the workbook
infra/          Bicep to deploy the workbook (and optionally the policy initiative)
policies/       Reference Azure Policy initiative for an Arc baseline
docs/           Architecture and authoring notes
```

## Deploy

Prereqs: an Azure subscription, a resource group, and a Log Analytics workspace that already
receives data from Change Tracking and AMA on your Arc machines.

```powershell
az deployment group create `
  --resource-group <rg> `
  --template-file infra/main.bicep `
  --parameters workbookDisplayName='Arc Drift Dashboard' `
               logAnalyticsWorkspaceId='/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.OperationalInsights/workspaces/<ws>'
```

After deploy, open **Azure Monitor → Workbooks → Arc Drift Dashboard**.

## Auth

Whoever opens the workbook uses their own Entra identity. Required RBAC at the relevant scope:

- `Reader` on the subscription(s) for Resource Graph and inventory
- `Log Analytics Reader` on the workspace
- `Security Reader` if you want the Defender for Cloud tab to populate

## License

MIT — see [LICENSE](LICENSE).
