# SEO Semantic Authority Analyzer v1 + Addon

## What It Does

An MCP server that uses **network science** to analyze semantic authority in SEO content. Unlike keyword-based tools, it extracts **disambiguated entities** (linked to Wikidata), builds **co-occurrence graphs**, and identifies which entities act as **topical bridges** — revealing content gaps and optimization opportunities.

---

## Core Insight

> **Betweenness centrality reveals topical authority.**

Entities with high betweenness centrality connect different topic clusters. They're the "bridges" that signal comprehensive coverage to search engines. Missing these bridges = missing topical authority.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP SERVER                               │
│                    (TypeScript + stdio)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  EXTRACTION  │ →  │    GRAPH     │ →  │   ANALYSIS   │       │
│  │    LAYER     │    │    LAYER     │    │    LAYER     │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                   │                │
│         ▼                   ▼                   ▼                │
│  • TextRazor API     • Structured         • Betweenness         │
│  • Entity disambig.    proximity + PMI      centrality          │
│  • Wikidata IDs      • Weighted edges     • Louvain-like        │
│  • NuExtract         • NetworkX-style     • Structural gaps     │
│    (schema-guided)     algorithms         • SERP comparison     │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                         ADDON LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   STORAGE    │    │   ANALYSIS   │    │    EXPORT    │       │
│  │   (SQLite)   │    │  (Advanced)  │    │  (Multi-fmt) │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                   │                │
│         ▼                   ▼                   ▼                │
│  • Snapshots         • Entity gaps        • GEXF (Gephi)        │
│  • Velocity          • Differentiation    • GraphML             │
│    tracking          • Salience maps      • CSV                 │
│  • Historical        • Interactive HTML   • Cypher (Neo4j)      │
│    queries             (dark + panel)     • DOT (Graphviz)      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tools Overview

### Base MCP (7 tools)

| Tool                     | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `seo_extract_entities`   | Extract entities with Wikidata disambiguation + blocks |
| `seo_build_entity_graph` | Build entity graph (structured proximity + PMI)|
| `seo_analyze_centrality` | Compute betweenness, degree, diversivity       |
| `seo_detect_gaps`        | Find structural gaps between topic clusters    |
| `seo_compare_serp`       | Compare entity coverage across SERP results    |
| `seo_generate_brief`     | Create content briefs with entity requirements |
| `seo_visualize_graph`    | Generate graph visualization                   |

### Addon (5 tools)

| Tool                           | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `seo_find_entity_gaps`         | Your page vs competitors → missing entities |
| `seo_differentiation_analysis` | What makes #1 position unique               |
| `seo_entity_salience_map`      | Interactive HTML with importance scores     |
| `seo_entity_velocity`          | Track entity changes over time              |
| `seo_export_graph`             | Export to GEXF, GraphML, CSV, Cypher, DOT   |

### Phase 2 (Robustness) Tools

| Tool                          | Purpose                                           |
| ----------------------------- | ------------------------------------------------- |
| `seo_crawl_page`              | Crawl URL with Crawl4AI (fit_markdown + blocks)   |
| `seo_batch_crawl`             | Batch crawl multiple URLs with rate limiting      |
| `seo_extract_relations`       | Extract typed relations via NuExtract 2.0         |
| `seo_extract_relations_text`  | Extract relations from plain text (no blocks)     |

---

**Default behavior (Phase 2):** URL-based tools use Crawl4AI `fit_markdown` + structured blocks when the microservice is available.  
`seo_extract_entities` returns `blocks` and `fit_markdown` so the output can be passed directly into `seo_build_entity_graph`.  
TextRazor remains the default entity extractor. If Crawl4AI is offline, the system falls back to the legacy HTML crawler.

**Recommended chaining (Phase 2):**
1) `seo_extract_entities` (URL)  
2) `seo_build_entity_graph` using `extractionResult` from step 1  
3) `seo_analyze_centrality` or `seo_detect_gaps`

Example (chaining with `extractionResult`):
```json
{
  "tool": "seo_extract_entities",
  "input": {
    "source": "https://example.com/your-page",
    "sourceType": "url",
    "minConfidence": 0.5
  }
}
```

```json
{
  "tool": "seo_build_entity_graph",
  "input": {
    "extractionResult": "<output from seo_extract_entities>",
    "useStructuredProximity": true,
    "usePMIWeighting": true
  }
}
```

## Key Algorithms

### Betweenness Centrality (Brandes, O(VE))

Measures how often an entity lies on shortest paths between other entities. High BC = topical broker.

### Structured Proximity Graph

Entities co-occurring in the **same sentence / paragraph / section** form edges with tiered weights.  
If structured blocks are unavailable, the system falls back to a 5-word sliding window.  
Edge weights can be further adjusted using PMI/NPMI to downweight common entities.

### Louvain-like Clustering

Detects topic communities using a Louvain-style heuristic. Useful for structure, but not strictly deterministic.

### Structural Gaps

Identifies cluster pairs with weak connections. These are content opportunities.

---

## Differentiation

| Existing Tools       | This MCP                              |
| -------------------- | ------------------------------------- |
| Keywords + backlinks | **Disambiguated entities** (Wikidata) |
| Word frequency       | **Network centrality metrics**        |
| No graph analysis    | **Structural gap detection**          |
| Manual comparison    | **Automated SERP entity analysis**    |
| Static reports       | **Actionable content briefs**         |

---

## Example Output

### Entity with High Betweenness Centrality

```json
{
  "entity": "Machine Learning",
  "wikidataId": "Q2539",
  "betweennessCentrality": 0.342,
  "role": "topical_broker",
  "connects": ["AI Cluster", "Data Science Cluster", "Automation Cluster"],
  "recommendation": "This entity bridges 3 major topics. Strengthen coverage."
}
```

### Structural Gap

