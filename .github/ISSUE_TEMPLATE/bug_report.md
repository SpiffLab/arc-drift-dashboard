---
name: Bug report
about: A workbook tab is empty, showing wrong data, or producing an error
labels: bug
---

## Which tab / tile is affected?
<!-- e.g. "OS Changes > After-Hours Changes table", "Overview > DCR Coverage tile" -->

## What did you expect to see?

## What do you see instead?
<!-- Screenshot or error text if available -->

## Data prerequisites check
Before filing a bug, confirm the following for the affected tab:

| Prerequisite | Checked? |
|---|---|
| Arc machines are onboarded and visible in the selected subscription scope | ☐ |
| Viewer has **Reader** on the subscription(s) | ☐ |
| Viewer has **Log Analytics Reader** on the workspace | ☐ |
| The Log Analytics workspace is selected in the **Workspace** parameter | ☐ |
| For Change Tracking tabs: AMA + ChangeTracking extensions are installed | ☐ |
| For Change Tracking tabs: a DCR association exists for the machine(s) | ☐ |
| For Machine Config tab: GuestConfiguration extension is installed | ☐ |
| For Updates tab: Update Manager patch assessment has run | ☐ |

See [docs/troubleshooting.md](../docs/troubleshooting.md) for diagnostic steps.

## Environment
- Workbook version / commit: <!-- git log --oneline -1 -->
- Azure region(s):
- OS type(s) affected (Windows / Linux / Both):
- Arc agent version (if known):
