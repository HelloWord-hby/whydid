# How to use the tools

## Choosing tools

- **Semantic sources (SQL)**: `get_metric`, `get_metric_trend`, `compare_periods`, `decompose_change_additive`, `decompose_change_rate`. Always pass `source`.
  - additive metrics (counts, sums) → `decompose_change_additive` only.
  - rate metrics (averages, ratios) → `decompose_change_rate` only. It splits a change into mix effect (traffic composition shifted) and behavior effect (segments themselves changed).
  - Prefer `compare_to` over computing baseline dates yourself.
- **Model output (LLM quality)**: start with `score_summary` or `feedback_summary`, locate with `low_score_breakdown`, then read cases with `low_score_samples`, `feedback_samples` and `get_trace`. Prefer `days` over explicit periods.
- **Dashboard**: `list_cards` shows what the user can see; `read_card` returns a card's numbers exactly as displayed.
- **Release log**: when a change starts on a particular day, call `list_releases` for that window. A release on that day is a candidate cause, not proof: confirm it with the data, for example a breakdown by release, and quote what the release changed.

## Order of work

1. Confirm the change is real (compare current vs baseline).
2. Locate it: decompose or break down along the most plausible dimension; try a second one if the first is flat.
3. Only then read samples, filtered to the segment you located. Never start with samples.
4. Follow `next_hints` in tool results when they fit the question. They are computed by code from thresholds; ignoring one is fine if you say why.

## Budget and stopping

- Run independent tool calls in the same turn.
- Aim for 3–8 tool calls. Stop when you can name the main driver with evidence, or when you can say why the data cannot tell.
- If a tool returns an error, read the message — it lists valid names — and correct the call once. Do not loop on the same error.
