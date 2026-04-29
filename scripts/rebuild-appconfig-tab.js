#!/usr/bin/env node
// Rewrite the App Config tab as an incident-response surface:
//   - Anchor parameters (IncidentTime + IncidentWindow)
//   - Summary tiles
//   - Change timeline (when did things start changing?)
//   - Per-machine change density (which machine got hit?)
//   - Service / daemon state flips (what stopped or restarted?)
//   - Software install / upgrade / removal (what got patched?)
//   - File modifications with size + checksum diff
//   - Registry changes
//   - Fleet drift baseline (carried over from prior version)

const fs = require('fs');
const path = require('path');
const wbPath = path.join(__dirname, '..', 'workbooks', 'arc-drift-dashboard.workbook.json');
const wb = JSON.parse(fs.readFileSync(wbPath, 'utf8'));

const OS_MAP = "let _osMap = Heartbeat | where isnotempty(_ResourceId) | summarize arg_max(TimeGenerated, OSType) by _ResourceId | project _ResourceId, _OSType = OSType;\n";
const WINDOW_FILTER = "| where TimeGenerated between (({IncidentTime}) - {IncidentWindow} .. ({IncidentTime}))\n";
const OS_LOOKUP = "| lookup kind=leftouter _osMap on _ResourceId\n| where '{OSFilter}' == 'All' or _OSType =~ '{OSFilter}'\n";
// Universal noise filters applied to ConfigurationChange panels.
// Uses dynamic([...]) + array_index_of so an empty multi-select substitutes
// as `dynamic([])` (a valid empty array) instead of producing a stray comma.
// For the regex pattern we use iif(isempty(...), '[^\\s\\S]', ...) so an
// empty pattern resolves to a never-matching constant — KQL otherwise
// rejects empty regex arguments at parse time even behind a short-circuit.
const NOISE_FILTER =
  "| extend ChangeKind = case(\n" +
  "    isnotempty(ConfigChangeType), tostring(ConfigChangeType),\n" +
  "    isnotempty(SoftwareName), 'Software',\n" +
  "    isnotempty(SvcName), 'Services',\n" +
  "    isnotempty(FileSystemPath), 'Files',\n" +
  "    isnotempty(RegistryKey), 'Registry',\n" +
  "    'Other')\n" +
  "| where array_index_of(dynamic([{ExcludeChangeTypes}]), ChangeKind) == -1\n" +
  "| where isempty(Publisher) or array_index_of(dynamic([{ExcludePublishers}]), tostring(Publisher)) == -1\n" +
  "| where not(tolower(coalesce(FileSystemPath, RegistryKey, SvcName, '')) matches regex iif(isempty('{ExcludePattern}'), '[^\\\\s\\\\S]', tolower('{ExcludePattern}')))\n" +
  "| where array_index_of(dynamic([{ExcludeMachines}]), tostring(Computer)) == -1\n";
// Slimmer filter for ConfigurationData (no ConfigChangeType / Publisher / SvcName cols).
const NOISE_FILTER_INVENTORY =
  "| where not(tolower(FileSystemPath) matches regex iif(isempty('{ExcludePattern}'), '[^\\\\s\\\\S]', tolower('{ExcludePattern}')))\n" +
  "| where array_index_of(dynamic([{ExcludeMachines}]), tostring(Computer)) == -1\n";

const LOGS_LINK_FORMATTER = (kqlTemplate) => ({
  columnMatch: "TimeGenerated",
  formatter: 7,
  formatOptions: {
    linkTarget: "OpenBlade",
    linkIsContextBlade: false,
    bladeOpenContext: {
      bladeName: "LogsBlade",
      extensionName: "Microsoft_OperationsManagementSuite_Workspace",
      bladeParameters: [
        { name: "resourceId", source: "static", value: "{LogAnalyticsWorkspace}" },
        { name: "query", source: "static", value: kqlTemplate }
      ]
    }
  }
});

