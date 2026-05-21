# Contributing

The Arc Drift Dashboard is built to be copied, modified, and extended. Contributions are welcome — whether that's a new drift detection query, a workbook tile, a fix, or documentation.

## Quick orientation

```
workbooks/      Azure Monitor Workbook JSON — the portal visual source of truth
queries/arg/    Standalone ARG queries (run in Azure Portal > Resource Graph Explorer)
queries/kql/    Standalone LA KQL queries (run in Azure Portal > Log Analytics)
infra/          Bicep deployment
policies/       Reference Azure Policy initiative
docs/           Architecture, deployment, customization, and troubleshooting
```

## Workbook editing workflow

The recommended flow keeps source control as the source of truth:

1. Edit `workbooks/arc-drift-dashboard.workbook.json`.
2. Validate JSON:
   ```powershell
   node -e "JSON.parse(require('fs').readFileSync('workbooks/arc-drift-dashboard.workbook.json','utf8')); console.log('ok')"
   ```
3. Build Bicep to catch template errors:
   ```powershell
   az bicep build --file infra/main.bicep --outfile $env:TEMP\arc-drift.json
   ```
4. Deploy to your test resource group and verify in the portal.
5. Open a pull request.

### Alternative: edit in the portal first

1. Open the workbook, click **Edit** → **Advanced Editor**, make changes, copy JSON.
2. Paste into `workbooks/arc-drift-dashboard.workbook.json`.
3. Validate and PR as above.

> Avoid portal-only edits that are not synced back — they will be overwritten on the next deployment.

## Adding a new drift detection

1. **Write the query** as a standalone `.kql` file in the appropriate folder:
   - Control-plane drift (tags, extensions, policy, guest config, RBAC) → `queries/arg/`
   - In-OS drift (files, registry, services, software) → `queries/kql/`
2. **Test it** in Resource Graph Explorer or Log Analytics before embedding in the workbook.
3. **Add a workbook tile**: copy an existing tile from the workbook JSON and update the query, name, and title fields.
4. **Update docs**: add a row to the drift model table in `docs/architecture.md` and a customization note in `docs/customization.md` if the baseline is user-adjustable.
5. **Update the README** drift table if it's a significant new category.

## KQL anti-patterns — read before writing queries

These are the most common bugs found in this codebase. The CI will catch some of them.

### ❌ `let` in ARG queries
Azure Resource Graph does **not** support `let` statements. Queries in `queries/arg/` must not use `let`. Use inline subqueries or `extend` instead.

```kql
// ❌ Will fail in ARG at runtime:
let foo = 'bar';
resources | where name =~ foo

// ✅ Correct:
resources | where name =~ 'bar'
```

### ❌ `split()` without `tolower()` in ARG
Resource IDs in ARG use mixed case (e.g. `Microsoft.GuestConfiguration`). `split()` is case-sensitive. Always call `tolower()` on the ID before splitting.

```kql
// ❌ Returns wrong result when ID casing doesn't match:
| extend machineId = tostring(split(id, '/providers/Microsoft.GuestConfiguration')[0])

// ✅ Correct:
| extend machineId = tolower(tostring(split(tolower(id), '/providers/microsoft.guestconfiguration')[0]))
```

### ❌ Assuming extension presence means data is flowing
A machine can have the `ChangeTracking-Windows` extension installed and provisioned but still produce empty Change Tracking tables if there is no Data Collection Rule association (DCRA). Always check DCR coverage before concluding data is missing due to a bug.

### ❌ `mv-apply` and `set_difference` in ARG
Neither `mv-apply` nor `set_difference` are supported in Azure Resource Graph. Express set operations as `array_index_of()` boolean columns instead.

## CI checks

The GitHub Actions workflow (`.github/workflows/validate.yml`) runs on every PR and push to `main`:

- **Bicep build**: compiles `infra/main.bicep` to catch template errors
- **Workbook JSON**: validates all `.json` files in `workbooks/` and `policies/` parse cleanly
- **KQL non-empty**: every `.kql` file in `queries/` must be non-empty
- **ARG `let` guard**: ARG queries must not use `let` statements
- **ARG split safety**: warns when `split()` is used without an adjacent `tolower()`

All checks must pass before merging.

## Commit style

Short imperative subject line, e.g.:

```
Add privileged group membership tile to OS Changes tab
Fix split() casing bug in guestconfig-assignments query
Update after-hours detection to use configurable maintenance window
```
