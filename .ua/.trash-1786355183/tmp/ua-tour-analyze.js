#!/usr/bin/env node
'use strict';

/**
 * Tour topology analyzer.
 *
 * Reads {nodes, edges, layers} and computes structural signals for tour design:
 * fan-in / fan-out rankings, entry-point candidates, a BFS reading order from the
 * top code entry point, non-code inventory, tightly coupled clusters and layers.
 *
 * Sub-file nodes (function:, class:) are projected onto their containing file so
 * the topology is genuinely file-level while still using the full edge set.
 */

const fs = require('fs');

const FILE_LEVEL_TYPES = new Set([
  'file', 'config', 'document', 'service', 'pipeline',
  'table', 'schema', 'resource', 'endpoint',
]);

const ENTRY_FILENAMES = new Set([
  'index.ts', 'index.js', 'index.tsx', 'index.jsx',
  'main.ts', 'main.js', 'main.tsx', 'main.jsx',
  'app.ts', 'app.js', 'app.tsx', 'app.jsx',
  'server.ts', 'server.js',
  'mod.rs', 'main.go', 'main.py', 'main.rs',
  'manage.py', 'app.py', 'wsgi.py', 'asgi.py', 'run.py', '__main__.py',
  'Application.java', 'Main.java', 'Program.cs', 'config.ru',
  'index.php', 'App.swift', 'Application.kt', 'main.cpp', 'main.c',
]);

const TRAVERSAL_EDGE_TYPES = new Set(['imports', 'calls']);