const newItems = [
  {
    type: 1,
    content: {
      json: "## Application configuration drift — incident response\n\nUse this tab during or after an outage to find **what changed**. Set the **incident time** to when the symptom started (defaults to now) and the **window** to look backward. Every panel below scopes to that window.\n\n> Coverage depends on your Change Tracking DCR rules. If File / Registry sections look empty, your DCR isn't tracking those paths. Software, Services, and Daemons are tracked by default."
    },
    name: "appconfig-help"
  },

  {
    type: 9,
    content: {
      version: "KqlParameterItem/1.0",
      parameters: [
        {
          id: "appconfig-incident-time",
          version: "KqlParameterItem/1.0",
          name: "IncidentTime",
          label: "Incident time",
          type: 1,
          isRequired: true,
          value: "now()",
          description: "When did symptoms start? Defaults to now(). Override with e.g. datetime(2026-04-29 14:30) or now() - 2h."
        },
        {
          id: "appconfig-incident-window",
          version: "KqlParameterItem/1.0",
          name: "IncidentWindow",
          label: "Look back",
          type: 2,
          isRequired: true,
          typeSettings: { additionalResourceOptions: [] },
          jsonData: "[\n    {\"value\":\"15m\", \"label\":\"15 min\"},\n    {\"value\":\"1h\",  \"label\":\"1 hour\"},\n    {\"value\":\"4h\",  \"label\":\"4 hours\", \"selected\":true},\n    {\"value\":\"12h\", \"label\":\"12 hours\"},\n    {\"value\":\"24h\", \"label\":\"24 hours\"},\n    {\"value\":\"3d\",  \"label\":\"3 days\"},\n    {\"value\":\"7d\",  \"label\":\"7 days\"}\n]"
        },
        {
          id: "appconfig-exclude-types",
          version: "KqlParameterItem/1.0",
          name: "ExcludeChangeTypes",
          label: "Exclude change types",
          type: 2,
          multiSelect: true,
          quote: "'",
          delimiter: ",",
          typeSettings: { additionalResourceOptions: [], showDefault: false },
          jsonData: "[\n    {\"value\":\"Files\"},\n    {\"value\":\"Registry\"},\n    {\"value\":\"WindowsServices\"},\n    {\"value\":\"Services\"},\n    {\"value\":\"Daemons\"},\n    {\"value\":\"Software\"},\n    {\"value\":\"Other\"}\n]",
          description: "Mute entire categories. Useful when one type drowns out the rest."
        },
        {
          id: "appconfig-exclude-machines",
          version: "KqlParameterItem/1.0",
          name: "ExcludeMachines",
          label: "Exclude machines",
          type: 2,
          multiSelect: true,
          quote: "'",
          delimiter: ",",
          typeSettings: { additionalResourceOptions: [], showDefault: false },
          query: "Heartbeat | where TimeGenerated > ago(7d) | summarize by Computer | order by Computer asc",
          queryType: 0,
          resourceType: "microsoft.operationalinsights/workspaces",
          crossComponentResources: ["{LogAnalyticsWorkspace}"],
          description: "Hide changes from specific machines (e.g. known-noisy build agents)."
        },
        {
          id: "appconfig-exclude-publishers",
          version: "KqlParameterItem/1.0",
          name: "ExcludePublishers",
          label: "Exclude publishers",
          type: 2,
          multiSelect: true,
          quote: "'",
          delimiter: ",",
          typeSettings: { additionalResourceOptions: [], showDefault: false },
          query: "ConfigurationChange | where TimeGenerated > ago(7d) | where ConfigChangeType == 'Software' | where isnotempty(Publisher) | summarize count() by Publisher | order by count_ desc | project Publisher",
          queryType: 0,
          resourceType: "microsoft.operationalinsights/workspaces",
          crossComponentResources: ["{LogAnalyticsWorkspace}"],
          description: "Mute software changes from specific publishers (e.g. routine OS / agent updates)."
        },
        {
          id: "appconfig-exclude-pattern",
          version: "KqlParameterItem/1.0",
          name: "ExcludePattern",
          label: "Exclude path/key/svc regex",
          type: 1,
          isRequired: false,
          value: "",
          description: "Case-insensitive regex applied to FileSystemPath / RegistryKey / SvcName. Example: /var/log|/tmp|\\\\\\\\Windows\\\\\\\\Temp"
        }
      ],
      style: "pills",
      queryType: 0,
      resourceType: "microsoft.operationalinsights/workspaces"
    },
    name: "appconfig-params"
  },

  // ── Summary tiles ────────────────────────────────────────────────────────
  {
    type: 3,
    content: {
      version: "KqlItem/1.0",
      query: OS_MAP +
        "ConfigurationChange\n" +
        WINDOW_FILTER +
        OS_LOOKUP + NOISE_FILTER +
        "| summarize\n" +
        "    Total = count(),\n" +
        "    Files = countif(ConfigChangeType == 'Files'),\n" +
        "    Registry = countif(ConfigChangeType == 'Registry'),\n" +
        "    Services = countif(ConfigChangeType == 'WindowsServices'),\n" +
        "    Daemons = countif(ConfigChangeType == 'Daemons'),\n" +
        "    Software = countif(ConfigChangeType == 'Software'),\n" +
        "    Machines = dcount(Computer)",
      size: 4,
      title: "Changes in window",
      queryType: 0,
      resourceType: "microsoft.operationalinsights/workspaces",
      crossComponentResources: ["{LogAnalyticsWorkspace}"],
      visualization: "tiles",
      tileSettings: {
        showBorder: false,
        titleContent: { columnMatch: "Total", formatter: 12 }
      }
    },
    name: "appconfig-summary-tiles"
  },

  // ── Change timeline ──────────────────────────────────────────────────────
  {
    type: 3,
    content: {
      version: "KqlItem/1.0",
      query: OS_MAP +
        "ConfigurationChange\n" +
        WINDOW_FILTER +
        OS_LOOKUP + NOISE_FILTER +
        "| summarize count() by bin(TimeGenerated, case(\n" +
        "    '{IncidentWindow}' in ('15m','1h'), 1m,\n" +
        "    '{IncidentWindow}' == '4h', 5m,\n" +
        "    '{IncidentWindow}' == '12h', 15m,\n" +
        "    '{IncidentWindow}' == '24h', 30m,\n" +
        "    '{IncidentWindow}' == '3d', 1h,\n" +
        "    3h)), ChangeKind\n" +
        "| render timechart",
      size: 0,
      title: "Change timeline — when did things start changing?",
      queryType: 0,
      resourceType: "microsoft.operationalinsights/workspaces",
      crossComponentResources: ["{LogAnalyticsWorkspace}"],
      visualization: "timechart",
      chartSettings: { showLegend: true, ySettings: { numberFormatSettings: { unit: 17 } } }
    },
    customWidth: "60",
    name: "appconfig-timeline"
  },
  {
    type: 3,
    content: {
      version: "KqlItem/1.0",
      query: OS_MAP +
        "ConfigurationChange\n" +
        WINDOW_FILTER +
        OS_LOOKUP + NOISE_FILTER +
        "| summarize Changes = count() by Computer\n" +
        "| order by Changes desc\n" +
        "| take 15",
      size: 0,
      title: "Change density by machine — is this isolated?",
      queryType: 0,
      resourceType: "microsoft.operationalinsights/workspaces",
      crossComponentResources: ["{LogAnalyticsWorkspace}"],
      visualization: "barchart",
      chartSettings: { showLegend: false, xAxis: "Computer", yAxis: ["Changes"] }
    },
    customWidth: "40",
    name: "appconfig-by-machine"
  },

  // ── Service / daemon state flips ─────────────────────────────────────────
  {
    type: 3,
    content: {
      version: "KqlItem/1.0",
      query: OS_MAP +
        "ConfigurationChange\n" +
        WINDOW_FILTER +
        OS_LOOKUP + NOISE_FILTER +
        "| where ConfigChangeType in ('WindowsServices','Daemons')\n" +
        "| where SvcState != SvcPreviousState or SvcStartupType != SvcPreviousStartupType\n" +
        "| extend StateFlip = strcat(coalesce(SvcPreviousState,''), ' → ', coalesce(SvcState,''))\n" +
        "| extend StartupFlip = iif(SvcStartupType != SvcPreviousStartupType, strcat(coalesce(SvcPreviousStartupType,''), ' → ', coalesce(SvcStartupType,'')), '')\n" +
        "| project TimeGenerated, Computer, ConfigChangeType, SvcName, SvcDisplayName, StateFlip, StartupFlip, _ResourceId\n" +
        "| order by TimeGenerated desc",
      size: 0,
      title: "Service / daemon state changes — what stopped, started, or restarted?",
      noDataMessage: "No service or daemon state changes in this window.",
      queryType: 0,
      resourceType: "microsoft.operationalinsights/workspaces",
      crossComponentResources: ["{LogAnalyticsWorkspace}"],
      showExportToExcel: true,
      gridSettings: {
        formatters: [
          LOGS_LINK_FORMATTER(
            "ConfigurationChange\n| where TimeGenerated == datetime('${TimeGenerated}')\n| where Computer == '${Computer}'\n| where SvcName == '${SvcName}'"
          ),
          {
            columnMatch: "StateFlip",
            formatter: 4,
            formatOptions: {
              thresholdsOptions: "colors",
              thresholdsGrid: [
                { operator: "contains", thresholdValue: "Stopped", representation: "redBright", text: "{0}" },
                { operator: "contains", thresholdValue: "Running", representation: "green", text: "{0}" },
                { operator: "Default", representation: "orange", text: "{0}" }
              ]
            }
          }
        ]
      }
    },
    name: "appconfig-service-flips"
  },

  // ── Software install / upgrade / removal ─────────────────────────────────
  {
    type: 3,
    content: {
      version: "KqlItem/1.0",
      query: OS_MAP +
        "ConfigurationChange\n" +
        WINDOW_FILTER +
        OS_LOOKUP + NOISE_FILTER +
        "| where ConfigChangeType == 'Software'\n" +
        "| extend VersionFlip = case(\n" +
        "    ChangeCategory == 'Added', strcat('+ ', Current),\n" +
        "    ChangeCategory == 'Removed', strcat('- ', Previous),\n" +
        "    strcat(Previous, ' → ', Current))\n" +
        "| project TimeGenerated, Computer, ChangeCategory, SoftwareName, Publisher, VersionFlip, _ResourceId\n" +
        "| order by TimeGenerated desc",
      size: 0,
      title: "Software installs / upgrades / removals",
      noDataMessage: "No software changes in this window.",
      queryType: 0,
      resourceType: "microsoft.operationalinsights/workspaces",
      crossComponentResources: ["{LogAnalyticsWorkspace}"],
      showExportToExcel: true,
      gridSettings: {
        formatters: [
          LOGS_LINK_FORMATTER(
            "ConfigurationChange\n| where TimeGenerated == datetime('${TimeGenerated}')\n| where Computer == '${Computer}'\n| where SoftwareName == '${SoftwareName}'"
          ),
          {
            columnMatch: "ChangeCategory",
            formatter: 4,
            formatOptions: {
              thresholdsOptions: "colors",
              thresholdsGrid: [
                { operator: "==", thresholdValue: "Added", representation: "green", text: "Added" },
                { operator: "==", thresholdValue: "Removed", representation: "redBright", text: "Removed" },
                { operator: "==", thresholdValue: "Modified", representation: "orange", text: "Modified" },
                { operator: "Default", representation: "gray", text: "{0}" }
              ]
            }
          }
        ]
      }
    },
    name: "appconfig-software-changes"
  },

  // ── File modifications with diff ─────────────────────────────────────────
  {
    type: 3,
    content: {
      version: "KqlItem/1.0",
      query: OS_MAP +
        "ConfigurationChange\n" +
        WINDOW_FILTER +
        OS_LOOKUP + NOISE_FILTER +
        "| where ConfigChangeType == 'Files'\n" +
        "| extend SizeChange = iif(isnotnull(Size), tostring(Size), '')\n" +
        "| project TimeGenerated, Computer, ChangeCategory, FileSystemPath, FieldsChanged, Previous, Current, SizeChange, FileContentChecksum, _ResourceId\n" +
        "| order by TimeGenerated desc",
      size: 0,
      title: "File modifications — what was edited on disk?",
      noDataMessage: "No tracked file changes in this window. (Add file paths to your Change Tracking DCR if you expected results.)",
      queryType: 0,
      resourceType: "microsoft.operationalinsights/workspaces",
      crossComponentResources: ["{LogAnalyticsWorkspace}"],
      showExportToExcel: true,
      gridSettings: {
        formatters: [
          LOGS_LINK_FORMATTER(
            "ConfigurationChange\n| where TimeGenerated == datetime('${TimeGenerated}')\n| where Computer == '${Computer}'\n| where FileSystemPath == '${FileSystemPath}'"
          ),
          {
            columnMatch: "ChangeCategory",
            formatter: 4,
            formatOptions: {
              thresholdsOptions: "colors",
              thresholdsGrid: [
                { operator: "==", thresholdValue: "Added", representation: "green", text: "Added" },
                { operator: "==", thresholdValue: "Removed", representation: "redBright", text: "Removed" },
                { operator: "==", thresholdValue: "Modified", representation: "orange", text: "Modified" },
                { operator: "Default", representation: "gray", text: "{0}" }
              ]
            }
          }
        ]
      }
    },
    name: "appconfig-file-changes"
  },

  // ── Registry changes ─────────────────────────────────────────────────────
  {
    type: 3,
    content: {
      version: "KqlItem/1.0",
      query: OS_MAP +
        "ConfigurationChange\n" +
        WINDOW_FILTER +
        OS_LOOKUP + NOISE_FILTER +
        "| where ConfigChangeType == 'Registry'\n" +
        "| project TimeGenerated, Computer, ChangeCategory, RegistryKey, ValueName, Previous, Current, ValueData, _ResourceId\n" +
        "| order by TimeGenerated desc",
      size: 0,
      title: "Registry changes (Windows)",
      noDataMessage: "No registry changes in this window.",
      queryType: 0,
      resourceType: "microsoft.operationalinsights/workspaces",
      crossComponentResources: ["{LogAnalyticsWorkspace}"],
      showExportToExcel: true,
      gridSettings: {
        formatters: [
          LOGS_LINK_FORMATTER(
            "ConfigurationChange\n| where TimeGenerated == datetime('${TimeGenerated}')\n| where Computer == '${Computer}'\n| where RegistryKey == '${RegistryKey}'"
          ),
          {
            columnMatch: "ChangeCategory",
            formatter: 4,
            formatOptions: {
              thresholdsOptions: "colors",
              thresholdsGrid: [
                { operator: "==", thresholdValue: "Added", representation: "green", text: "Added" },
                { operator: "==", thresholdValue: "Removed", representation: "redBright", text: "Removed" },
                { operator: "==", thresholdValue: "Modified", representation: "orange", text: "Modified" },
                { operator: "Default", representation: "gray", text: "{0}" }
              ]
            }
          }
        ]
      }
    },
    name: "appconfig-registry-changes"
  },

  // ── Fleet drift baseline (kept) ──────────────────────────────────────────
  {
    type: 1,
    content: {
      json: "### Baseline — pre-existing fleet drift\nThis section ignores the incident window. It compares the **current** content hash of each tracked file across machines and flags files where two or more machines disagree. Useful as a sanity check: 'was this drift already there before the incident, or is it new?'"
    },
    name: "appconfig-baseline-help"
  },
  {
    type: 3,
    content: {
      version: "KqlItem/1.0",
      query: OS_MAP +
        "ConfigurationData\n" +
        "| where ConfigDataType == 'Files'\n" +
        "| where TimeGenerated > ago(1d)\n" +
        OS_LOOKUP + NOISE_FILTER_INVENTORY +
        "| summarize arg_max(TimeGenerated, FileContentChecksum) by Computer, FileSystemPath\n" +
        "| where isnotempty(FileContentChecksum)\n" +
        "| summarize machineCount = dcount(Computer), uniqueHashes = dcount(FileContentChecksum), hashes = make_set(FileContentChecksum, 10), machines = make_set(Computer, 10) by FileSystemPath\n" +
        "| where machineCount > 1 and uniqueHashes > 1\n" +
        "| extend driftScore = uniqueHashes\n" +
        "| order by driftScore desc, machineCount desc",
      size: 0,
      title: "Fleet drift — same config file, different SHA256 across machines",
      noDataMessage: "No fleet drift detected on tracked files.",
      queryType: 0,
      resourceType: "microsoft.operationalinsights/workspaces",
      crossComponentResources: ["{LogAnalyticsWorkspace}"],
      showExportToExcel: true,
      gridSettings: {
        formatters: [
          { columnMatch: "driftScore", formatter: 8, formatOptions: { min: 1, palette: "redBright" } },
          { columnMatch: "uniqueHashes", formatter: 8, formatOptions: { min: 1, palette: "orange" } },
          { columnMatch: "machineCount", formatter: 4 }
        ]
      }
    },
    name: "table-appconfig-fleet-drift"
  }
];

// Find the App Config group and replace its items.
let updated = false;
for (const item of wb.items) {
  if (item.name === 'group-appconfig' && item.content && Array.isArray(item.content.items)) {
    item.content.items = newItems;
    updated = true;
    break;
  }
}

if (!updated) {
  console.error('group-appconfig not found.');
  process.exit(1);
}

fs.writeFileSync(wbPath, JSON.stringify(wb, null, 2) + '\n');
console.log('App Config tab rewritten as incident-response surface.');

