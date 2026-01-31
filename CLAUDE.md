# CLAUDE.md - SEO Semantic Authority Analyzer MCP Server

## Project Overview

Build an MCP server that performs semantic SEO analysis using entity extraction, knowledge graph construction, and network centrality metrics. The server enables AI assistants to analyze content for topical authority, identify content gaps, and generate data-driven content briefs.

## Key Differentiators

This MCP is NOT just another entity extractor. It combines:
1. **Entity disambiguation** (TextRazor → Wikidata IDs)
2. **Co-occurrence graphs** (InfraNodus methodology)
3. **Betweenness centrality** (identifies topical brokers)
4. **Structural gap detection** (content opportunities)
5. **SERP comparison** (competitive entity analysis)

## Technology Stack

- **Language**: TypeScript (MCP SDK works best with TS)
- **Transport**: stdio (for Claude Desktop integration)
- **Entity Extraction**: TextRazor API
- **Graph Algorithms**: Custom implementation (no external graph DB required)
- **Validation**: Zod schemas

## File Structure to Create

```
d:\python\SEO Semantic Authority Analyzer\
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── types/
│   │   └── index.ts             # TypeScript interfaces
│   ├── schemas/
│   │   └── validation.ts        # Zod schemas
│   ├── tools/
│   │   ├── extract.ts           # seo_extract_entities
│   │   ├── graph.ts             # seo_build_entity_graph
│   │   ├── analysis.ts          # seo_analyze_centrality
│   │   ├── gaps.ts              # seo_detect_gaps
│   │   ├── compare.ts           # seo_compare_serp
│   │   ├── brief.ts             # seo_generate_brief
│   │   └── visualize.ts         # seo_visualize_graph
│   ├── services/
│   │   ├── textrazor.ts         # TextRazor API client
│   │   └── crawler.ts           # URL content fetcher
│   └── graph/
│       ├── types.ts             # Graph data structures
│       ├── cooccurrence.ts      # Co-occurrence graph
│       ├── centrality.ts        # Betweenness centrality
│       ├── communities.ts       # Louvain clustering
│       └── gaps.ts              # Structural gaps
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Implementation Priority

### Phase 1: Core Infrastructure (Do First)
1. Initialize npm project with dependencies
2. Create TypeScript config
3. Set up MCP server skeleton in `src/index.ts`
4. Implement types in `src/types/index.ts`

### Phase 2: Entity Extraction
1. Implement TextRazor client in `src/services/textrazor.ts`
2. Implement URL crawler in `src/services/crawler.ts`
3. Create `seo_extract_entities` tool

### Phase 3: Graph Construction
1. Implement graph data structures in `src/graph/types.ts`
2. Implement co-occurrence algorithm in `src/graph/cooccurrence.ts`
3. Create `seo_build_entity_graph` tool

### Phase 4: Network Analysis
1. Implement betweenness centrality in `src/graph/centrality.ts`
2. Implement Louvain clustering in `src/graph/communities.ts`
3. Implement gap detection in `src/graph/gaps.ts`
4. Create `seo_analyze_centrality` and `seo_detect_gaps` tools

### Phase 5: SEO Tools
1. Create `seo_compare_serp` tool
2. Create `seo_generate_brief` tool
3. Create `seo_visualize_graph` tool

## MCP Tools to Implement

| Tool | Purpose | Priority |
|------|---------|----------|
| `seo_extract_entities` | Extract entities from URL/text | P0 |
| `seo_build_entity_graph` | Build co-occurrence graph | P0 |
| `seo_analyze_centrality` | Compute BC metrics | P0 |
| `seo_detect_gaps` | Find structural gaps | P1 |
| `seo_compare_serp` | Compare vs competitors | P1 |
| `seo_generate_brief` | Generate content brief | P2 |
| `seo_visualize_graph` | Create HTML visualization | P2 |

## Critical Algorithms

### Betweenness Centrality (Brandes Algorithm)
- Located in `src/graph/centrality.ts`
- O(VE) complexity
- Normalize by (n-1)(n-2)/2 for undirected graphs
- See references/centrality-algorithms.md for implementation

### Co-occurrence Graph
- Located in `src/graph/cooccurrence.ts`
- Default window size: 5 words
- Minimum edge weight: 2 co-occurrences
- See references/cooccurrence-algorithm.md for implementation

### Structural Gap Detection
- Located in `src/graph/gaps.ts`
- Find cluster pairs with low inter-cluster edge density
- Suggest bridge entities that could connect clusters
- See references/centrality-algorithms.md for implementation

## Environment Variables

```env
TEXTRAZOR_API_KEY=required
HF_TOKEN=optional_for_nuextract
COOCCURRENCE_WINDOW=5
MIN_EDGE_WEIGHT=2
MIN_ENTITY_CONFIDENCE=0.5
```

## Testing Commands

```bash
# Build
npm run build

# Test with MCP Inspector
npm run inspect

# Development mode
npm run dev
```

## Quality Checklist

Before considering the MCP complete:

- [ ] All 7 tools registered and working
- [ ] TextRazor integration tested with real URLs
- [ ] Betweenness centrality produces valid 0-1 scores
- [ ] Community detection groups related entities
- [ ] Structural gaps correctly identify disconnected clusters
- [ ] SERP comparison works with 10+ URLs
- [ ] Content brief includes actionable recommendations
- [ ] HTML visualization renders correctly
- [ ] Error handling returns helpful messages
- [ ] All tools have proper Zod schemas
- [ ] Tool annotations (readOnlyHint, etc.) are accurate

## Reference Documentation

The `references/` folder contains detailed implementation guides:

- **schema.md** - Complete TypeScript type definitions
- **tool-schemas.md** - Zod schemas for all MCP tools
- **textrazor-integration.md** - TextRazor API usage
- **extraction-templates.md** - Schema-guided extraction templates
- **cooccurrence-algorithm.md** - Co-occurrence graph construction
- **centrality-algorithms.md** - Betweenness centrality, communities, gaps
- **typescript-config.md** - Project configuration files

**Read these references before implementing each component.**

## Common Pitfalls to Avoid

1. **Don't log to stdout** - MCP uses stdout for communication. Use `console.error()` for logging.

2. **Don't forget entity deduplication** - Same entity can appear multiple times with different surface forms.

3. **Handle empty graphs** - Centrality algorithms need special cases for graphs with <3 nodes.

4. **Normalize centrality scores** - Raw scores aren't comparable across different graph sizes.

5. **Rate limit TextRazor** - Free tier is 500 requests/day. Use Bottleneck for throttling.

6. **Clean HTML properly** - Use cheerio to remove nav, footer, scripts before extraction.

## Example Usage

Once built, the MCP can be used like this:

```
User: Analyze the semantic coverage of https://example.com/article

Claude: [calls seo_extract_entities]
Found 47 entities including "Machine Learning" (Q2539), "Neural Networks" (Q192776)...

[calls seo_build_entity_graph]
Built graph with 47 nodes and 156 edges...

[calls seo_analyze_centrality]
Top topical brokers:
1. "Deep Learning" (BC: 0.42) - bridges AI and Applications clusters
2. "TensorFlow" (BC: 0.31) - connects Tools and Concepts clusters

[calls seo_detect_gaps]
Structural gap detected between "Theory" cluster and "Implementation" cluster.
Bridge opportunity: Add content connecting "Backpropagation" to "Python Libraries"
```
