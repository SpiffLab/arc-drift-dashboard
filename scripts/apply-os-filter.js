#!/usr/bin/env node
/* One-shot transformer that adds an OSFilter parameter to the workbook
   and weaves it into every relevant query. Idempotent: re-running on an
   already-transformed workbook is a no-op. */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'workbooks', 'arc-drift-dashboard.workbook.json');
const wb = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const ARG_MACHINE_FILTER = "| where '{OSFilter}' == 'All' or tostring(properties.osType) =~ '{OSFilter}'";
const WS_OSTYPE_FILTER   = "| where '{OSFilter}' == 'All' or OSType =~ '{OSFilter}'";

const OS_MAP_LET = "let _osMap = Heartbeat | summarize arg_max(TimeGenerated, OSType) by Computer | project Computer, _OSType = OSType;\n";
const OS_MAP_LOOKUP = "| lookup kind=leftouter _osMap on Computer\n| where '{OSFilter}' == 'All' or _OSType =~ '{OSFilter}'";

const paramsItem = wb.items.find(i => i.name === 'parameters');
const params = paramsItem.content.parameters;
if (!params.some(p => p.name === 'OSFilter')) {
  params.push({
    id: 'osFilter',
    version: 'KqlParameterItem/1.0',
    name: 'OSFilter',
    label: 'OS',
    type: 2,
    isRequired: true,
    value: 'All',
    typeSettings: { additionalResourceOptions: [], showDefault: false },
    jsonData: JSON.stringify(['All', 'Windows', 'Linux'])
  });
}

function walk(node, fn) {
  if (Array.isArray(node)) node.forEach(n => walk(n, fn));
  else if (node && typeof node === 'object') {
    fn(node);
    Object.values(node).forEach(v => walk(v, fn));
  }
}

const alreadyHasOsFilter = q => q.includes("'{OSFilter}'");

function injectAfterMachinesLine(q) {
  const re = /\| where type =~ 'microsoft\.hybridcompute\/machines'(?!\/)/;
  return q.replace(re, m => `${m}\n${ARG_MACHINE_FILTER}`);
}

function injectMachineJoin(q) {
  // Insert the join immediately AFTER the _mIdJoin extend line so it runs
  // before any subsequent summarize/project drops the join key.
  const join = `\n| join kind=inner (resources | where type =~ 'microsoft.hybridcompute/machines' | where '{OSFilter}' == 'All' or tostring(properties.osType) =~ '{OSFilter}' | project _mId = tolower(id)) on $left._mIdJoin == $right._mId`;
  return q.replace(
    /(\| extend _mIdJoin = [^\n]+)/,
    `$1${join}`
  );
}