```json
{
  "cluster1": "Technical SEO",
  "cluster2": "Content Strategy", 
  "distance": 0.67,
  "bridgeCandidates": ["Content Optimization", "Semantic Markup"],
  "opportunity": "Create content connecting technical implementation to strategy."
}
```

---

## Tech Stack

- **Runtime:** Node.js 18+
- **Language:** TypeScript
- **MCP SDK:** @modelcontextprotocol/sdk
- **Entity Extraction:** TextRazor API (free tier: 500 req/day)
- **Schema Extraction:** NuExtract (HuggingFace)
- **Storage:** SQLite (better-sqlite3)
- **Validation:** Zod

---

## Use Cases

1. **Content Audit** — Which entities are missing from our pages vs competitors?
2. **Content Planning** — Which structural gaps should new content fill?
3. **SERP Analysis** — What entities do top-ranking pages share? What differentiates #1?
4. **Authority Building** — Which entities should you strengthen to become a topical hub?
5. **Temporal Analysis** — How has our entity coverage evolved over time?

---

## Installation

```bash
# Clone and install
cd seo-semantic-authority-analyzer
npm install

# Configure
cp .env.example .env
# Add TEXTRAZOR_API_KEY

# Run
npm run dev        # Development
npm run inspect    # Test with MCP Inspector
```

---

## What’s already robust in our design

### 1) You picked the right abstraction: entity graph, not keywords

You’re extracting **disambiguated entities linked to Wikidata** and building an entity graph with **structured proximity**, then using **betweenness centrality** and **community detection (Louvain‑like)** to find “topic bridges” and clusters.  
That’s a defensible model for “coverage” and “authority” because it measures *structure*, not just counts.

### 2) Tooling layout is clean for automation

Your MCP tools are modular (extract → build graph → analyze → gap detect → SERP compare → brief → visualize/export). That’s exactly how you want an MCP server to look if an agent will orchestrate it reliably.

### 3) You’re already thinking in “products”: snapshots, velocity, exports

The addon layer (SQLite snapshots + velocity tracking + multi-format export including Cypher) is pragmatic and makes the output portable and testable.

---

## Where it’s *not* robust yet (and why)

### A) The 5‑word co-occurrence window is fragile (fallback mode)

The default graph now uses **structured proximity** over Crawl4AI blocks, which avoids most layout noise.  
However, when blocks aren’t available, the system falls back to a **5‑word sliding window**, and the old failure mode returns (footer/nav noise, boilerplate co-occurrence).

**Impact:** in fallback mode, betweenness “bridge” entities can still be artifacts of layout noise, not topical authority.

### B) Betweenness centrality is expensive and unstable under noisy edges

You cite Brandes O(VE).  
On small graphs it’s fine. On SERP-wide graphs, it becomes slow and also very sensitive to small edge changes. If extraction is jittery, our “topical brokers” will jitter too.

### C) Louvain can be nondeterministic unless you control it

Louvain clustering is great, but many implementations are not strictly deterministic unless you control randomness/iteration order. our cluster boundaries may shift across runs, which makes “velocity” tracking and SERP comparisons less meaningful.

### D) Dependency risk: TextRazor limits and vendor coupling

Your overview explicitly calls out TextRazor free tier: **500 req/day**.  
That’s fine for demos, not for repeated SERP crawls + competitor tracking. Even paid tiers do not remove the fundamental issue: you need caching, batching, retries, and a fallback path.

### E) Security: MCP + crawling is a prompt-injection playground

If our server fetches URLs or processes competitor pages, you are automatically ingesting adversarial text (the web) into a system that can call tools. That’s the exact setup where prompt injection causes tool misuse or data leakage unless you harden it. OpenAI explicitly recommends careful controls when using MCP servers/connectors. MCP itself publishes security best practices for implementers/operators.

---

### GPT Pro Further Development

# How to make it *actually* robust (practical upgrades)

### 1) Fix graph construction first (biggest ROI)

**Status: Implemented in Phase 2.**  
Base tools now default to Crawl4AI `fit_markdown` + structured blocks, the graph uses structured proximity by default, and PMI/NPMI weighting can be applied when blocks are available.

Keep co-occurrence, but make it **less stupid**:

**Replace “5 words” with “structured proximity”**  
Build edges by where entities co-occur in:

- same sentence

- same paragraph / content block

- same heading section (H2 subtree)

- title/meta/intro separately weighted

Then weight edges by proximity tier (sentence > paragraph > section > page).

**Add boilerplate removal + content segmentation**  
Before any extraction:

- strip nav/footer

- collapse repeated template blocks

- preserve heading hierarchy

This single change improves every downstream metric more than swapping models.

**Use association weighting instead of raw frequency**  
Raw co-occurrence favors high-frequency entities. Add PMI/NPMI or “observed vs expected” weighting so common entities do not dominate by default.

---

## Using **NuExtract 2** to upgrade our extraction layer

NuExtract 2 is explicitly designed for **structured information extraction by filling a JSON template** and is trained to prioritize “pure extraction” (pulling spans from the source). That’s exactly what you want for evidence-backed SEO graphs.

### A) Use NuExtract as a *deterministic schema extractor*, not a “smart chatbot”

**Pattern:**

1. Segment page into blocks (title, intro, each H2 section, FAQ, etc.).

2. For each block, run NuExtract with a strict template.

3. Merge outputs across blocks with dedup + evidence.

**Why it helps our system:**

- higher recall than entity APIs alone (especially for niche entities)

- structured outputs for relations/claims you can turn into **typed KG edges**, not just co-occurrence

### B) The template you should be extracting for SEO KGs

Instead of only `entities[]`, extract:

- **entities[]** (surface span + type + evidence)

- **relations[]** as controlled predicates (what you ultimately wanted: triples)

- **page_intents[]** (informational/commercial/etc), optional

- **definitions/claims[]** (for factuality checks and differentiation)

Example template concept (illustrative):

