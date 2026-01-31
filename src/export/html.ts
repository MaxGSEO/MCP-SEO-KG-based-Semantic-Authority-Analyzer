import { EntityGraph } from '../types/index.js';
import { ExportOptions } from '../types/addon.js';
import { writeFileSync } from 'fs';

export async function exportToHTML(
  graph: EntityGraph,
  outputPath: string,
  options: ExportOptions = {}
): Promise<number> {
  const {
    title = 'Entity Salience Map',
    darkMode = true,
    showSidePanel = true,
    includeMetrics = true
  } = options;

  // Prepare graph data for embedding
  const graphData = prepareGraphData(graph, includeMetrics);

  // Generate HTML
  const html = generateHTML(graphData, title, darkMode, showSidePanel);

  writeFileSync(outputPath, html, 'utf-8');
  return Buffer.byteLength(html, 'utf-8');
}

interface PreparedNode {
  id: string;
  name: string;
  type: string;
  wikidataId?: string;
  wikipediaUrl?: string;
  salience: number;
  bc: number;
  relevance: number;
  frequency: number;
  cluster?: number;
  connections: number;
}

interface PreparedEdge {
  source: string;
  target: string;
  weight: number;
}

interface PreparedGraph {
  nodes: PreparedNode[];
  edges: PreparedEdge[];
  metadata: {
    title?: string;
    nodeCount: number;
    edgeCount: number;
    clusterCount: number;
    maxSalience: number;
  };
}

function prepareGraphData(graph: EntityGraph, _includeMetrics: boolean): PreparedGraph {
  // Build adjacency for connection count
  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  // Find unique clusters
  const clusters = new Set<number>();

  // Prepare nodes
  const nodes: PreparedNode[] = graph.nodes.map(node => {
    const bc = Number.isFinite(node.betweennessCentrality) ? node.betweennessCentrality! : 0;
    const relevance = Number.isFinite(node.entity.relevance) ? node.entity.relevance : 0;
    const frequency = node.entity.mentions?.length ?? 1;

    // Composite salience score (safe against NaN)
    const salience = bc * 0.4 + relevance * 0.3 + (Math.log(frequency + 1) / 5) * 0.3;

    if (node.cluster != null) clusters.add(node.cluster);

    return {
      id: node.id,
      name: node.entity.name,
      type: node.entity.type,
      wikidataId: node.entity.wikidataId,
      wikipediaUrl: node.entity.wikipediaUrl,
      salience,
      bc,
      relevance,
      frequency,
      cluster: node.cluster,
      connections: adjacency.get(node.id)?.size ?? 0
    };
  });

  // Sort by salience descending
  nodes.sort((a, b) => b.salience - a.salience);

  // Prepare edges
  const edges: PreparedEdge[] = graph.edges.map(edge => ({
    source: edge.source,
    target: edge.target,
    weight: edge.weight ?? 1
  }));

  const maxSalience = nodes.length > 0 ? nodes[0].salience : 1;

  return {
    nodes,
    edges,
    metadata: {
      title: graph.metadata?.title,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      clusterCount: clusters.size,
      maxSalience
    }
  };
}

interface Theme {
  bg: string;
  surface: string;
  surfaceHover: string;
  text: string;
  textMuted: string;
  accent: string;
  link: string;
  border: string;
  nodeStroke: string;
  edgeColor: string;
  clusterColors: string[];
}

const darkTheme: Theme = {
  bg: '#1a1a2e',
  surface: '#16213e',
  surfaceHover: '#1f3460',
  text: '#e8e8e8',
  textMuted: '#a0a0a0',
  accent: '#4cc9f0',
  link: '#7209b7',
  border: '#2a3f5f',
  nodeStroke: '#ffffff',
  edgeColor: '#4a5568',
  clusterColors: [
    '#4cc9f0', '#f72585', '#7209b7', '#3a0ca3', '#4361ee',
    '#4895ef', '#560bad', '#480ca8', '#b5179e', '#f15bb5'
  ]
};

const lightTheme: Theme = {
  bg: '#f5f5f5',
  surface: '#ffffff',
  surfaceHover: '#f0f0f0',
  text: '#1a1a1a',
  textMuted: '#666666',
  accent: '#2563eb',
  link: '#7c3aed',
  border: '#e0e0e0',
  nodeStroke: '#ffffff',
  edgeColor: '#cbd5e1',
  clusterColors: [
    '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4', '#10b981',
    '#f59e0b', '#ec4899', '#6366f1', '#14b8a6', '#f97316'
  ]
};

