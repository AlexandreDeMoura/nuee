#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function fail(msg) {
  process.stderr.write(String(msg) + '\n');
  process.exit(1);
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) fail('usage: ua-arch-analyze.js <input.json> <output.json>');

let input;
try {
  input = JSON.parse(fs.readFileSync(inPath, 'utf8'));
} catch (e) {
  fail('failed to read input: ' + e.message);
}

const fileNodes = input.fileNodes || [];
const importEdges = input.importEdges || [];
const allEdges = input.allEdges || [];

const nodeById = new Map();
for (const n of fileNodes) nodeById.set(n.id, n);

const pathOf = (n) => n.filePath || (n.id.includes(':') ? n.id.slice(n.id.indexOf(':') + 1) : n.id);

// ---------- A. Directory grouping ----------
const paths = fileNodes.map(pathOf);

function commonPrefixSegments(list) {
  if (!list.length) return [];
  const split = list.map((p) => p.split('/'));
  // only meaningful if every file has at least 2 segments
  if (split.some((s) => s.length < 2)) return [];
  const first = split[0];
  const out = [];
  for (let i = 0; i < first.length - 1; i++) {
    const seg = first[i];
    if (split.every((s) => s.length > i + 1 && s[i] === seg)) out.push(seg);
    else break;
  }
  return out;
}

const prefix = commonPrefixSegments(paths);
const prefixStr = prefix.length ? prefix.join('/') + '/' : '';

// Top-level group (first segment after common prefix)
function topGroupOf(p) {
  const rel = prefixStr && p.startsWith(prefixStr) ? p.slice(prefixStr.length) : p;
  const segs = rel.split('/');
  return segs.length > 1 ? segs[0] : '(root)';
}

// Feature group: workspace + meaningful feature segment (monorepo aware)
function featureGroupOf(p) {
  const segs = p.split('/');
  if (segs.length === 1) return '(root)';
  const ws = segs[0];
  // skip container segments like src, test, tests
  const containers = new Set(['src']);
  let i = 1;
  const parts = [ws];
  while (i < segs.length - 1 && containers.has(segs[i])) {
    i++;
  }
  if (i >= segs.length - 1) {
    // file directly under ws/ or ws/src/
    parts.push(segs.slice(1, segs.length - 1).join('/') || '(root)');
    return parts.filter(Boolean).join('/');
  }
  parts.push(segs[i]);
  return parts.join('/');
}

const directoryGroups = {};      // feature-level grouping (primary)
const topLevelGroups = {};       // first-segment grouping
const groupOfNode = new Map();
for (const n of fileNodes) {
  const p = pathOf(n);
  const g = featureGroupOf(p);
  const t = topGroupOf(p);
  (directoryGroups[g] = directoryGroups[g] || []).push(n.id);
  (topLevelGroups[t] = topLevelGroups[t] || []).push(n.id);
  groupOfNode.set(n.id, g);
}

// ---------- B. Node type grouping ----------
const nodeTypeGroups = {};
for (const n of fileNodes) (nodeTypeGroups[n.type] = nodeTypeGroups[n.type] || []).push(n.id);

// ---------- C. Import adjacency ----------
const fileFanOut = {};
const fileFanIn = {};
for (const e of importEdges) {
  if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
  fileFanOut[e.source] = (fileFanOut[e.source] || 0) + 1;
  fileFanIn[e.target] = (fileFanIn[e.target] || 0) + 1;
}

// ---------- D. Cross-category dependency analysis ----------
const crossCatMap = new Map();
for (const e of allEdges) {
  const s = nodeById.get(e.source);
  const t = nodeById.get(e.target);
  if (!s || !t) continue;
  if (s.type === t.type && s.type === 'file') continue;
  const key = s.type + '|' + t.type + '|' + e.type;
  crossCatMap.set(key, (crossCatMap.get(key) || 0) + 1);
}
const crossCategoryEdges = [...crossCatMap.entries()]
  .map(([k, count]) => {
    const [fromType, toType, edgeType] = k.split('|');
    return { fromType, toType, edgeType, count };
  })
  .sort((a, b) => b.count - a.count);

// ---------- E. Inter-group import frequency ----------
const interMap = new Map();
const intra = {};
for (const g of Object.keys(directoryGroups)) intra[g] = { internalEdges: 0, totalEdges: 0 };

for (const e of importEdges) {
  const a = groupOfNode.get(e.source);
  const b = groupOfNode.get(e.target);
  if (!a || !b) continue;
  if (a === b) {
    intra[a].internalEdges++;
    intra[a].totalEdges++;
  } else {
    intra[a].totalEdges++;
    intra[b].totalEdges++;
    const k = a + '|' + b;
    interMap.set(k, (interMap.get(k) || 0) + 1);
  }
}
const interGroupImports = [...interMap.entries()]
  .map(([k, count]) => {
    const [from, to] = k.split('|');
    return { from, to, count };
  })
  .sort((a, b) => b.count - a.count);