```json
{
  "entities": [
    {
      "name": "",
      "type": "",
      "evidence": ""
    }
  ],
  "relations": [
    {
      "subject": "",
      "predicate": "",
      "object": "",
      "evidence": "",
      "polarity": "positive|negative|neutral",
      "modality": "asserted|hypothetical|recommendation"
    }
  ]
}
```

Then you constrain `predicate` via prompt instructions to a small enum like:

- `defines`, `includes`, `requires`, `causes`, `improves`, `compares_to`, `uses`, `part_of`, `located_in`, `measures`, etc.

### C) Entity linking with Wikidata

NuExtract won’t give you QIDs by itself. So do:

- NuExtract extracts entity spans + types + evidence

- TextRazor (or our own linker) maps spans to Wikidata IDs

- you store **(span → QID)** with context and reuse it (cache)

This also lets you detect when TextRazor misses entities NuExtract found.

### D) Practical “robustness move”: ensemble agreement

For any edge you care about (especially “bridge candidates”):

- promote confidence when **both** NuExtract and TextRazor agree on the entity

- for relations, promote confidence when the relation is extracted in multiple blocks or multiple models

This reduces false bridges caused by random noise.

---

## Using **OneKE** to improve robustness and operability

OneKE is a **dockerized schema-guided knowledge extraction system** designed to extract from **web and raw PDFs**, using multiple agents plus a configurable knowledge base for schema config and error-case debugging/correction.

That makes it useful in two very specific ways for our MCP project:

### 1) OneKE as a “heavy mode” extractor

Use OneKE when:

- the page is long/complex

- you need cross-section consistency

- you want relation extraction with schema guidance

- you’re processing PDFs (whitepapers, research pages, etc.)

Since it’s dockerized, it’s easy to run as a sidecar service and call from our TypeScript MCP server.

### 2) OneKE as a debugging and schema-evolution engine

Your biggest long-term problem is not extraction. It’s **keeping schemas sane as SEO needs evolve**.

OneKE’s “configure knowledge base” concept is explicitly aimed at schema configuration and error-case debugging/correction.  
You can steal this idea even if you don’t fully adopt OneKE:

- keep a “case repository” of pages where our extraction failed or produced nonsense bridges

- store expected entities/relations for those pages

- regression-test extraction on every update

This is what turns an SEO prototype into a tool you can trust.

---

## Two concrete upgrades to our MCP toolset

These are small changes that massively increase robustness.

### 1) Add an “evidence-first” contract to every tool output

**Status: Partially implemented.**
Edges built from structured blocks now include block-level provenance, and entity mentions can carry block IDs + heading paths when Crawl4AI is used. Full, unified provenance on every tool output is still a work in progress.

Make every entity and edge include:

- `source_url`

- `block_id` (title/heading path)

- `char_span` or snippet

- `extractor` (textrazor / nuextract / oneke)

- `confidence`

Then you can:

- audit why an entity is “important”

- avoid hallucinated bridges

- do stable diffing for velocity tracking

### 2) Add a “safe crawl” boundary tool

If you crawl SERP pages, isolate it:

- allowlist domains (or at least block private IPs to avoid SSRF)

- hard timeouts and size limits

- store raw HTML separately from extracted text

- treat extracted ttors guidance is very explicit that tool access + untrusted content increases risk, and you should restrict/approve sensitive actions. MCP’s security best practices are worth reading if you want this to survive contact with reality.

---

## Where the fancy supervised triple-extraction models fit (BiRTE/DirectRel/etc.)

Not as our first move.

They’re great when you have:

- a stable relation schema

- training data

- strong need to reduce inference cost

The sane path is:

1. use NuExtract/OneKE + rules to generate lots of high-quality pseudo-labels with evidence

2. train a smaller supervised extractor later to cut costs/latency

---

## 1) NuExtract‑2.0‑8B: worth it, with one big caveat

**What it is:** NuExtract 2.0 is a family of models from NuMind trained specifically for “document → JSON” extraction using a **JSON template** (schema). The 8B model is **multimodal** (text + images) and multilingual, and it’s **MIT licensed** (commercial-friendly). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

### Why it’s a good match for SEO KG automation

- **Structured extraction with a template**: you can force consistent output fields (entities, relations, evidence, section, intent labels, etc.). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

- **Precision bias**: their own write-up emphasizes preferring `null` over inventing facts, and explicitly training the model to say “I don’t know” when info isn’t present. That’s exactly what you want before writing anything into a KG. ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction  - NuMind"))

- **Multimodal**: for SEO, this is sneakily useful. You can extract from:
  
  - PDFs/screenshots of SERP features
  
  - JS-heavy pages where “rendered view” is cleaner than DOM soup
  
  - tables or formatted blocks that text-only cleaners often mangle ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction  - NuMind"))

### The caveat (and it matters): context length

NuExtract 2.0 models are described as **32k token context** in the NuMind post. That is plenty for many pages, but not “infinite”, and long “guide” pages can blow past it. ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction  - NuMind"))

So our robustness depends on **how you chunk and how you design templates**.

### Known failure modes (their words, not mine)

They call out:

- **Long documents** (32k cap)

- **“Laziness”**: returning an almost-empty output when the template is complex and many requested fields are missing

- Rare **looping/repetition** in lists ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction  - NuMind"))

This is fixable in an automated pipeline, but only if you build for it.

### Practical rules for using NuExtract 2.0 in our MCP pipeline

1. **Never run one giant mega-template** (“give me all triples, all entities, all attributes”). That’s how you get the “lazy output” problem. Split templates by task. ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction  - NuMind"))

2. **Add provenance fields** everywhere (evidence sentence + section heading + source URL). And enforce `verbatim-string` for evidence so it must copy from input. ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

3. **Keep temperature at ~0** (they explicitly recommend this for extraction). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

4. Prefer a **two-pass extraction**:
   
   - Pass A: extract *candidate entities* + evidence
   
   - Pass B: extract *relations* only among the candidates, per section/chunk

