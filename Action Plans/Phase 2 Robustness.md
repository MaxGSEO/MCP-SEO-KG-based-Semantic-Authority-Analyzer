# How to make it *actually* robust (practical upgrades)

### 1) Fix graph construction first (biggest ROI)

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

Default: **vLLM OpenAI server (official) + pinned config**

- Use vLLM’s official Docker image (`vllm/vllm-openai`) and pass NuExtract-specific flags (`--trust_remote_code`, multimodal limits, chat template format) as NuExtract recommends. ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B-GPTQ?utm_source=chatgpt.com "numind/NuExtract-2.0-8B-GPTQ · Hugging Face"))

- Put your **template JSON** in `chat_template_kwargs` exactly like you’re doing.

Two concrete upgrades to our MCP toolset

These are small changes that massively increase robustness.

### 1) Add an “evidence-first” contract to every tool output

Right now our examples show outputs but don’t explicitly enforce provenance everywhere.【46:3†SEO-SEMANTIC-MCP-OVERVIEW.md†L21-L44】  
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

## NuExtract‑2.0‑8B: worth it, with one big caveat

**What it is:** NuExtract 2.0 is a family of models from NuMind trained specifically for “document → JSON” extraction using a **JSON template** (schema). The 8B model is **multimodal** (text + images) and multilingual, and it’s **MIT licensed** (commercial-friendly). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

### Why it’s a good match for SEO KG automation

- **Structured extraction with a template**: you can force consistent output fields (entities, relations, evidence, section, intent labels, etc.). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

- **Precision bias**: their own write-up emphasizes preferring `null` over inventing facts, and explicitly training the model to say “I don’t know” when info isn’t present. That’s exactly what you want before writing anything into a KG. ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction - NuMind"))

- **Multimodal**: for SEO, this is sneakily useful. You can extract from:
  
  - PDFs/screenshots of SERP features
  
  - JS-heavy pages where “rendered view” is cleaner than DOM soup
  
  - tables or formatted blocks that text-only cleaners often mangle ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction - NuMind"))

### The caveat (and it matters): context length

NuExtract 2.0 models are described as **32k token context** in the NuMind post. That is plenty for many pages, but not “infinite”, and long “guide” pages can blow past it. ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction - NuMind"))

So our robustness depends on **how you chunk and how you design templates**.

### Known failure modes (their words, not mine)

They call out:

- **Long documents** (32k cap)

- **“Laziness”**: returning an almost-empty output when the template is complex and many requested fields are missing

- Rare **looping/repetition** in lists ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction - NuMind"))

This is fixable in an automated pipeline, but only if you build for it.

### Practical rules for using NuExtract 2.0 in our MCP pipeline

1. **Never run one giant mega-template** (“give me all triples, all entities, all attributes”). That’s how you get the “lazy output” problem. Split templates by task. ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction - NuMind"))

2. **Add provenance fields** everywhere (evidence sentence + section heading + source URL). And enforce `verbatim-string` for evidence so it must copy from input. ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

3. **Keep temperature at ~0** (they explicitly recommend this for extraction). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

4. Prefer a **two-pass extraction**:
   
   - Pass A: extract *candidate entities* + evidence
   
   - Pass B: extract *relations* only among the candidates, per section/chunk

5. Use **in-context examples** for our domain-specific relation ontology (SEO is full of recurring relation patterns). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

Two gotchas you should treat as “production requirements”

### 1) Chat templates and OpenAI content format

vLLM needs a proper chat template to run the Chat Completions API (or you’ll get errors / wrong formatting). vLLM docs call this out, and NuExtract’s vLLM command includes `--chat-template-content-format openai`. ([docs.vllm.ai](https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html?utm_source=chatgpt.com "OpenAI-Compatible Server — vLLM"))

### 2) `generation_config.json` can silently change defaults

vLLM warns that by default it applies the model repo’s `generation_config.json`, which can override sampling defaults. For extraction you want stable behavior (temp 0), so keep parameters explicit. ([docs.vllm.ai](https://docs.vllm.ai/en/v0.8.3/serving/openai_compatible_server.html?utm_source=chatgpt.com "OpenAI-Compatible Server — vLLM"))

---

Crawl4AI features that directly strengthen our KG + network metrics

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

This matters for MCP automation: tools should be **idempotent and cache-aware** or you’ll burn our budget and our atience.

---

How I would upgrade our MCP design using both (concretely)

Your current design is already coherent: extraction → graph → analysis. 【152:1†SEO-SEMANTIC-MCP-OVERVIEW.md†L17-L36】  
The missing robustness is mostly: **input sanitation**, **provenance**, and **controlled extraction granularity**.

### Step 1: Add a Crawl tool before “seo_extract_entities”

Add an MCP tool like:

- `seo_crawl_fetch(url, mode, query?) -> {fit_markdown, raw_markdown, cleaned_html, title, meta, links}`

Implementation detail: Crawl4AI is Python-first, while our MCP server is TypeScript. You have 3 sane options:

1. Run Crawl4AI as a separate Python microservice (recommended for stability).

2. 

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

Your graph layer is currently co-occurrence in a 5-word window. 【152:3†SEO-SEMANTIC-MCP-OVERVIEW.md†L45-L47】

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

#### The 3 biggest robustness wins

1. **Switch graph input from raw text to Crawl4AI fit_markdown** (pruning/BM25). ([Crawl4AI Documentazione](https://docs.crawl4ai.com/core/fit-markdown/ "Fit Markdown - Crawl4AI Documentation (v0.8.x)"))

2. **Add provenance to every extracted triple** (evidence as verbatim-string). ([Hugging Face](https://huggingface.co/numind/NuExtract-2.0-8B "numind/NuExtract-2.0-8B · Hugging Face"))

3. **Chunk by structure (headings/sections), not by arbitrary token windows**, and keep templates small to avoid NuExtract “laziness”. ([NuMind](https://numind.ai/blog/outclassing-frontier-llms----nuextract-2-0-takes-the-lead-in-information-extraction "NuExtract 2.0: Outclassing Frontier LLMs in Information Extraction - NuMind"))