walk(wb, node => {
  if (!node || node.version !== 'KqlItem/1.0' || typeof node.query !== 'string') return;
  let q = node.query;
  if (alreadyHasOsFilter(q)) return;

  const isArg = node.queryType === 1;
  const isWs  = node.queryType === 0;

  if (isArg) {
    if (/\| where type =~ 'microsoft\.hybridcompute\/machines'(?!\/)/.test(q)) {
      q = injectAfterMachinesLine(q);
    } else if (/microsoft\.hybridcompute\/machines\/extensions/i.test(q)) {
      q = q.replace(
        /\| where type =~ 'microsoft\.hybridcompute\/machines\/extensions'/,
        `$&\n| extend _mIdJoin = tolower(tostring(split(id, '/extensions/')[0]))`
      );
      q = injectMachineJoin(q);
    } else if (/microsoft\.guestconfiguration\/guestconfigurationassignments/i.test(q)) {
      q = q.replace(
        /\| where type =~ 'microsoft\.guestconfiguration\/guestconfigurationassignments'/,
        `$&\n| extend _mIdJoin = tolower(tostring(split(tolower(id), '/providers/microsoft.guestconfiguration')[0]))`
      );
      q = injectMachineJoin(q);
    } else if (/policyresources/i.test(q) && /microsoft\.hybridcompute\/machines/i.test(q)) {
      q = q.replace(
        /\| where tolower\(tostring\(properties\.resourceType\)\) startswith 'microsoft\.hybridcompute\/machines'/,
        `$&\n| extend _mIdJoin = tolower(tostring(properties.resourceId))`
      );
      q = injectMachineJoin(q);
    } else if (/patchassessmentresources/i.test(q)) {
      q = q.replace(
        /\| where type =~ 'microsoft\.hybridcompute\/machines\/patchassessmentresults\/softwarepatches'/,
        `$&\n| extend _mIdJoin = tolower(tostring(split(id, '/patchAssessmentResults/')[0]))`
      );
      q = injectMachineJoin(q);
    } else if (/securityresources/i.test(q) && /microsoft\.hybridcompute\/machines/i.test(q)) {
      q = q.replace(
        /\| where tolower\(resourceId\) contains '\/microsoft\.hybridcompute\/machines\/'/,
        `$&\n| extend _mIdJoin = tolower(tostring(split(tolower(resourceId), '/extensions/')[0]))\n| extend _mIdJoin = tolower(replace_string(tostring(split(_mIdJoin, '/providers/microsoft.security')[0]), '', ''))`
      );
      // Simpler: parse out the machine id from resourceId (which is the machine itself for hybrid compute machines)
      q = q.replace(
        /\| extend _mIdJoin = tolower\(tostring\(split\(tolower\(resourceId\), '\/extensions\/'\)\[0\]\)\)\n\| extend _mIdJoin = tolower\(replace_string\(tostring\(split\(_mIdJoin, '\/providers\/microsoft\.security'\)\[0\]\), '', ''\)\)/,
        `| extend _mIdJoin = tolower(resourceId)`
      );
      q = injectMachineJoin(q);
    }
  } else if (isWs) {
    if (/^ConfigurationChange/m.test(q)) {
      q = OS_MAP_LET + q;
      q = q.replace(
        /(ConfigurationChange\n\| where TimeGenerated \{TimeRange\})/,
        `$1\n${OS_MAP_LOOKUP}`
      );
    } else if (/^(ConfigurationData|Heartbeat)/m.test(q)) {
      const lines = q.split('\n');
      lines.splice(1, 0, WS_OSTYPE_FILTER);
      q = lines.join('\n');
    }
  }

  node.query = q;
});

const changesGroup = wb.items.find(i => i.name === 'group-changes');
if (changesGroup) {
  const items = changesGroup.content.items;
  const idx = items.findIndex(i => i.name === 'chart-changes-bytype');
  if (idx >= 0) {
    const winPie = {
      type: 3,
      content: {
        version: 'KqlItem/1.0',
        query: "let _osMap = Heartbeat | summarize arg_max(TimeGenerated, OSType) by Computer | project Computer, _OSType = OSType;\nConfigurationChange\n| where TimeGenerated {TimeRange}\n| where '{selectedComputer}' == '' or Computer == '{selectedComputer}'\n| lookup kind=leftouter _osMap on Computer\n| where _OSType =~ 'Windows'\n| summarize count() by ConfigChangeType",
        size: 3,
        title: 'Windows changes by type (services / registry / files / software)',
        queryType: 0,
        resourceType: 'microsoft.operationalinsights/workspaces',
        crossComponentResources: ['{LogAnalyticsWorkspace}'],
        visualization: 'piechart'
      },
      customWidth: '50',
      name: 'chart-changes-windows'
    };
    const linPie = {
      type: 3,
      content: {
        version: 'KqlItem/1.0',
        query: "let _osMap = Heartbeat | summarize arg_max(TimeGenerated, OSType) by Computer | project Computer, _OSType = OSType;\nConfigurationChange\n| where TimeGenerated {TimeRange}\n| where '{selectedComputer}' == '' or Computer == '{selectedComputer}'\n| lookup kind=leftouter _osMap on Computer\n| where _OSType =~ 'Linux'\n| summarize count() by ConfigChangeType",
        size: 3,
        title: 'Linux changes by type (daemons / files / software)',
        queryType: 0,
        resourceType: 'microsoft.operationalinsights/workspaces',
        crossComponentResources: ['{LogAnalyticsWorkspace}'],
        visualization: 'piechart'
      },
      customWidth: '50',
      name: 'chart-changes-linux'
    };
    items.splice(idx, 1, winPie, linPie);
  }
}

fs.writeFileSync(FILE, JSON.stringify(wb, null, 2) + '\n', 'utf8');
console.log('Workbook updated.');