5. Use **in-context examples** for our domain-specific relation ontology (SEO is full of recurring relation patterns). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

### Decision: vLLM-native vs NuMind dockerfiles

### Pick **vLLM-native** (recommended for most “serious” ops) when you want:

**1) Maximum control and performance tuning**

- You control `--max-model-len`, dtype, tensor parallel, GPU allocation, batching behavior, etc. If you hit memory issues, vLLM explicitly suggests lowering max model length. ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B-GPTQ?utm_source=chatgpt.com "numind/NuExtract-2.0-8B-GPTQ · Hugging Face"))

- You can run either directly or with vLLM’s official Docker image. ([docs.vllm.ai](https://docs.vllm.ai/en/stable/deployment/docker.html?utm_source=chatgpt.com "Using Docker - vLLM"))

**2) Cleaner production story**

- Standard container base (`vllm/vllm-openai`) that lots of people use.

- Fewer “mystery layers” you didn’t author. (Mystery layers are how you get 3 a.m. incidents.)

**3) Easier integration with our MCP server**

- Your MCP tool just treats it like an OpenAI endpoint. vLLM’s docs are explicit about OpenAI-compatible endpoints and the `extra_body` escape hatch. ([docs.vllm.ai](https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html?utm_source=chatgpt.com "OpenAI-Compatible Server — vLLM"))

**Trade-offs**

- You own dependency pinning, CUDA compatibility, and upgrades. Humans love “control” until they have to maintain it.

### What our snippet is doing (and why it works)

Your client code calls an **OpenAI-compatible** endpoint at `http://localhost:8000/v1`. That is exactly how vLLM’s OpenAI server is meant to be used. ([docs.vllm.ai](https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html?utm_source=chatgpt.com "OpenAI-Compatible Server — vLLM"))  
NuExtract’s own instructions show serving NuExtract 2.0 behind vLLM and calling it with the OpenAI Python client (same base_url pattern you pasted). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B-GPTQ?utm_source=chatgpt.com "numind/NuExtract-2.0-8B-GPTQ · Hugging Face"))

---

### Pick **NuMind dockerfiles** when you want:

**1) Fastest path to “it runs”**

- Likely pinned dependencies and model-serving quirks handled for you.

- Less time fiddling with Transformers versions and remote-code trust flags.

**2) Reproducibility for our team**

- Everyone runs the same container and stops arguing about whose CUDA is cursed.

**Trade-offs**

- Less flexibility. If you need a specific vLLM version, CUDA base, or want to slim the image for deployment, you’ll end up editing their Dockerfiles anyway.

- You still have to understand vLLM behavior, because under the hood that’s what you’re running (or something very close to it). NuExtract’s own repo text literally says: “You can also use one of our docker images.” It’s positioned as an alternative packaging of the same deployment idea. ([GitHub](https://github.com/numindai/nuextract?utm_source=chatgpt.com "GitHub - numindai/nuextract"))

---

## For our use case (SEO KG + MCP automation)

### Default: **vLLM OpenAI server (official) + pinned config**

- Use vLLM’s official Docker image (`vllm/vllm-openai`) and pass NuExtract-specific flags (`--trust_remote_code`, multimodal limits, chat template format) as NuExtract recommends. ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B-GPTQ?utm_source=chatgpt.com "numind/NuExtract-2.0-8B-GPTQ · Hugging Face"))

- Put our **template JSON** in `chat_template_kwargs` exactly like you’re doing.

Why: it’s the most boring, standard, and scalable path. Boring is good in automation.

### Keep NuMind dockerfiles as:

- a **known-good fallback** (if you hit dependency hell)

- a reference for **their recommended pins**

---

## Two gotchas you should treat as “production requirements”

### 1) Chat templates and OpenAI content format

vLLM needs a proper chat template to run the Chat Completions API (or you’ll get errors / wrong formatting). vLLM docs call this out, and NuExtract’s vLLM command includes `--chat-template-content-format openai`. ([docs.vllm.ai](https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html?utm_source=chatgpt.com "OpenAI-Compatible Server — vLLM"))

### 2) `generation_config.json` can silently change defaults

vLLM warns that by default it applies the model repo’s `generation_config.json`, which can override sampling defaults. For extraction you want stable behavior (temp 0), so keep parameters explicit. ([docs.vllm.ai](https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html?utm_source=chatgpt.com "OpenAI-Compatible Server — vLLM"))

---

## Practical rule of thumb

