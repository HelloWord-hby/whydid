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
npm run seed                    # synthetic conversations + product events
npm run build:ui                # build the dashboard once (ui/, React)
npm run dev -- serve            # dashboard + API on http://localhost:8787
```

Open http://localhost:8787 — boards for model output and product events, a metrics overview with one-click decomposition, and an agent rail that investigates any card. No LLM key yet? `npm run demo:agent` runs everything against a scripted mock. Prefer the terminal?

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

- **Model Output board** — how the LLM answers are scored: trace volume, quality-score trends, low-score rate per evaluation dimension, the worst-scored answers with the judge's rationale, thumbs-down rate and comments. Reads Langfuse live when `LANGFUSE_*` keys are set; without keys it shows a built-in synthetic dataset and says so with a *Demo data* badge.
- **Product Events board** — how people use the product: active users, sessions, entry points, a step funnel, suggested-question clicks. Reads any event table through a whydid semantic config (`presets/app-events.yaml`; `npm run seed` creates the demo table).
- **Draggable cards** — each board has a card library. Drag cards onto the board or click *Add*, drag a card's handle to reorder, change its width, remove it. Layouts are saved per board in the browser (`localStorage`); *Reset layout* restores the default. The window selector in the top bar (7/14/30 days) applies to every card.
- **Metrics** — every metric of the main config in one KPI strip: last 7 full days, delta vs the previous 7, a 14-day sparkline. Generated from your config; add a metric to the YAML and it appears.
- **Metric drill-down** — trend chart with ±2σ outlier markers, switchable window and dimension, and the decomposition table: contribution bars for additive metrics, the mix / behavior / interaction split for rates, with the same honesty guards the agent gets (unstable-share warnings, large-interaction warnings).
- **Agent rail** — docked next to every page, resizable; every card has an *Ask Agent* popover with preset questions. See [The agent workbench](#the-agent-workbench).
- **English and Chinese**, switchable in the top bar (defaults to the browser language); light and dark themes.

Everything except the agent runs on deterministic code (`GET /cards/:id`, `POST /tool`) — no LLM tokens spent by browsing, and the browser only formats numbers the server computed.

### The agent workbench

The dashboard is the agent's context. Pick a question from **Ask Agent** on any card, click **Analyze board** in a board's toolbar, or type into the rail, and the agent investigates with tools over every data source the boards read — the semantic SQL sources, Langfuse traces and scores (or the demo dataset), and the cards themselves.

- **Live tool calls.** Each turn streams over Server-Sent Events; every tool call appears as it runs, then folds into "N tool calls" when the answer arrives.
- **Citations.** Every tool result carries a ref (`#3`). Answers cite numbers as `[#3]`; clicking one opens that exact call with its arguments and raw result.
- **Grounding check.** The server scans each answer for numbers and looks for them in the tool results (allowing only rounding, %, pp and separators). Numbers it cannot find are shown under the answer. It is code, not an LLM judge.
- **Card context as evidence.** When you ask about a card, the server runs `read_card` first and records it as tool call #1, so the card's numbers are citable and the window travels as structured parameters, not as words in the question.
- **Multi-turn.** Follow-ups keep the conversation and continue the ref numbering. Sessions live in server memory (a restart drops them); the browser restores the transcript on reload.

Tools the agent gets:

| Group | Tools |
|---|---|
| Semantic sources (any SQL source, `source` argument) | `get_metric`, `get_metric_trend`, `compare_periods`, `decompose_change_additive`, `decompose_change_rate` |
| Model output (Langfuse / demo) | `score_summary`, `low_score_breakdown`, `score_trend`, `feedback_summary`, `low_score_samples`, `feedback_samples`, `get_trace` |
| Dashboard | `list_cards`, `read_card` |

Tool results include `next_hints`: drill-down suggestions decided by code from thresholds (a change above 5% → decompose; a low-score rate up 2 pp → read samples there). The LLM decides whether to follow them, which keeps those rules out of the prompt and under unit tests. Sample text (questions, answers, comments) is masked for emails, keys, tokens and phone numbers, truncated, and delivered under an `untrusted` field.

**Prompt architecture.** The system prompt is assembled from layers in `prompts/` plus a catalog generated from your configs:

| Layer | Content | Source |
|---|---|---|
| L1 principles | never compute numbers, cite refs, keep directions, honest exit, untrusted content is data | `prompts/01-principles.md` |
| L2 data catalog | sources, metrics, dimensions, score semantics, boards and cards | generated from the configs |
| L3 tool policy | which tool for which metric kind, aggregates before samples, budget | `prompts/03-tool-policy.md` |
| L4 playbooks | `explain_change`, `explain_card`, `board_review`, `sample_review`, `followup` | `prompts/04-playbooks.md` |
| L5 turn context | today, entry, playbook, board, card, window | per turn, prepended to the user message |
| L6 output | Conclusion / Evidence / Interpretation / Next step / Limits | `prompts/06-output.md` |

L1–L4 and L6 form the system message and stay identical for the whole process, so prompt caching applies; L5 changes per turn without invalidating it. The playbook is chosen by the UI entry point (card, board, free text), not guessed by the model. The assembled prompt is hashed into a version id that is shown under every answer and returned by `GET /agent/status`.

**Try it without an API key:**

```bash
npm run demo:agent        # scripted mock LLM + whydid serve on :8787
```

