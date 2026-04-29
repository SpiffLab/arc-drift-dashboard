#!/usr/bin/env node
// Applies GPT-5.5 review fixes to the workbook:
//  1. SHA256 fleet drift — reduce to latest hash per (Computer, FileSystemPath); exclude empty checksums.
//  2. App Config has_any → contains chains (path-fragment / file-name / dotted patterns).
//  3. _osMap rebuilt on _ResourceId (host name not unique across domains / clones).
//
// Idempotent. Run from repo root: node scripts/fix-review-findings.js

const fs = require('fs');
const path = require('path');

const wbPath = path.join(__dirname, '..', 'workbooks', 'arc-drift-dashboard.workbook.json');
const wb = JSON.parse(fs.readFileSync(wbPath, 'utf8'));

const OLD_OSMAP = "let _osMap = Heartbeat | summarize arg_max(TimeGenerated, OSType) by Computer | project Computer, _OSType = OSType;";
const NEW_OSMAP = "let _osMap = Heartbeat | where isnotempty(_ResourceId) | summarize arg_max(TimeGenerated, OSType) by _ResourceId | project _ResourceId, _OSType = OSType;";

function rewriteHasAny(q) {
  // Replace `<col> has_any ('a','b','c')` with `(<col> contains 'a' or <col> contains 'b' or ...)`.
  const re = /([A-Za-z_][\w]*)\s+has_any\s*\(([^)]*)\)/g;
  return q.replace(re, (_m, col, list) => {
    const items = list
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (items.length === 0) return `(${col} contains '')`;
    return '(' + items.map(it => `${col} contains ${it}`).join(' or ') + ')';
  });
}

function rewriteOsMapJoin(q) {
  if (!q.includes(OLD_OSMAP)) return q;
  let out = q.replace(OLD_OSMAP, NEW_OSMAP);
  // Switch the lookup from Computer to _ResourceId.
  out = out.replace(/\| lookup kind=leftouter _osMap on Computer/g, '| lookup kind=leftouter _osMap on _ResourceId');
  return out;
}

function rewriteSha256Fleet(q) {
  // Marker: this is the SHA256 fleet drift query.
  if (!q.includes('uniqueHashes = dcount(FileContentChecksum)')) return q;
  if (q.includes('// fleet-drift-latest')) return q; // already fixed
  // Inject `arg_max(TimeGenerated, FileContentChecksum) by Computer, FileSystemPath` and an isnotempty filter
  // before the final summarize. We replace the line that starts with `| where pathLower contains` (post-has_any
  // rewrite) followed by `| summarize machineCount`.
  const oldFinal = "| summarize machineCount = dcount(Computer), uniqueHashes = dcount(FileContentChecksum), hashes = make_set(FileContentChecksum, 10), machines = make_set(Computer, 10) by FileSystemPath\n| where machineCount > 1 and uniqueHashes > 1\n| extend driftScore = uniqueHashes\n| order by driftScore desc, machineCount desc";
  const newFinal = "// fleet-drift-latest: collapse to latest hash per (Computer, FileSystemPath) before comparing\n| summarize arg_max(TimeGenerated, FileContentChecksum) by Computer, FileSystemPath\n| where isnotempty(FileContentChecksum)\n| summarize machineCount = dcount(Computer), uniqueHashes = dcount(FileContentChecksum), hashes = make_set(FileContentChecksum, 10), machines = make_set(Computer, 10) by FileSystemPath\n| where machineCount > 1 and uniqueHashes > 1\n| extend driftScore = uniqueHashes\n| order by driftScore desc, machineCount desc";
  return q.replace(oldFinal, newFinal);
}

let touched = 0;
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node.type === 3 && node.content && typeof node.content.query === 'string') {
    const before = node.content.query;
    let q = before;
    q = rewriteOsMapJoin(q);
    q = rewriteHasAny(q);
    q = rewriteSha256Fleet(q);
    if (q !== before) {
      node.content.query = q;
      touched++;
    }
  }
  for (const k of Object.keys(node)) walk(node[k]);
}

walk(wb);

fs.writeFileSync(wbPath, JSON.stringify(wb, null, 2) + '\n');
console.log(`Rewrote ${touched} queries.`);