function generateHTML(
  graphData: PreparedGraph,
  title: string,
  darkMode: boolean,
  showSidePanel: boolean
): string {
  const theme = darkMode ? darkTheme : lightTheme;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${generateCSS(theme, showSidePanel)}
  </style>
</head>
<body>
  <div id="app">
    <div id="header">
      <h1>${escapeHtml(title)}</h1>
      <div id="stats">
        <span class="stat">${graphData.metadata.nodeCount} entities</span>
        <span class="stat">${graphData.metadata.edgeCount} connections</span>
        <span class="stat">${graphData.metadata.clusterCount} clusters</span>
      </div>
    </div>

    <div id="controls">
      <div class="control-group">
        <label for="search">Search:</label>
        <input type="text" id="search" placeholder="Entity name...">
      </div>
      <div class="control-group">
        <label for="clusterFilter">Cluster:</label>
        <select id="clusterFilter">
          <option value="all">All</option>
        </select>
      </div>
      <div class="control-group">
        <label for="typeFilter">Type:</label>
        <select id="typeFilter">
          <option value="all">All</option>
        </select>
      </div>
      <div class="control-group">
        <label for="minSalience">Min Salience:</label>
        <input type="range" id="minSalience" min="0" max="100" value="0">
        <span id="minSalienceValue">0%</span>
      </div>
      <button id="exportPng">Export PNG</button>
      <button id="resetView">Reset View</button>
    </div>

    <div id="main">
      <div id="graph-container">
        <svg id="graph"></svg>
      </div>
      ${showSidePanel ? `
      <div id="side-panel">
        <div id="panel-content">
          <p class="hint">Click an entity to see details</p>
        </div>
      </div>
      ` : ''}
    </div>
  </div>

  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script>
// Graph data embedded
const graphData = ${JSON.stringify(graphData)};

${generateJS(theme, showSidePanel)}
  </script>
</body>
</html>`;
}

function generateCSS(theme: Theme, showSidePanel: boolean): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme.bg};
      color: ${theme.text};
      overflow: hidden;
    }

    #app { display: flex; flex-direction: column; height: 100vh; }

    #header {
      padding: 16px 24px;
      background: ${theme.surface};
      border-bottom: 1px solid ${theme.border};
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    #header h1 { font-size: 1.5rem; font-weight: 600; }
    #stats { display: flex; gap: 16px; }
    .stat { color: ${theme.textMuted}; font-size: 0.875rem; }

    #controls {
      padding: 12px 24px;
      background: ${theme.surface};
      border-bottom: 1px solid ${theme.border};
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }

    .control-group { display: flex; align-items: center; gap: 8px; }
    .control-group label { font-size: 0.875rem; color: ${theme.textMuted}; }

    input[type="text"], select {
      padding: 6px 12px;
      border: 1px solid ${theme.border};
      border-radius: 4px;
      background: ${theme.bg};
      color: ${theme.text};
      font-size: 0.875rem;
    }

    input[type="range"] { width: 100px; }

    button {
      padding: 6px 16px;
      background: ${theme.accent};
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
      transition: opacity 0.2s;
    }

    button:hover { opacity: 0.9; }

    #main { flex: 1; display: flex; overflow: hidden; }
    #graph-container { flex: 1; position: relative; }
    #graph { width: 100%; height: 100%; }

    ${showSidePanel ? `
    #side-panel {
      width: 320px;
      background: ${theme.surface};
      border-left: 1px solid ${theme.border};
      overflow-y: auto;
      padding: 20px;
    }

    #panel-content .hint { color: ${theme.textMuted}; font-style: italic; }
    .entity-header { margin-bottom: 16px; }
    .entity-name { font-size: 1.25rem; font-weight: 600; margin-bottom: 4px; word-break: break-word; }
    .entity-type {
      display: inline-block;
      padding: 2px 8px;
      background: ${theme.accent}33;
      color: ${theme.accent};
      border-radius: 4px;
      font-size: 0.75rem;
      text-transform: uppercase;
    }
    .entity-links { margin-top: 8px; }
    .entity-links a { color: ${theme.link}; text-decoration: none; font-size: 0.875rem; }
    .entity-links a:hover { text-decoration: underline; }
    .metrics-section { margin-top: 20px; }
    .metrics-section h3 { font-size: 0.875rem; color: ${theme.textMuted}; text-transform: uppercase; margin-bottom: 12px; }
    .metric-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${theme.border}; }
    .metric-label { color: ${theme.textMuted}; font-size: 0.875rem; }
    .metric-value { font-weight: 500; }
    .metric-bar { height: 4px; background: ${theme.border}; border-radius: 2px; margin-top: 4px; overflow: hidden; }
    .metric-bar-fill { height: 100%; background: ${theme.accent}; border-radius: 2px; }
    .connections-section { margin-top: 20px; }
    .connection-item {
      padding: 8px;
      margin: 4px 0;
      background: ${theme.bg};
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .connection-item:hover { background: ${theme.surfaceHover}; }
    ` : ''}

    .node { cursor: pointer; transition: opacity 0.2s; }
    .node:hover { opacity: 0.8; }
    .node.highlighted { stroke-width: 3px !important; }
    .node.dimmed { opacity: 0.2; }
    .edge { stroke: ${theme.edgeColor}; stroke-opacity: 0.6; transition: stroke-opacity 0.2s; }
    .edge.highlighted { stroke: ${theme.accent}; stroke-opacity: 1; stroke-width: 2px; }
    .edge.dimmed { stroke-opacity: 0.1; }
    .node-label { pointer-events: none; font-size: 10px; fill: ${theme.text}; text-anchor: middle; }
  `;
}