const intraGroupDensity = {};
for (const [g, v] of Object.entries(intra)) {
  intraGroupDensity[g] = {
    internalEdges: v.internalEdges,
    totalEdges: v.totalEdges,
    density: v.totalEdges ? +(v.internalEdges / v.totalEdges).toFixed(3) : 0,
  };
}

// ---------- G. Pattern matching ----------
const DIR_PATTERNS = [
  [['routes', 'routers', 'api', 'controllers', 'controller', 'endpoints', 'handlers', 'serializers', 'blueprints'], 'api'],
  [['services', 'core', 'lib', 'domain', 'logic', 'signals', 'composables', 'mailers', 'jobs', 'channels', 'internal', 'ai'], 'service'],
  [['models', 'db', 'data', 'persistence', 'repository', 'entities', 'entity', 'migrations', 'database', 'sql', 'schema'], 'data'],
  [['components', 'views', 'pages', 'ui', 'layouts', 'screens'], 'ui'],
  [['middleware', 'plugins', 'interceptors', 'guards'], 'middleware'],
  [['utils', 'helpers', 'common', 'shared', 'tools', 'pkg', 'templatetags'], 'utility'],
  [['config', 'constants', 'env', 'settings', 'management', 'commands'], 'config'],
  [['__tests__', 'test', 'tests', 'spec', 'specs'], 'test'],
  [['types', 'interfaces', 'schemas', 'contracts', 'dtos', 'dto', 'request', 'response'], 'types'],
  [['hooks'], 'hooks'],
  [['store', 'state', 'reducers', 'actions', 'slices'], 'state'],
  [['assets', 'static', 'public'], 'assets'],
  [['cmd', 'bin'], 'entry'],
  [['docs', 'documentation', 'wiki', 'prd', 'design'], 'documentation'],
  [['deploy', 'deployment', 'infra', 'infrastructure', 'docker', 'k8s', 'kubernetes', 'helm', 'charts', 'terraform', 'tf'], 'infrastructure'],
  [['.github', '.gitlab', '.circleci'], 'ci-cd'],
];

function dirPattern(name) {
  const leaf = name.split('/').pop().toLowerCase();
  for (const [names, label] of DIR_PATTERNS) if (names.includes(leaf)) return label;
  return null;
}

const patternMatches = {};
for (const g of Object.keys(directoryGroups)) {
  const p = dirPattern(g);
  if (p) patternMatches[g] = p;
}

function filePattern(p, node) {
  const base = path.basename(p);
  const lower = base.toLowerCase();
  if (/\.(test|spec)\.[a-z]+$/.test(lower) || /^test_.*\.py$/.test(lower) || /_test\.go$/.test(lower)) return 'test';
  if (/\.e2e-spec\.ts$/.test(lower)) return 'test';
  if (/\.d\.ts$/.test(lower)) return 'types';
  if (/^(dockerfile|makefile)$/.test(lower) || /^docker-compose/.test(lower) || /\.tf$/.test(lower)) return 'infrastructure';
  if (p.startsWith('.github/workflows/') || lower === '.gitlab-ci.yml' || lower === 'jenkinsfile') return 'ci-cd';
  if (/\.sql$/.test(lower)) return 'data';
  if (/\.(graphql|gql|proto)$/.test(lower)) return 'types';
  if (/\.(md|rst)$/.test(lower)) return 'documentation';
  if (/^(package\.json|tsconfig.*\.json|.*\.config\.(js|ts|mjs|cjs)|nest-cli\.json|\.prettierrc|eslint\.config\.[a-z]+)$/.test(lower)) return 'config';
  if (/^(index|main)\.(ts|tsx|js|jsx)$/.test(lower)) return 'entry';
  return node && node.type !== 'file' ? node.type : null;
}

const filePatternMatches = {};
for (const n of fileNodes) {
  const fp = filePattern(pathOf(n), n);
  if (fp) filePatternMatches[n.id] = fp;
}