- **If you’re going to scale / run this as a service:** vLLM official Docker + our own pinned deployment config. ([docs.vllm.ai](https://docs.vllm.ai/en/stable/deployment/docker.html?utm_source=chatgpt.com "Using Docker - vLLM"))

- **If you just want “works today” on a single box:** NuMind dockerfiles are fine.

And yes, this is another case where the “hard part” isn’t the model, it’s making the boring infrastructure boring enough to trust. Humans keep trying to skip that part.

---

## Crawl4AI features that directly strengthen our KG + network metrics

#### A) “Fit Markdown”: stop feeding boilerplate into our graph

Crawl4AI can generate:

- raw markdown (everything)

- **fit_markdown**: pruned/filtered to the page’s “core” content

It supports pruning heuristics and BM25 query-focused filtering. ([Crawl4AI Documentazione](https://docs.crawl4ai.com/core/fit-markdown/ "Fit Markdown - Crawl4AI Documentation (v0.8.x)"))

Why you care: our co-occurrence edges (and thus betweenness) will be dramatically less noisy if you build graphs from **fit_markdown** instead of raw DOM text.

#### B) Content selection & exclusions: deterministic cleaning

You can:

- exclude `header`, `footer`, `nav`, etc.

- exclude external links, social links, certain domains, external images

- set minimum word thresholds per block ([Crawl4AI Documentazione](https://docs.crawl4ai.com/core/content-selection/ "Content Selection - Crawl4AI Documentation (v0.8.x)"))

That’s not just “nice”, it’s how you prevent our KG from thinking “Privacy Policy” is the most central entity in every industry.

#### C) Custom scraping strategy: yes, you can write our own

Crawl4AI explicitly supports building a custom scraping strategy by inheriting from `ContentScrapingStrategy` and returning a `ScrapingResult` (cleaned_html, links, media, metadata). ([Crawl4AI Documentazione](https://docs.crawl4ai.com/core/content-selection/ "Content Selection - Crawl4AI Documentation (v0.8.x)"))

So our idea of a “crawl4ai custom tool” is not only feasible, it’s the intended extension point.

#### E) Bot mitigation (progressive escalation)

Crawl4AI includes a stealth mode and an “undetected browser” mode for tougher anti-bot stacks like Cloudflare or DataDome, with a recommended progressive approach (regular → stealth → undetected). ([Crawl4AI Documentazione](https://docs.crawl4ai.com/advanced/undetected-browser/ "Undetected Browser - Crawl4AI Documentation (v0.8.x)"))

#### F) Multi-URL crawling + rate limiting + cache modes

- Rate limiting knobs exist (delay ranges, retries, backoff on 429/503). ([Crawl4AI Documentazione](https://docs.crawl4ai.com/advanced/multi-url-crawling/ "Multi-URL Crawling - Crawl4AI Documentation (v0.8.x)"))

- CacheMode supports enabled/disabled/read-only/write-only/bypass. ([Crawl4AI Documentazione](https://docs.crawl4ai.com/core/cache-modes/ "Cache Modes - Crawl4AI Documentation (v0.8.x)"))

This matters for MCP automation: tools should be **idempotent and cache-aware** or you’ll burn our budget and  our atience.

---

## How I would upgrade our MCP design using both (concretely)

Your current design is already coherent: extraction → graph → analysis. 【152:1†SEO-SEMANTIC-MCP-OVERVIEW.md†L17-L36】  
The missing robustness is mostly: **input sanitation**, **provenance**, and **controlled extraction granularity**.

### Step 1: Add a Crawl tool before “seo_extract_entities”

Add an MCP tool like:

- `seo_crawl_fetch(url, mode, query?) -> {fit_markdown, raw_markdown, cleaned_html, title, meta, links}`

Implementation detail: Crawl4AI is Python-first, while our MCP server is TypeScript. You have 3 sane options:

1. Run Crawl4AI as a separate Python microservice (recommended for stability).

2. Spawn a Python worker from Node for crawl jobs (fine, but manage concurrency).

3. Use the Crawl4AI CLI as a subprocess (works, less elegant).

Use **fit_markdown** as our default downstream input. ([Crawl4AI Documentazione](https://docs.crawl4ai.com/core/fit-markdown/ "Fit Markdown - Crawl4AI Documentation (v0.8.x)"))

### Step 2: Make our entity extraction run on fit_markdown

Your overview says entity extraction uses TextRazor with disambiguation to Wikidata IDs. 【152:4†SEO-SEMANTIC-MCP-OVERVIEW.md†L48-L56】

That’s fine, but fs

- more stable centrality scores

- less “site template” bias in SERP comparisons

### Step 3: Use NuExtract 2.0 8B for relation extraction as “schema-to-triples”

NuExtract is template-driven, so define a minimal JSON shape for relations. Example pattern (keep it small per call):

```json
{
  "relations": [
    {
      "subject": "verbatim-string",
      "predicate": ["defines", "includes", "compares_to", "causes", "requires", "improves", "uses"],
      "object": "verbatim-string",
      "evidence": "verbatim-string"
    }
  ]
}
```

Why `verbatim-string` so much? Because it forces “show me the receipt” extraction. ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

Then:

- Run this per **section** (split by headings from markdown), not per whole document.

- Write each extracted relation into our KG with:
  
  - URL
  
  - section heading
  
  - evidence sentence
  
  - confidence heuristics (e.g., evidence length, duplication across pages)

### Occurrence graph

Your graph layer now defaults to structured proximity (sentence/paragraph/section) with optional PMI weighting when blocks are available. The 5-word window remains as a fallback mode.

Keep it, but upgrade it:

- Co-occurrence edges become “soft topical proximity”

- Extracted relations become “hard semantic edges”

Then our betweenness centrality stops being “who appears near everyone in paragraphs” and becomes closer to “who actually connects concepts”.

### Step 5: Make Crawl4AI and NuExtract talk through a single interface (optional but clean)

Crawl4AI’s LLM extraction layer is provider-agnostic through **LiteLLM** and supports chunking + using `fit_markdown` as LLM input. ([Crawl4AI Documentazione](https://docs.crawl4ai.com/extraction/llm-strategies/ "LLM Strategies - Crawl4AI Documentation (v0.8.x)"))

If you serve NuExtract behind an OpenAI-compatible endpoint (via vLLM), you can wire Crawl4AI’s extraction strategy to our own hosted model. ([GitHub](https://github.com/numindai/nuextract "GitHub - numindai/nuextract"))

One warning: Crawl4AI’s LLM extraction expects JSON schema/Pydantic-style workflows, while NuExtract expects its template typing (`verbatim-string`, enums, etc.). So either:

- use Crawl4AI only for crawling + markdown + chunking, and call NuExtract yourself, or

- write a thin adapter that converts y(doable), or

- implement a custom Crawl4AI extraction strategy that calls NuExtract directly.

Given you care about “maneggevoli”, I’d do: **Crawl4AI for content, NuExtract for extraction**, with our own adapter in between.

---

## 4) The 3 biggest robustness wins you can implement immediately

1. **Implemented (Phase 2):** Base tools default to Crawl4AI `fit_markdown` for graph input (pruning/BM25). ([Crawl4AI Documentazione](https://docs.crawl4ai.com/core/fit-markdown/ "Fit Markdown - Crawl4AI Documentation (v0.8.x)"))

2. **Add provenance to every extracted triple** (evidence as verbatim-string). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

3. **Chunk by structure (headings/sections), not by arbitrary token windows**, and keep templates small to avoid NuExtract “laziness”. ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction  - NuMind"))

---

## GPT-5.2 vs NuExtract vs OneKE

### If you care about **highest quality on messy web text**

**GPT-5.2** wins *on raw capability* (reasoning, ambiguity, weird layouts, implicit relations).  
But: you’ll pay with **cost + variance**, and you still need “evidence discipline” because JSON compliance ≠ factual correctness. If you use **Structured Outputs (JSON Schema enforcement)** you can at least make outputs reliably parseable. ([platform.openai.com](https://platform.openai.com/docs/guides/structured-outputs?utm_source=chatgpt.com "Structured model outputs | OpenAI API"))

**Use GPT-5.2 for:**

- schema bootstrapping (“what relations matter for this vertical?”)

- hard pages (marketing fluff, ambiguous claims, long comparisons)

- adjudication/validation (spot-check NuExtract output, disagreement resolution)

### If you care about **deterministic, scalable extraction**

**NuExtract (2.0)** is the better fit as our *default extractor*. It’s explicitly built for “document → JSON template filling,” and supports types like `verbatim-string` to force copying spans from source (huge for provenance). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B?utm_source=chatgpt.com "numind/NuExtract-2.0-8B"))  
NuMind also positions NuExtract 2.0 as tuned to prefer structured extraction behavior (and discusses limits like context window and occasional “lazy” sparse outputs). ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction?utm_source=chatgpt.com "NuExtract 2.0: Outclassing Frontier LLMs in Information ..."))

**Use NuExtract for:**

- bulk extraction at scale (cheaper, local, consistent)

- strict evidence-backed KG edges (span-based)

- multilingual structured fields (entities/attributes/claims/relations)

### If you care about **end-to-end schema-guided KE workflow**

**OneKE** is less “a model” and more “a system”: dockerized, schema-guided, multi-agent, supports web + raw PDFs, and includes a configurable knowledge base for schema config + debugging/correction. ([GitHub](https://github.com/zjunlp/OneKE?utm_source=chatgpt.com "zjunlp/OneKE: [WWW 2025] A Dockerized Schema-Guided ..."))

**Use OneKE for:**

- complex schemas where you want orchestration and error-case tooling

- PDFs / book-like sources where extraction needs a workflow

- “heavy mode” runs (lower throughput, higher process overhead)

---

## Where Crawl4AI fit_markdown fits in (and why it matters more than people admit)

Your graph used to be sensitive to junk text (nav/footer/sidebar) because edges were built from raw proximity/co-occurrence. The system now defaults to **Crawl4AI fit_markdown**, which filters markdown down to the “core” content using pruning/BM25-style filtering and removes repetitive sidebars and other low-value blocks. ([Crawl4AI Documentazione](https://docs.crawl4ai.com/core/fit-markdown/?utm_source=chatgpt.com "Fit Markdown with Pruning & BM25"))

This makes *every* extractor look smarter, because you stop feeding itcorrect recommendation for our stack

1. **Crawl4AI fit_markdown** as the default content feed. ([Crawl4AI Documentazione](https://docs.crawl4ai.com/core/fit-markdown/?utm_source=chatgpt.com "Fit Markdown with Pruning & BM25"))

2. **NuExtract 2.0** as the default structured extractor (entities + relations + evidence). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B?utm_source=chatgpt.com "numind/NuExtract-2.0-8B"))

3. **GPT-5.2** as a *selective* fallback and as a validator (and for schema evolution), using JSON Schema Structured Outputs for robustness. ([platform.openai.com](https://platform.openai.com/docs/guides/structured-outputs?utm_source=chatgpt.com "Structured model outputs | OpenAI API"))

4. **OneKE** only for “heavy mode” (PDFs, complex schemas, debugging runs), not for our everyday SERP-scale throughput. ([GitHub](https://github.com/zjunlp/OneKE?utm_source=chatgpt.com "zjunlp/OneKE: [WWW 2025] A Dockerized Schema-Guided ..."))

So: GPT-5.2 is the best brain, NuExtract is the best factory, OneKE is the best assembly line when you actually need a factory *with* supervisors and QA. Fit_markdown is the janitor that keeps all of them from slipping on the same banana peel.

---

### Crawl4AI’s “fit_markdown” BM25 Queries:

1. **Query-aware**: you give it a query (or queries), and it prunes/keeps blocks that score well (BM25-ish relevance).

2. **Query-less / heuristic pruning**: it removes obvious boilerplate and low-signal blocks without needing you to specify anything.

So **you do not always need queries**, but **if you want BM25-style “focus on X” filtering, you do**. The docs describe `fit_markdown` as a filtered/pruned markdown output and mention BM25-style relevance as an option for query-focused filtering.

(You linked the doc; I’m not pretending the web needs your queries for basic cleanup.)

---

## “But how do I know the queries in advance?”

You usually don’t. You *manufacture* them from context. For SEO you have multiple good sources:

### 1) Use the seed you already have (the cheapest answer)

- If you’re crawling because of a **SERP keyword**, that keyword is the query.

- If you’re crawling a page because it belongs to a **cluster/topic**, the cluster label is the query.

- If you’re crawling a competitor page mapped to a **money page**, use that page’s primary topic entity + a few modifiers.

This sounds obvious because it is.

### 2) Derive queries automatically from the page itself (no prior knowledge required)

Run a quick, cheap pass *before* pruning:

- Extract **title + H1 + top H2s**

- Extract **top entities** (your existing TextRazor/NuExtract pass)

- Extract **top n-grams** (YAKE/RAKE/BM25 keywords)

Then build 3–10 “micro-queries” like:

- `"{{title}}"` (or cleaned title tokens)

- `"{{H1}}"`

- `"{{entity_1}} {{entity_2}}"`

- `"{{entity_1}} {{category}}"`

- `"{{top_keyword_phrase}}"`

Feed those to fit_markdown as your query set.

This is usually better than using a single query because pages are multi-section.

### 3) Use a “query bank” per vertical (best for production)

For each domain/vertical you support, maintain a small set of canonical queries:

- product pages: `price`, `features`, `specs`, `benefits`, `reviews`, `warranty`, `shipping`, `returns`

- SaaS pages: `pricing`, `integration`, `API`, `security`, `SOC 2`, `GDPR`, `use cases`

- medical: `symptoms`, `treatment`, `diagnosis`, `side effects`, `contraindications`

You’re doing SEO automation. You already know the recurring intents. Pretending you don’t is cosplay.

### 4) Use your KG as the query generator (the fancy answer that actually makes sense)

Once you have a graph:

- pick the page’s **top central entities**

- pick the cluster’s **bridge entities**

- generate queries like `"entity + relation"` or `"entity + attribute"`

Example:  
If cluster = “ketogenic diet psychiatry” and the page includes entities `ketogenic diet`, `bipolar disorder`, `mood stabilization`:

- queries: `"ketogenic diet bipolar disorder"`, `"ketogenic diet mood stabilization"`, `"ketogenic diet mechanism"`

Those queries focus pruning on the parts you care about for *that* graph analysis.

---

## A robust strategy for your MCP pipeline (so you don’t have to “know in advance”)

Do it in two passes:

### Pass A: cheap extraction (no pruning yet)

- crawl page → raw markdown

- parse structure (title/H1/H2)

- extract quick entities/keywords

### Pass B: fit_markdown with generated queries

- create query set from Pass A

- run fit_markdown(query_set)

- run your “real” extraction (NuExtract/OneKE/TextRazor) on fit_markdown

This makes pruning adaptive and removes the need for hardcoded queries.

---

## When you should *not* use query-based pruning

If your goal is **site-wide KG coverage**, query-based pruning can bias the graph (you’ll keep only what matches the query and miss secondary topics). In that scenario:

- use query-less boilerplate removal

- keep more content

- rely on downstream weighting/normalization instead of aggressive pruning

---

## Quick rules of thumb

- **You have a target keyword / SERP intent?** Use it as the query.

- **You don’t?** Generate 5–10 micro-queries from title/headings/entities.

- **You’re building a “whole site” graph?** Avoid query pruning; do heuristic cleanup only.

---

# PHASE 3: Schema Bootstrapping

Fine. You liked the schema bootstrap idea because it turns “vertical understanding” into something you can *version, test, and automate* instead of vibes. Let’s build it properly.

## Goal

Given a vertical (e.g., “CRM”, “physiotherapy”, “ketogenic psychiatry”, “hotel booking”), automatically produce:

1. **A compact relation ontology** (your predicates) that is actually useful for SEO analysis

2. **Extraction templates** (NuExtract 2.0 JSON templates) per page type/section

3. **Validation rules + a test set** so the schema doesn’t rot the moment you scale

And we’ll use:

- **GPT-5.2** for *bootstrapping + adjudication*

- **NuExtract 2.0** for *production extraction*

- **Crawl4AI fit_markdown** to avoid feeding garbage to both

---

# Schema Bootstrapping Pipeline (vertical → relations → templates)

## Phase 0: Define “vertical” like an adult

Vertical schema cannot be universal. You need a scoping object:

- **Vertical name**: “B2B CRM”

- **Audience intents**: informational / commercial / transactional / navigational

- **Page archetypes** (very important):
  
  - category / landing
  
  - product page
  
  - comparison (“X vs Y”)
  
  - pricing
  
  - integration docs
  
  - support/FAQ
  
  - blog educational

- **Entity types you care about** (minimally): Product, Brand, Feature, UseCase, Industry, Integration, KPI, Limitation, Requirement, PricingPlan, Claim

This is one JSON object you can keep under version control and pass to tools.

---

## Phase 1: Build a small, representative corpus (Crawl4AI + fit_markdown)

Bootstrapping works only if your corpus isn’t trash.

**Input sources:**

- Your site pages for the vertical (top 30–100)

- Top SERP competitors for 10–20 core queries (top 3–5 results each)

- Optionally: authoritative docs (Wikipedia-ish or vendor docs)

**Crawl output should include:**

- `fit_markdown` (default)

- `raw_markdown` (for debugging)

- heading tree + section boundaries

**Why fit_markdown matters:** It strips nav/footer/sidebar boilerplate so your “relations” aren’t 40% “Privacy Policy → Cookie Settings”.

---

## Phase 2: Candidate relation mining (GPT-5.2, *not final*, just mining)

Here GPT-5.2 is not extracting final KG edges. It’s doing a *linguistic reconnaissance mission*:

### 2.1 Extract candidate triples from chunks

From each page section (H2 subtree), ask GPT-5.2 to output:

- candidate triples ⟨subject span, predicate phrase, object span⟩

- evidence snippet

- section type guess (Definition, Feature list, Comparison, Steps, Requirements, Pricing, Integration, FAQ)

**Important:** allow messy predicate phrases for now. This is *mining*, not ontology.

### 2.2 Normalize predicate phrases into a compact predicate set

Across the corpus, GPT-5.2 groups predicate phrases into canonical predicates.

Example mapping:

- “includes”, “comes with”, “offers” → `includes`

- “works with”, “integrates with”, “connects to” → `integrates_with`

- “better than”, “outperforms”, “vs” → `compares_to`

- “requires”, “needs” → `requires`

### 2.3 Output a draft ontology with constraints

For each canonical predicate:

- domain types (what can be subject)

- range types (what can be object)

- polarity/modality (asserted vs recommended vs hypothetical)

- typical evidence patterns

This is where you get a usable schema instead of a thesaurus explosion.

---

## Phase 3: Turn ontology → NuExtract templates (production)

Now we convert that predicate set into **NuExtract 2.0 templates** you can run at scale.

### Template strategy: don’t make one giant template

Split by section/page archetype, because large templates trigger sparse “lazy” outputs and are harder to debug.

Recommended template modules:

1. **Entity inventory** (per section)

2. **Relations** (per section, constrained to your predicates)

3. **Claims / Comparisons / Limits** (for trust + differentiation metrics)

4. **Pricing facts** (only on pricing pages)

5. **Integration facts** (only on integration pages)

### Example: Relations template (NuExtract-style)

Use a small, strict relation enum and force evidence to be copied.

```json
{
  "relations": [
    {
      "subject": "verbatim-string",
      "subject_type": ["Product", "Feature", "UseCase", "Integration", "Brand", "KPI", "Plan", "Requirement", "Limitation"],
      "predicate": ["includes", "requires", "integrates_with", "improves", "reduces", "supports", "compares_to", "has_pricing_plan", "targets_industry", "solves_problem", "has_limitations"],
      "object": "verbatim-string",
      "object_type": ["Product", "Feature", "UseCase", "Integration", "Brand", "KPI", "Plan", "Requirement", "Limitation", "Industry"],
      "evidence": "verbatim-string",
      "modality": ["asserted", "recommended", "hypothetical"],
      "polarity": ["positive", "negative", "neutral"]
    }
  ]
}
```

That’s your production workhorse.

---

## Phase 4: Adjudication loop (GPT-5.2 validates NuExtract output)

This is where GPT-5.2 earns its keep without bankrupting you.

### When to escalate to GPT-5.2

Trigger escalation only if:

- NuExtract returns relations with missing evidence

- evidence doesn’t contain subject/object spans (string containment check)

- predicate is ambiguous (low confidence heuristic)

- relation conflicts with an existing asserted fact (same S-P but different O)

- high-impact pages (money pages) or bridge candidates in your graph

### GPT-5.2 adjudication tasks

1. **Evidence check**: “Is this triple supported by the evidence snippet? Yes/No”

2. **Predicate correction**: choose the best predicate from your enum

3. **Entity typing**: ensure subject/object types are plausible

4. **Conflict resolution policy** (don’t “pick a truth”, record disagreement with provenance)

This keeps your KG from becoming a confident liar.

---

# The real deliverable: a versioned “Vertical Schema Pack”

At the end of bootstrap, you store a package like:

```
verticals/crm/
  schema_v1.json
  predicates.json
  entity_types.json
  templates/
    relations_section.json
    entities_section.json
    pricing_page.json
    comparison_page.json
  tests/
    gold_cases.jsonl
    regression_pages.txt
  mappings/
    schema_org_alignment.json
    wikidata_linking_hints.json
```

And you bump versions when:

- you add a predicate

- you change domain/range constraints

- you change templates

This is how you avoid “we changed one prompt and now the graph is different, cool.”

---

# MCP Tooling Design for Schema Bootstrap

Here’s the minimal MCP tool suite that makes this pipeline automatable:

1. `vertical_bootstrap_corpus(vertical_config) -> {page_list, chunks, metadata}`

2. `vertical_mine_candidates(chunks) -> {raw_triples, section_labels}`

3. `vertical_propose_ontology(raw_triples) -> {predicates, constraints, examples}`

4. `vertical_generate_templates(ontology, vertical_config) -> {templates[]}`

5. `vertical_build_goldset(sample_triples) -> {gold_cases.jsonl}`

6. `vertical_eval_extractor(templates, goldset) -> metrics`

7. `vertical_adjudicate(disagreements) -> corrected_triples + reasons`

Production then just uses:

- `crawl(url)->fit_markdown`

- `extract_nuextract(template, chunk)`

- `link_entities(wikidata)`

- `validate/adjudicate_if_needed`

---

# What predicates should look like for SEO analysis

Since your end goal is SEO metrics, predicates should align to things you can measure:

### Coverage predicates (topic completeness)

- `defines`, `includes`, `explains`, `has_steps`, `has_requirements`

### Commercial predicates (conversion relevance)

- `has_pricing_plan`, `has_trial`, `has_guarantee`, `has_limitations`, `targets_industry`

### Competitive predicates (SERP differentiation)

- `compares_to`, `alternatives_to`, `better_for`, `worse_for`

### Authority predicates (E-E-A-T-ish signals, but grounded)

- `cites_source`, `mentions_standard`, `mentions_regulation`, `has_author`, `has_credentials`

Those become your graph edge types, your gap analysis dimensions, your brief generator inputs.

---

# Next step you can implement immediately

Pick one vertical you actually care about, and run the bootstrap on **30 pages** (not 300). The pipeline needs iteration, not scale.

If you do it right, you’ll end up with:

- a stable predicate set (usually 20–60 predicates, not 500)

- extraction templates that don’t hallucinate

- a goldset that catches regressions

- and a KG that measures something real instead of your site’s footer

Humans love building giant ontologies first. That’s how you get a beautiful schema and no product. This approach gets you something that survives production.

---

https://docs.crawl4ai.com/core/adaptive-crawling/
https://docs.crawl4ai.com/core/fit-markdown/
https://docs.crawl4ai.com/core/markdown-generation/
https://docs.crawl4ai.com/core/content-selection/
https://docs.crawl4ai.com/advanced/adaptive-strategies/
https://docs.crawl4ai.com/advanced/lazy-loading/
https://docs.crawl4ai.com/advanced/undetected-browser/
https://docs.crawl4ai.com/advanced/multi-url-crawling/
https://docs.crawl4ai.com/advanced/crawl-dispatcher/
https://docs.crawl4ai.com/extraction/no-llm-strategies/
https://docs.crawl4ai.com/extraction/llm-strategies/
https://docs.crawl4ai.com/extraction/clustring-strategies/
https://docs.crawl4ai.com/api/strategies/
https://docs.crawl4ai.com/api/c4a-script-reference/


