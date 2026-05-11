# Architecture

The Arc Drift Dashboard is an Azure Monitor Workbook deployed as an ARM resource. It reads from Azure Resource Graph for control-plane posture and Log Analytics for in-OS drift. There is no hosted application, database, middleware API, or custom identity to operate.

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│  Arc-enabled server (on-prem│         │  Azure control plane             │
│  / other cloud / edge)      │         │                                  │
│                             │         │  ┌───────────────────────────┐   │
│  ┌───────────────────────┐  │  ARM    │  │ Azure Resource Manager    │   │
│  │ Connected Machine     │──┼────────►│  │ + Resource Graph cache    │   │
│  │ Agent (azcmagent)     │  │         │  └───────────────────────────┘   │
│  └───────────────────────┘  │         │                                  │
│  ┌───────────────────────┐  │         │  ┌───────────────────────────┐   │
│  │ AMA + Change Tracking │──┼─────────┼─►│ Log Analytics workspace   │   │
│  │ extension             │  │         │  │ (ConfigurationChange,     │   │
│  └───────────────────────┘  │         │  │  ConfigurationData,       │   │
│  ┌───────────────────────┐  │         │  │  Heartbeat, …)            │   │
│  │ Guest Configuration   │──┼─────────┼─►│ ↑ guestconfig assignments │   │
│  │ extension (DSC v3)    │  │         │  └───────────────────────────┘   │
│  └───────────────────────┘  │         │                                  │
└─────────────────────────────┘         │  Policy / Defender / Update Mgr  │
                                        │  (consumed via Resource Graph    │
                                        │   tables: policyresources,       │
                                        │   securityresources,             │
                                        │   patchassessmentresources)      │
                                        └──────────────┬───────────────────┘
                                                       │
                                                       ▼
                                        ┌──────────────────────────────────┐
                                        │  Azure Monitor Workbook          │
                                        │  (this repo) — read-only,        │
                                        │  RBAC-scoped, no extra compute   │
                                        └──────────────────────────────────┘
```

## Why a Workbook (and nothing else)

- **Zero hosting**: the Workbook is an ARM resource. There's no app to run, no identity to manage, no certs to rotate.
- **Auth is solved**: viewers authenticate to the Azure portal with Entra. RBAC on the subscription / workspace / Defender plan controls what they see.
- **Mixes data sources natively**: Resource Graph (`queryType: 1`) and Log Analytics (`queryType: 0`) co-exist in one Workbook. We use ARG for everything control-plane and LA for everything in-OS.
- **Source-controllable**: `serializedData` is the same JSON you can edit in the portal "Advanced editor", so this repo is the source of truth and `az deployment group create` re-applies it.

## Query flow

1. The viewer opens the Workbook in Azure Portal.
2. Workbook parameters select subscription scope, Log Analytics workspace, time range, and OS filter.
3. Azure Resource Graph tabs query Azure inventory and posture tables directly.
4. Log Analytics tabs query the selected workspace for Change Tracking, Inventory, and Heartbeat data.
5. Results are rendered client-side by Azure Monitor Workbooks.

## Drift sources, mapped to data planes

| Tab in the workbook | Data plane | Backing table(s) |
| --- | --- | --- |
| Overview | ARG | `resources` (`microsoft.hybridcompute/machines` + `…/extensions`) |
| Policy | ARG | `policyresources` (`microsoft.policyinsights/policystates`) |
| Machine Config | ARG | `guestconfigurationresources` |
| Extensions / Tags | ARG | `resources` |
| Updates | ARG | `patchassessmentresources` for Arc machines and Azure VMs |
| Defender | ARG | `securityresources` (`microsoft.security/assessments`) |
| OS Changes | LA | `ConfigurationChange` |
| OS Inventory | LA | `Heartbeat`, `ConfigurationData` |

## Required RBAC for viewers

| Scope | Role | Why |
| --- | --- | --- |
| Subscription(s) with Arc machines | `Reader` | ARG for inventory, policy, guest config, update assessment |
| Log Analytics workspace | `Log Analytics Reader` | Change Tracking, Heartbeat, inventory |
| Subscription with Defender plan | `Security Reader` | Defender for Cloud recommendations |
| Resource group hosting the workbook | `Workbook Reader` | Open the workbook itself |

## Data freshness considerations

- Azure Resource Graph data is eventually consistent with Azure Resource Manager.
- `ConfigurationChange` and `ConfigurationData` depend on Change Tracking and Inventory collection frequency.
- Update Manager rows appear after patch assessment has run for the machine.
- Defender and Policy tabs only populate when those services are configured and the viewer has the required role.