function fail(msg) {
  process.stderr.write(String(msg) + '\n');
  process.exit(1);
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) fail('usage: ua-tour-analyze.js <input.json> <output.json>');

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (err) {
    fail('failed to read/parse input: ' + err.message);
  }

  const allNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const allEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const layers = Array.isArray(raw.layers) ? raw.layers : [];
  if (!allNodes.length) fail('input contains no nodes');

  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  // ---- Project sub-file nodes onto their containing file -------------------
  const parentOf = new Map();
  for (const e of allEdges) {
    if (e.type !== 'contains') continue;
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    if (!src || !tgt) continue;
    if (FILE_LEVEL_TYPES.has(src.type) && !FILE_LEVEL_TYPES.has(tgt.type)) {
      parentOf.set(tgt.id, src.id);
    }
  }
  // Fallback: derive parent from the `kind:filePath:symbol` id shape.
  for (const n of allNodes) {
    if (FILE_LEVEL_TYPES.has(n.type) || parentOf.has(n.id)) continue;
    if (n.filePath && nodeById.has('file:' + n.filePath)) {
      parentOf.set(n.id, 'file:' + n.filePath);
    }
  }

  const fileNodes = allNodes.filter((n) => FILE_LEVEL_TYPES.has(n.type));
  const fileIds = new Set(fileNodes.map((n) => n.id));

  const resolve = (id) => {
    if (fileIds.has(id)) return id;
    const p = parentOf.get(id);
    return p && fileIds.has(p) ? p : null;
  };

  // ---- Build the file-level edge set ---------------------------------------
  const projected = [];
  const seenEdge = new Set();
  for (const e of allEdges) {
    if (e.type === 'contains' || e.type === 'exports') continue; // structural, not relational
    const s = resolve(e.source);
    const t = resolve(e.target);
    if (!s || !t || s === t) continue;
    const key = s + '|' + t + '|' + e.type;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    projected.push({ source: s, target: t, type: e.type });
  }

  const fanIn = new Map();
  const fanOut = new Map();
  const outAdj = new Map();   // traversal edges only
  const undirected = new Map(); // any-type neighbours
  for (const id of fileIds) {
    fanIn.set(id, 0);
    fanOut.set(id, 0);
    outAdj.set(id, new Set());
    undirected.set(id, new Set());
  }
  const pairTypes = new Map(); // "a|b" (a<b) -> Set of directed type keys

  for (const e of projected) {
    fanOut.set(e.source, fanOut.get(e.source) + 1);
    fanIn.set(e.target, fanIn.get(e.target) + 1);
    undirected.get(e.source).add(e.target);
    undirected.get(e.target).add(e.source);
    if (TRAVERSAL_EDGE_TYPES.has(e.type)) outAdj.get(e.source).add(e.target);
    const [a, b] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const k = a + '|' + b;
    if (!pairTypes.has(k)) pairTypes.set(k, new Set());
    pairTypes.get(k).add(e.source + '>' + e.target + ':' + e.type);
  }

  const nameOf = (id) => (nodeById.get(id) || {}).name || id;
  const sumOf = (id) => (nodeById.get(id) || {}).summary || '';

  const fanInRanking = [...fanIn.entries()]
    .map(([id, v]) => ({ id, fanIn: v, name: nameOf(id) }))
    .sort((a, b) => b.fanIn - a.fanIn || a.id.localeCompare(b.id))
    .slice(0, 20);

  const fanOutRanking = [...fanOut.entries()]
    .map(([id, v]) => ({ id, fanOut: v, name: nameOf(id) }))
    .sort((a, b) => b.fanOut - a.fanOut || a.id.localeCompare(b.id))
    .slice(0, 20);

  // ---- Entry point candidates ---------------------------------------------
  const sortedFanOut = [...fanOut.values()].sort((a, b) => b - a);
  const sortedFanIn = [...fanIn.values()].sort((a, b) => a - b);
  const topDecileFanOut = sortedFanOut[Math.max(0, Math.floor(sortedFanOut.length * 0.1) - 1)] || 0;
  const bottomQuartileFanIn = sortedFanIn[Math.max(0, Math.floor(sortedFanIn.length * 0.25) - 1)] || 0;

  const scored = [];
  for (const n of fileNodes) {
    const fp = n.filePath || '';
    const depth = fp ? fp.split('/').length : 99;
    const base = fp.split('/').pop() || n.name || '';
    let score = 0;
    const reasons = [];

    if (n.type === 'document') {
      if (/^README\.md$/i.test(fp)) { score += 5; reasons.push('root README (+5)'); }
      else if (depth === 1 && /\.md$/i.test(base)) { score += 2; reasons.push('root markdown (+2)'); }
    } else {
      if (ENTRY_FILENAMES.has(base)) { score += 3; reasons.push('entry filename (+3)'); }
      if (depth <= 2) { score += 1; reasons.push('shallow path (+1)'); }
      if (fanOut.get(n.id) >= topDecileFanOut && topDecileFanOut > 0) { score += 1; reasons.push('high fan-out (+1)'); }
      if (fanIn.get(n.id) <= bottomQuartileFanIn) { score += 1; reasons.push('low fan-in (+1)'); }
    }
    if (score > 0) {
      scored.push({
        id: n.id, score, name: n.name, type: n.type, filePath: fp,
        fanIn: fanIn.get(n.id), fanOut: fanOut.get(n.id),
        traversalFanOut: (outAdj.get(n.id) || new Set()).size,
        reasons, summary: sumOf(n.id),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.fanOut - a.fanOut || a.id.localeCompare(b.id));
  const entryPointCandidates = scored.slice(0, 10);

  // ---- BFS from the top *code* entry point ---------------------------------
  // A re-export barrel scores well on filename but has no outgoing imports/calls,
  // so it would yield an empty traversal. Only nodes with real traversal edges
  // are eligible BFS roots.
  const codeEntries = scored
    .filter((c) => c.type !== 'document' && c.traversalFanOut > 0)
    .sort((a, b) => b.score - a.score || b.traversalFanOut - a.traversalFanOut || a.id.localeCompare(b.id));
  const runBfs = (start) => {
    if (!start) return null;
    const depthMap = { [start]: 0 };
    const order = [start];
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const next = [...(outAdj.get(cur) || [])].sort();
      for (const nb of next) {
        if (nb in depthMap) continue;
        depthMap[nb] = depthMap[cur] + 1;
        order.push(nb);
        queue.push(nb);
      }
    }
    const byDepth = {};
    for (const [id, d] of Object.entries(depthMap)) {
      (byDepth[d] = byDepth[d] || []).push(id);
    }
    return { startNode: start, order, depthMap, byDepth, reached: order.length };
  };

  const primary = codeEntries[0] ? codeEntries[0].id : (fileNodes[0] && fileNodes[0].id);
  const bfsTraversal = runBfs(primary);

  // Secondary traversals: this is a monorepo, one entry cannot reach both sides.
  const additionalTraversals = [];
  const covered = new Set(bfsTraversal ? bfsTraversal.order : []);
  for (const cand of codeEntries.slice(0, 12)) {
    if (covered.has(cand.id)) continue;
    const t = runBfs(cand.id);
    if (!t || t.reached < 3) continue;
    additionalTraversals.push(t);
    t.order.forEach((id) => covered.add(id));
    if (additionalTraversals.length >= 4) break;
  }

  // ---- Non-code inventory --------------------------------------------------
  const bucket = { documentation: [], infrastructure: [], data: [], config: [] };
  const bucketFor = (t) => {
    if (t === 'document') return 'documentation';
    if (t === 'service' || t === 'pipeline' || t === 'resource') return 'infrastructure';
    if (t === 'table' || t === 'schema' || t === 'endpoint') return 'data';
    if (t === 'config') return 'config';
    return null;
  };
  for (const n of fileNodes) {
    const b = bucketFor(n.type);
    if (!b) continue;
    bucket[b].push({
      id: n.id, name: n.name, type: n.type, filePath: n.filePath || '',
      fanIn: fanIn.get(n.id), summary: sumOf(n.id),
    });
  }
  for (const k of Object.keys(bucket)) bucket[k].sort((a, b) => b.fanIn - a.fanIn || a.id.localeCompare(b.id));

  // ---- Tightly coupled clusters -------------------------------------------
  const seeds = [];
  for (const [k, types] of pairTypes.entries()) {
    const [a, b] = k.split('|');
    const bidir = [...types].some((t) => t.startsWith(a + '>')) && [...types].some((t) => t.startsWith(b + '>'));
    if (bidir || types.size >= 2) seeds.push({ nodes: new Set([a, b]), strength: types.size + (bidir ? 2 : 0) });
  }
  seeds.sort((a, b) => b.strength - a.strength);

  const clusters = [];
  const usedInCluster = new Set();
  for (const seed of seeds) {
    if ([...seed.nodes].some((id) => usedInCluster.has(id))) continue;
    const members = new Set(seed.nodes);
    // Expand with nodes connected to 2+ current members.
    for (let pass = 0; pass < 2 && members.size < 5; pass++) {
      const counts = new Map();
      for (const m of members) {
        for (const nb of undirected.get(m) || []) {
          if (members.has(nb)) continue;
          counts.set(nb, (counts.get(nb) || 0) + 1);
        }
      }
      const adds = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
      if (!adds.length) break;
      for (const [id] of adds) {
        if (members.size >= 5) break;
        members.add(id);
      }
    }
    let edgeCount = 0;
    for (const e of projected) if (members.has(e.source) && members.has(e.target)) edgeCount++;
    clusters.push({
      nodes: [...members],
      names: [...members].map(nameOf),
      edgeCount,
    });
    members.forEach((id) => usedInCluster.add(id));
    if (clusters.length >= 10) break;
  }
  clusters.sort((a, b) => b.edgeCount - a.edgeCount);

  // ---- Node summary index --------------------------------------------------
  const nodeSummaryIndex = {};
  for (const n of fileNodes) {
    nodeSummaryIndex[n.id] = {
      name: n.name, type: n.type, filePath: n.filePath || '',
      fanIn: fanIn.get(n.id), fanOut: fanOut.get(n.id), summary: sumOf(n.id),
    };
  }

  const results = {
    scriptCompleted: true,
    entryPointCandidates,
    fanInRanking,
    fanOutRanking,
    bfsTraversal,
    additionalTraversals,
    nonCodeFiles: bucket,
    clusters,
    layers: { count: layers.length, list: layers },
    nodeSummaryIndex,
    totalNodes: allNodes.length,
    totalFileLevelNodes: fileNodes.length,
    totalEdges: allEdges.length,
    totalProjectedFileEdges: projected.length,
  };

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  process.stdout.write(
    `ok: ${fileNodes.length} file-level nodes, ${projected.length} projected edges, ` +
    `BFS start=${primary} reached=${bfsTraversal ? bfsTraversal.reached : 0}, ` +
    `${clusters.length} clusters\n`
  );
}

try {
  main();
} catch (err) {
  fail(err && err.stack ? err.stack : String(err));
}