// ---------- H. Deployment topology ----------
const infraFiles = [];
let hasDockerfile = false, hasCompose = false, hasK8s = false, hasTerraform = false, hasCI = false;
for (const n of fileNodes) {
  const p = pathOf(n);
  const b = path.basename(p).toLowerCase();
  if (b === 'dockerfile' || b.startsWith('dockerfile.')) { hasDockerfile = true; infraFiles.push(p); }
  else if (b.startsWith('docker-compose')) { hasCompose = true; infraFiles.push(p); }
  else if (/(^|\/)(k8s|kubernetes|helm|charts)\//.test(p)) { hasK8s = true; infraFiles.push(p); }
  else if (/\.tf(vars)?$/.test(b)) { hasTerraform = true; infraFiles.push(p); }
  else if (p.startsWith('.github/workflows/') || b === '.gitlab-ci.yml' || b === 'jenkinsfile') { hasCI = true; infraFiles.push(p); }
  else if (b === 'makefile' || b === 'procfile' || b === 'fly.toml' || b === 'railway.json') { infraFiles.push(p); }
}
const deploymentTopology = { hasDockerfile, hasCompose, hasK8s, hasTerraform, hasCI, infraFiles };

// ---------- I. Data pipeline ----------
const dataPipeline = { schemaFiles: [], migrationFiles: [], dataModelFiles: [], apiHandlerFiles: [], tableNodes: [], endpointNodes: [] };
for (const n of fileNodes) {
  const p = pathOf(n);
  const tags = (n.tags || []).map((t) => String(t).toLowerCase());
  if (n.type === 'table') dataPipeline.tableNodes.push(n.id);
  if (n.type === 'endpoint') dataPipeline.endpointNodes.push(n.id);
  if (n.type === 'schema' || /\.(sql|graphql|proto|prisma)$/.test(p)) dataPipeline.schemaFiles.push(p);
  if (/migration/i.test(p)) dataPipeline.migrationFiles.push(p);
  if (/repository|\.repo\.|model/i.test(p) || tags.includes('data-model')) dataPipeline.dataModelFiles.push(p);
  if (/controller|route|\.router\./i.test(p) || tags.includes('api-handler')) dataPipeline.apiHandlerFiles.push(p);
}

// ---------- J. Documentation coverage ----------
const docNodes = fileNodes.filter((n) => n.type === 'document' || /\.(md|rst)$/i.test(pathOf(n)));
const docGroups = new Set(docNodes.map((n) => groupOfNode.get(n.id)));
const documentsEdges = allEdges.filter((e) => e.type === 'documents');
const groupsDocumented = new Set();
for (const e of documentsEdges) {
  const g = groupOfNode.get(e.target);
  if (g) groupsDocumented.add(g);
}
const allGroups = Object.keys(directoryGroups);
const covered = new Set([...docGroups, ...groupsDocumented]);
const docCoverage = {
  groupsWithDocs: [...covered].filter((g) => allGroups.includes(g)).length,
  totalGroups: allGroups.length,
  coverageRatio: allGroups.length ? +([...covered].filter((g) => allGroups.includes(g)).length / allGroups.length).toFixed(2) : 0,
  undocumentedGroups: allGroups.filter((g) => !covered.has(g)),
};

// ---------- K. Dependency direction ----------
const pairSeen = new Set();
const dependencyDirection = [];
for (const { from, to, count } of interGroupImports) {
  const key = [from, to].sort().join('||');
  if (pairSeen.has(key)) continue;
  pairSeen.add(key);
  const reverse = interGroupImports.find((x) => x.from === to && x.to === from);
  const rc = reverse ? reverse.count : 0;
  if (count > rc) dependencyDirection.push({ dependent: from, dependsOn: to, count, reverseCount: rc });
  else if (rc > count) dependencyDirection.push({ dependent: to, dependsOn: from, count: rc, reverseCount: count });
  else dependencyDirection.push({ dependent: from, dependsOn: to, count, reverseCount: rc, bidirectional: true });
}

// ---------- Stats ----------
const filesPerGroup = {};
for (const [g, ids] of Object.entries(directoryGroups)) filesPerGroup[g] = ids.length;
const filesPerTopGroup = {};
for (const [g, ids] of Object.entries(topLevelGroups)) filesPerTopGroup[g] = ids.length;
const nodeTypeCounts = {};
for (const [t, ids] of Object.entries(nodeTypeGroups)) nodeTypeCounts[t] = ids.length;

const topFanIn = Object.entries(fileFanIn).sort((a, b) => b[1] - a[1]).slice(0, 30);
const topFanOut = Object.entries(fileFanOut).sort((a, b) => b[1] - a[1]).slice(0, 30);

const results = {
  scriptCompleted: true,
  commonPrefix: prefixStr,
  directoryGroups,
  topLevelGroups,
  nodeTypeGroups,
  crossCategoryEdges,
  interGroupImports,
  intraGroupDensity,
  patternMatches,
  filePatternMatches,
  deploymentTopology,
  dataPipeline,
  docCoverage,
  dependencyDirection,
  fileStats: {
    totalFileNodes: fileNodes.length,
    filesPerGroup,
    filesPerTopGroup,
    nodeTypeCounts,
  },
  fileFanIn: Object.fromEntries(topFanIn),
  fileFanOut: Object.fromEntries(topFanOut),
};

try {
  fs.writeFileSync(outPath, JSON.stringify(results, null, 1));
} catch (e) {
  fail('failed to write output: ' + e.message);
}
process.stdout.write('ok: ' + fileNodes.length + ' file nodes, ' + allGroups.length + ' groups\n');
