# whydid

An attribution agent that answers **"why did my metric change?"** over your product's event data.

Deterministic SQL does all the math. The LLM only decides which tool to call and narrates the results. It cannot compute a number, cannot write SQL, and cannot reference a metric that doesn't exist in your config.

```
$ whydid ask "why did resolution_rate drop in the last 7 days?"

**Conclusion** — Resolution rate fell 4.9pp (78.2% → 73.3%) over 2026-07-25 ~ 08-01
vs the prior week. It is almost entirely a behavior effect concentrated in
`integration` conversations served by model m-2.

**Facts** — decompose_change_rate by intent: behavior_effect −4.1pp (of which
integration −3.6pp), mix_effect −0.8pp (billing share grew from 15% → 21%). ...
```

## Why this exists

LLMs are unreliable at arithmetic, date math, and SQL over schemas they half-remember — exactly the three things a metrics question needs. Most "chat with your data" tools hand the LLM a SQL console and hope. whydid inverts that:

| Concern | Who owns it |
|---|---|
| Metric definitions | You, in one YAML file |
| SQL construction | Deterministic builder, parameterized, enum-validated |
| Date arithmetic ("last week", baselines) | Deterministic code |
| Attribution math | Pure functions (additive + Oaxaca-Blinder) |
| Deciding what to look at next | The LLM |
| Narrating what the numbers mean | The LLM |

Design rules that fall out of this:

- **The LLM never computes numbers.** Every figure in a report comes verbatim from a tool result.
- **Honest exit is a success state.** "The data cannot answer this" beats a confident wrong answer. Guards for data start dates, empty periods, and unstable decompositions are built into the tools, not left to prompt goodwill.
- **Tools carry `direction_note`.** Each comparison result states in words which period is the baseline and which way the metric moved. The narrator's one job is to not flip the sign — so the tools make the sign impossible to misread.
- **Metric-kind routing.** Count metrics decompose additively; rate metrics decompose via Oaxaca-Blinder. Using the wrong tool is rejected as a type error, because the result would be math-shaped nonsense.

## Quickstart (synthetic demo)

Requirements: Node 20+, Docker, an API key for any OpenAI-compatible endpoint with tool calling (OpenRouter, OpenAI, ...).

```bash
git clone https://github.com/<you>/whydid && cd whydid
npm install
docker compose up -d            # PostgreSQL on localhost:5433
cp .env.example .env            # add your WHYDID_LLM_API_KEY
npm run seed                    # 60 days of synthetic assistant conversations
npm run dev -- ask "why did resolution_rate drop in the last 7 days?" --verbose
```

The seed injects two findable incidents into the final week:

1. A model rollout (`m-2`) that tanks resolution of `integration` conversations — a **behavior effect**.
2. A billing-traffic surge — a **mix effect** on rates and the growth driver of volume.

Ask about them:

```bash
npm run dev -- ask "why did conversations grow last week?"
npm run dev -- ask "did the m-2 rollout change anything?"
npm run dev -- ask "why did resolution_rate drop? was it traffic mix or did something break?"
```

No LLM key? The deterministic layer works standalone:

```bash
npm run dev -- tool decompose_change_rate --args '{
  "metric": "resolution_rate",
  "period_a": {"from": "2026-07-18", "to": "2026-07-25"},
  "period_b": {"from": "2026-07-25", "to": "2026-08-01"},
  "dimension": "intent"
}'
```

## Pointing it at your data

Everything the agent knows about your product lives in `whydid.config.yaml`:

```yaml
table: my_conversations        # one row per event/conversation
time_column: created_at        # timestamptz
timezone: Asia/Tokyo           # dates & day-buckets follow this
data_start: "2025-09-05"       # queries before this are rejected, not empty

context: >-
  Free text describing your product, injected into the system prompt.

metrics:
  conversations:
    kind: additive             # counts/sums → additive decomposition
    expr: COUNT(*)
  resolution_rate:
    kind: rate                 # averages/ratios → Oaxaca-Blinder
    of: CASE WHEN resolved THEN 1.0 ELSE 0.0 END   # metric = AVG(of)
    note: Self-reported; trend and comparison are reliable, absolute level is soft.
  thumbs_up:
    kind: additive
    expr: COUNT(*) FILTER (WHERE feedback = 'up')
    decompose: false           # tiny samples → decomposition disabled, with reason

dimensions:
  intent:
    column: intent_category
    note: ~81% coverage; NULLs appear as "(null)".
    values:                    # optional display labels
      technical_support: Technical support
```

The `note` fields are the interesting part: coverage gaps, definition quirks, and known caveats get injected into the system prompt, so the agent states them instead of stepping in them.

Then set `DATABASE_URL` (read access is enough — the pool sets `default_transaction_read_only`, so PostgreSQL itself rejects any write) and ask away.

## The tools

| Tool | What it does |
|---|---|
| `get_metric` | One value over a period, optionally split by a dimension |
| `get_metric_trend` | Value per hour/day/week bucket, ±2σ outliers flagged |
| `compare_periods` | Current vs equal-length baseline (`prev_period` / `prev_week` / `prev_month` derived in code) |
| `decompose_change_additive` | Splits a count change into per-segment contributions, with a stability guard: when the total moved < 1%, share-of-delta is withheld (it would explode) and segments are ranked by `abs_contribution_share` instead |
| `decompose_change_rate` | Oaxaca-Blinder: splits a rate change into **mix effect** (traffic composition shifted) vs **behavior effect** (segments themselves changed), plus an explicit interaction term — when it exceeds 10% of the change, the split is flagged as approximate |

The mix/behavior distinction is the heart of rate attribution. "Resolution rate dropped" demands completely different action depending on whether cheap-to-resolve traffic went away (mix — nothing broke) or a segment actually got worse (behavior — go find what changed in it).

## Architecture

```
question ──► orchestrator (LLM loop, max 12 turns, history compression)
                 │  picks tools, enum-constrained by your config
                 ▼
             tools (validation, period guards, direction notes)
                 │
                 ▼
             sql-builder (parameterized, identifiers from config only)
                 │
                 ▼
             PostgreSQL (read-only session)  ──►  attribution math (pure fns)
                 │
                 ▼
             report (numbers verbatim from tools, narrative from LLM)
```

- `src/attribution/` — pure math, no I/O, fully unit-tested
- `src/core/` — periods & SQL building, pure, fully unit-tested
- `src/tools/` — the five tools + config-derived JSON schemas
- `src/agent/` — LLM client (any OpenAI-compatible endpoint), system prompt builder, tool loop
- `src/demo/` — deterministic synthetic dataset

## Notes

- **Proxy**: whydid uses Node's built-in `fetch`. On Node 24+, set `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1` to route LLM calls through a proxy.
- **Cost**: a typical investigation is 10–20 tool calls and ~30–60k tokens with the default model.

## Limitations

- One table/view per config. Join upstream: point `table` at a view.
- PostgreSQL only for now.
- Attribution is decomposition, not causal inference: it tells you *where* the change is concentrated, which is the right question to ask *before* asking why.

## License

MIT
