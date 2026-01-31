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