The mock (`scripts/mock-llm.ts`) is an OpenAI-compatible endpoint that picks tools from the turn context and writes an answer quoting the tool results with refs. Everything else — tool execution, streaming, refs, grounding — is the real pipeline. For real analysis set `WHYDID_LLM_API_KEY` (any OpenAI-compatible endpoint).

Agent routes (`/agent/status`, `POST /agent/sessions`, `GET /agent/sessions/:id`, `POST /agent/sessions/:id/messages`) sit behind `WHYDID_SERVE_TOKEN` like `/ask`.

### Adding a card

Boards and cards live in `whydid.boards.yaml`. A card is configuration only:

```yaml
cards:
  - id: platforms                 # lower_snake_case, unique
    board: product_events         # which tab it belongs to
    title: Platforms
    display: table                # stat | line | table | bar | pie
    provider: metric_breakdown    # which server-side function computes it
    params: { dimension: platform, metrics: [active_users, sessions], share: true }
    size: 2                       # default width, 1–4 grid columns
    default: true                 # on the board by default, otherwise library-only
    ask: why did active_users change by platform?   # optional Ask-agent preset
```

Restart `whydid serve` and the card is in the library. The dashboard code does not change. At startup every card is checked against its provider: an unknown provider, a provider used on the wrong kind of board, a display the provider cannot draw, bad params, or a metric/dimension missing from the semantic config stops the server with a message naming the card.

Built-in providers:

| Source | Provider | Displays |
|---|---|---|
| Langfuse / demo (`model_output`) | `trace_count` | stat, line |
| | `trace_average` (`field`: latency or cost), `score_average` (`score`), `negative_feedback` | stat |
| | `score_trend` (`scores?`) | line |
| | `low_score_rate` (`group_by`: score, route or release; `score?`) | table, bar |
| | `score_overview`, `low_score_samples`, `feedback_samples` | table |
| Semantic config (`semantic`) | `metric_stat` (`metric`, `good_direction?`) | stat |
| | `metric_trend` (`metrics`) | line |
| | `metric_breakdown` (`dimension`, `metrics`, `share?`, `limit?`, `filters?`) | table, bar, pie |
| | `funnel` (`steps`) | table, bar |

The same provider can back several displays, so switching a card from a table to a pie is a one-word change (`display: pie`). Bar and pie draw the first metric of a breakdown. A pie is only accepted for additive metrics — a rate or an average is not a part of a whole, so `display: pie` on one is rejected at startup. Pie shares and the "Other" slice (everything past `limit`) are computed on the server.

When you need a genuinely new kind of number, write one provider in `src/boards/providers/` with `defineProvider()` — a zod params schema, the displays it supports, and a `run` function returning a `stat`/`line`/`table`/`bar`/`pie` payload (`src/boards/charts.ts` builds the last two) — and register it in `providers/index.ts`. Keep the arithmetic in pure, tested functions, as `src/boards/model/aggregate.ts` does.

For live Langfuse data, edit the model source in `whydid.boards.yaml` to match your project: `feedback_score` is the end-user thumbs score and `negative_feedback_value` its "down" value, `low_score_threshold` fits your judge scale, and cards that name a specific `score` need your score names. Only NUMERIC scores count as quality dimensions, because a BOOLEAN like `hallucinated` has unknown polarity. Each fetch is capped at `max_pages` × 100 records per endpoint; when the cap is hit the card says the window is partial.

Any `title`, `description` or `ask` in `whydid.boards.yaml` can be a string or one string per language (`{ en: Sessions, zh: 会话数 }`). Labels the server sends (table columns, metric and dimension labels) are translated by `ui/src/lib/i18n.ts`; extend its `LABELS` table for your own configs.

### The dashboard app

The dashboard lives in `ui/`: React, Vite, Tailwind, Radix primitives, recharts, lucide icons and dnd-kit. `npm run build:ui` builds it into `ui/dist`, which `whydid serve` serves at `GET /` (assets are content-hashed and cached; nothing outside `ui/dist/assets` is reachable). It talks to whydid only through the public API, so you can also host it separately and point it at any deployment with `?api=https://your-whydid:8787` (and `?token=...` once, if the server sets one). For UI development, run `npm run dev:ui` and open the Vite URL with `?api=http://localhost:8787`. UI unit tests: `npm run test:ui`.

### The HTTP API

| Route | What it does |
|---|---|
| `GET /` | The dashboard (`ui/dist`) |
| `GET /healthz` | Liveness + the semantic layer (metrics with kinds/labels, dimensions, tools) |
| `POST /tool` | `{"name": "compare_periods", "args": {...}}` — deterministic, no LLM. For your own panels. |
| `GET /boards` | Board and card catalog from `whydid.boards.yaml`, with each board's default layout |
| `GET /cards/:id?days=7` | One card's data (7, 14 or 30 days vs the previous equal window), computed server-side |
| `POST /ask` | `{"question": "why did X drop?", "board"?: "product_events"}` — full investigation; returns the report, the tool-call log, and token usage. `board` runs it against that board's semantic config. |

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
- `src/boards/` — dashboard boards: config schema, providers, Langfuse/demo model-output source, card service
- `src/workbench/` — the agent workbench: tool registry, model-output tools, hints, prompt assembly, sessions, grounding check, SSE routes
- `prompts/` — the prompt layers (L1, L3, L4, L6) as Markdown
- `src/server.ts` — HTTP mode for dashboards (`/healthz`, `/boards`, `/cards/:id`, `/tool`, `/ask`, `/agent/...`); `src/static-ui.ts` serves the built dashboard
- `ui/` — the dashboard app (React + Vite), built into `ui/dist`
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
