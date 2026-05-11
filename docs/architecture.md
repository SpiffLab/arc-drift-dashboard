# Architecture

The Arc Drift Dashboard is an Azure Monitor Workbook deployed as an ARM resource. It is designed to surface configuration drift across Azure Arc-enabled servers by comparing observed state against an expected operational baseline and by showing recent in-OS changes. It reads from Azure Resource Graph for control-plane drift and Log Analytics for in-OS drift. There is no hosted application, database, middleware API, or custom identity to operate.

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
3. Azure Resource Graph tabs query Azure inventory and posture tables directly to expose baseline drift.
4. Log Analytics tabs query the selected workspace for Change Tracking, Inventory, and Heartbeat data to expose in-OS change drift.
5. Results are rendered client-side by Azure Monitor Workbooks as read-only drift views.

## Drift model

The workbook is organized around drift questions rather than raw inventory alone:

| Drift question | Workbook area |
| --- | --- |
| Which machines are connected, stale, or disconnected? | Overview, OS Inventory |
| Which machines are missing required operational extensions? | Extensions / Tags |
| Which machines are missing required metadata? | Extensions / Tags |
| Which machines are non-compliant with governance baselines? | Policy, Machine Config |
| Which machines have patch posture drift? | Updates |
| Which machines have security posture drift? | Defender |
| What changed inside the operating system? | OS Changes, App Config |

## Drift sources, mapped to data planes

| Tab in the workbook | Drift focus | Data plane | Backing table(s) |
| --- | --- | --- |
| Overview | Fleet state and connectivity drift | ARG | `resources` (`microsoft.hybridcompute/machines` + `.../extensions`) |
| Policy | Governance baseline drift | ARG | `policyresources` (`microsoft.policyinsights/policystates`) |
| Machine Config | Guest configuration baseline drift | ARG | `guestconfigurationresources` |
| Extensions / Tags | Required extension and metadata drift | ARG | `resources` |
| Updates | Patch posture drift | ARG | `patchassessmentresources` for Arc machines and Azure VMs |
| Defender | Security posture drift | ARG | `securityresources` (`microsoft.security/assessments`) |
| OS Changes | In-OS change drift | LA | `ConfigurationChange` |
| OS Inventory | Inventory and heartbeat drift | LA | `Heartbeat`, `ConfigurationData` |

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
