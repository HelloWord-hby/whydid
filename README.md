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
npm run dev -- serve            # dashboard + API on http://localhost:8787
```

Open http://localhost:8787 — the built-in observability dashboard shows every metric with week-over-week deltas and trends, one click decomposes any change, and the Ask view runs full investigations. Prefer the terminal?

```bash
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

## Connect it to your observability platform (Langfuse)

Observability platforms answer *what changed*; whydid answers *why*. The built-in Langfuse connector closes that loop:

```bash
export LANGFUSE_HOST=https://cloud.langfuse.com   # or your self-hosted URL
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...

whydid sync langfuse                 # incremental: traces + scores → PostgreSQL
whydid --config presets/langfuse.yaml ask "why did avg_latency_sec spike yesterday?"
```

What the sync does:

- Pulls traces (id, timestamps, user, session, release, version, environment, latency, cost) and scores through the stable page-based public API — works with Langfuse Cloud and self-hosted v2/v3.
- Pivots numeric and boolean scores into `score_<name>` columns, so every evaluation score becomes a decomposable rate metric. The sync prints ready-to-paste config for each score it finds.
- Is incremental and idempotent: a cursor plus a 1-hour overlap window with upserts, so re-runs and late-arriving data are safe. Run it from cron.
- Stores **no conversation content** — metadata and numbers only.

Typical questions once synced: "why did helpfulness drop after the v2 release?", "is the cost increase traffic mix or did a route get more expensive?", "which release drove the latency regression?"

No Langfuse at hand? `npx tsx scripts/mock-langfuse.ts` serves a deterministic fake instance (with an injected incident) to try the whole loop against.

## The observability dashboard

`whydid serve` ships a full dashboard at `GET /` — deploy the agent and the platform is already there:

```bash
whydid --config presets/langfuse.yaml serve --port 8787
```

- **Overview** — every configured metric as a card: last 7 full days, delta vs the previous 7, a 14-day sparkline. The card grid is generated from your config; add a metric to the YAML and it appears.
- **Metric drill-down** — trend chart with ±2σ outlier markers, switchable window (7/14/30d) and dimension, and the decomposition table: contribution bars for additive metrics, the mix / behavior / interaction split for rates, with the same honesty guards the agent gets (unstable-share warnings, large-interaction warnings).
- **Ask** — full investigations in the browser, with the report and the expandable tool-call audit trail. One click on any metric pre-fills "why did X change, which dimension drove it?".

Everything except Ask runs on `POST /tool` — deterministic SQL, no LLM tokens spent by browsing.

The dashboard is static files (`web/`, no build step). It talks to whydid only through the public API, so you can also host it separately and point it at any deployment with `?api=https://your-whydid:8787` (and `?token=...` once, if the server sets one).

### The HTTP API

| Route | What it does |
|---|---|
| `GET /` | The dashboard |
| `GET /healthz` | Liveness + the semantic layer (metrics with kinds/labels, dimensions, tools) |
| `POST /tool` | `{"name": "compare_periods", "args": {...}}` — deterministic, no LLM. For your own panels. |
| `POST /ask` | `{"question": "why did X drop?"}` — full investigation; returns the report, the tool-call log, and token usage |

```bash
curl -X POST localhost:8787/ask -d '{"question":"why did score_helpfulness drop in the last 3 days?"}'
```

The tool-call log in the response is the report's audit trail: every number in the narrative can be traced to the exact tool call that produced it.

Binds `127.0.0.1` by default. To expose it further, set `WHYDID_SERVE_TOKEN` (bearer auth) and use `--host` deliberately — `/ask` spends LLM tokens.

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
Langfuse ──sync──► PostgreSQL ◄──── your own event table works too
                       ▲ read-only session
                       │
question ──► orchestrator (LLM loop, max 12 turns, history compression)
   ▲             │  picks tools, enum-constrained by your config
   │             ▼
 CLI /        tools (validation, period guards, direction notes)
 HTTP serve      │
   ▲             ▼
   │         sql-builder (parameterized, identifiers from config only)
   │             │
   │             ▼
   └──────── report + tool-call audit trail
             (numbers verbatim from tools, narrative from LLM,
              attribution math in pure functions)
```

- `src/attribution/` — pure math, no I/O, fully unit-tested
- `src/core/` — periods & SQL building, pure, fully unit-tested
- `src/tools/` — the five tools + config-derived JSON schemas, zod-validated at dispatch
- `src/agent/` — LLM client (any OpenAI-compatible endpoint), system prompt builder, tool loop
- `src/connectors/langfuse/` — public-API client, pure transforms, incremental sync
- `src/server.ts` — HTTP mode for dashboards (`/healthz`, `/tool`, `/ask`)
- `src/demo/` — deterministic synthetic dataset; `scripts/mock-langfuse.ts` — fake Langfuse for local dev

## Notes

- **Proxy**: whydid uses Node's built-in `fetch`. On Node 24+, set `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1` to route LLM calls through a proxy.
- **Cost**: a typical investigation is 10–20 tool calls and ~30–60k tokens with the default model.

## Limitations

- One table/view per config. Join upstream: point `table` at a view.
- PostgreSQL only for now.
- Attribution is decomposition, not causal inference: it tells you *where* the change is concentrated, which is the right question to ask *before* asking why.

## License

MIT