function generateJS(theme: Theme, showSidePanel: boolean): string {
  return `
(function() {
  const { nodes, edges, metadata } = graphData;
  const clusterColors = ${JSON.stringify(theme.clusterColors)};

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adjacency = new Map();
  edges.forEach(e => {
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
    adjacency.get(e.source).add(e.target);
    adjacency.get(e.target).add(e.source);
  });

  const clusters = [...new Set(nodes.map(n => n.cluster).filter(c => c != null))].sort((a, b) => a - b);
  const types = [...new Set(nodes.map(n => n.type))].sort();

  const clusterSelect = document.getElementById('clusterFilter');
  clusters.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = 'Cluster ' + c;
    clusterSelect.appendChild(opt);
  });

  const typeSelect = document.getElementById('typeFilter');
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    typeSelect.appendChild(opt);
  });

  const container = document.getElementById('graph-container');
  const svg = d3.select('#graph');
  const width = container.clientWidth;
  const height = container.clientHeight;

  svg.attr('viewBox', [0, 0, width, height]);

  const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => { g.attr('transform', event.transform); });

  svg.call(zoom);

  const g = svg.append('g');

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 5));

  const edgeGroup = g.append('g').attr('class', 'edges');
  let edgeElements = edgeGroup.selectAll('line')
    .data(edges)
    .join('line')
    .attr('class', 'edge')
    .attr('stroke-width', d => Math.sqrt(d.weight));

  const nodeGroup = g.append('g').attr('class', 'nodes');
  let nodeElements = nodeGroup.selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('class', 'node')
    .attr('r', nodeRadius)
    .attr('fill', d => getNodeColor(d))
    .attr('stroke', '${theme.nodeStroke}')
    .attr('stroke-width', 1.5)
    .call(drag(simulation));

  const labelGroup = g.append('g').attr('class', 'labels');
  const topNodes = nodes.slice(0, 15);
  let labelElements = labelGroup.selectAll('text')
    .data(topNodes)
    .join('text')
    .attr('class', 'node-label')
    .attr('dy', d => nodeRadius(d) + 12)
    .text(d => truncate(d.name, 20));

  nodeElements
    .on('mouseover', handleMouseOver)
    .on('mouseout', handleMouseOut)
    .on('click', handleClick);

  simulation.on('tick', () => {
    edgeElements
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    nodeElements
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);

    labelElements
      .attr('x', d => d.x)
      .attr('y', d => d.y);
  });

  function nodeRadius(d) { return 5 + (d.salience / metadata.maxSalience) * 25; }

  function getNodeColor(d) {
    if (d.cluster != null) return clusterColors[d.cluster % clusterColors.length];
    return '#888888';
  }

  function truncate(str, maxLen) {
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
  }

  function handleMouseOver(event, d) {
    const connected = adjacency.get(d.id) || new Set();
    nodeElements.classed('dimmed', n => n.id !== d.id && !connected.has(n.id));
    edgeElements.classed('dimmed', e => e.source.id !== d.id && e.target.id !== d.id);
    edgeElements.classed('highlighted', e => e.source.id === d.id || e.target.id === d.id);
  }

  function handleMouseOut() {
    nodeElements.classed('dimmed', false);
    edgeElements.classed('dimmed', false);
    edgeElements.classed('highlighted', false);
  }

  function handleClick(event, d) {
    ${showSidePanel ? 'updateSidePanel(d);' : ''}
    nodeElements.classed('highlighted', n => n.id === d.id);
  }

  ${showSidePanel ? `
  function updateSidePanel(node) {
    const panel = document.getElementById('panel-content');
    const connected = adjacency.get(node.id) || new Set();
    const connectedNodes = [...connected].map(id => nodeMap.get(id)).filter(Boolean);

    panel.innerHTML = \`
      <div class="entity-header">
        <div class="entity-name">\${escapeHtml(node.name)}</div>
        <span class="entity-type">\${escapeHtml(node.type)}</span>
        <div class="entity-links">
          \${node.wikidataId ? '<a href="https://www.wikidata.org/wiki/' + node.wikidataId + '" target="_blank">Wikidata</a>' : ''}
          \${node.wikipediaUrl ? ' &middot; <a href="' + node.wikipediaUrl + '" target="_blank">Wikipedia</a>' : ''}
        </div>
      </div>

      <div class="metrics-section">
        <h3>Salience Breakdown</h3>
        <div class="metric-row">
          <span class="metric-label">Overall Salience</span>
          <span class="metric-value">\${(node.salience * 100).toFixed(1)}%</span>
        </div>
        <div class="metric-bar"><div class="metric-bar-fill" style="width: \${(node.salience / metadata.maxSalience * 100)}%"></div></div>

        <div class="metric-row">
          <span class="metric-label">Betweenness Centrality</span>
          <span class="metric-value">\${(node.bc * 100).toFixed(2)}%</span>
        </div>
        <div class="metric-bar"><div class="metric-bar-fill" style="width: \${node.bc * 100}%"></div></div>

        <div class="metric-row">
          <span class="metric-label">Relevance</span>
          <span class="metric-value">\${(node.relevance * 100).toFixed(1)}%</span>
        </div>
        <div class="metric-bar"><div class="metric-bar-fill" style="width: \${node.relevance * 100}%"></div></div>

        <div class="metric-row">
          <span class="metric-label">Mentions</span>
          <span class="metric-value">\${node.frequency}</span>
        </div>

        \${node.cluster != null ? '<div class="metric-row"><span class="metric-label">Cluster</span><span class="metric-value">' + node.cluster + '</span></div>' : ''}
      </div>

      <div class="connections-section">
        <h3>Connected Entities (\${connectedNodes.length})</h3>
        \${connectedNodes.slice(0, 10).map(n => \`
          <div class="connection-item" data-id="\${n.id}">
            <strong>\${escapeHtml(n.name)}</strong>
            <span style="color: #888; font-size: 0.75rem;"> \${n.type}</span>
          </div>
        \`).join('')}
        \${connectedNodes.length > 10 ? '<p style="color: #888; font-size: 0.875rem;">... and ' + (connectedNodes.length - 10) + ' more</p>' : ''}
      </div>
    \`;

    panel.querySelectorAll('.connection-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const node = nodeMap.get(id);
        if (node) {
          updateSidePanel(node);
          const x = node.x || width / 2;
          const y = node.y || height / 2;
          svg.transition().duration(750).call(
            zoom.transform,
            d3.zoomIdentity.translate(width / 2 - x, height / 2 - y)
          );
        }
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  ` : ''}

  function drag(simulation) {
    return d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  let currentFilters = { cluster: 'all', type: 'all', minSalience: 0, search: '' };

  function applyFilters() {
    const { cluster, type, minSalience, search } = currentFilters;
    const searchLower = search.toLowerCase();
    const salienceThreshold = minSalience / 100 * metadata.maxSalience;

    nodeElements.style('display', d => {
      if (cluster !== 'all' && d.cluster !== parseInt(cluster)) return 'none';
      if (type !== 'all' && d.type !== type) return 'none';
      if (d.salience < salienceThreshold) return 'none';
      if (searchLower && !d.name.toLowerCase().includes(searchLower)) return 'none';
      return null;
    });

    const visibleNodes = new Set();
    nodeElements.each(function(d) {
      if (d3.select(this).style('display') !== 'none') visibleNodes.add(d.id);
    });

    edgeElements.style('display', d => {
      return visibleNodes.has(d.source.id) && visibleNodes.has(d.target.id) ? null : 'none';
    });

    labelElements.style('display', d => visibleNodes.has(d.id) ? null : 'none');
  }

  document.getElementById('clusterFilter').addEventListener('change', e => {
    currentFilters.cluster = e.target.value;
    applyFilters();
  });

  document.getElementById('typeFilter').addEventListener('change', e => {
    currentFilters.type = e.target.value;
    applyFilters();
  });

  document.getElementById('minSalience').addEventListener('input', e => {
    currentFilters.minSalience = parseInt(e.target.value);
    document.getElementById('minSalienceValue').textContent = e.target.value + '%';
    applyFilters();
  });

  document.getElementById('search').addEventListener('input', e => {
    currentFilters.search = e.target.value;
    applyFilters();
  });

  document.getElementById('resetView').addEventListener('click', () => {
    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
  });

  document.getElementById('exportPng').addEventListener('click', () => {
    const svgElement = document.getElementById('graph');
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '${theme.bg}';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = 'entity-graph.png';
      link.href = pngUrl;
      link.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  });

  window.addEventListener('resize', () => {
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;
    svg.attr('viewBox', [0, 0, newWidth, newHeight]);
    simulation.force('center', d3.forceCenter(newWidth / 2, newHeight / 2));
    simulation.alpha(0.3).restart();
  });
})();
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
