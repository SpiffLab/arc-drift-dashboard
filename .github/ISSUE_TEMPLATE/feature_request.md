---
name: Feature request
about: Suggest a new drift detection, tab, tile, or query improvement
labels: enhancement
---

## What drift scenario does this address?
<!-- Describe what configuration state change or anomaly you want to detect. -->
<!-- Example: "Detect when a Linux machine's sshd_config PermitRootLogin is changed to 'yes'" -->

## Which industry-tool pattern does this resemble? (optional)
<!-- e.g. Tripwire file integrity check, AWS Config rule, Chef InSpec control, Wazuh rule -->

## Where in the workbook should this appear?
<!-- Tab name and approximate position (e.g. "OS Changes tab, after Sensitive Changes table") -->

## Proposed KQL sketch (optional)
<!-- A rough query — even pseudocode helps. We can refine it. -->
```kql

```

## Data source
- [ ] Azure Resource Graph (control-plane: tags, extensions, policy, guest config, RBAC)
- [ ] Log Analytics — ConfigurationChange (in-OS: files, registry, services, software)
- [ ] Log Analytics — ConfigurationData (inventory: software list, heartbeat)
- [ ] Log Analytics — Heartbeat
- [ ] ARG resourcechanges (resource property change history)
- [ ] Other:

## Priority / use case
<!-- Who benefits from this? Compliance team, SOC, platform ops? How often would this fire? -->
