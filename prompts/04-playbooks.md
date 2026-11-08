# Playbooks

Each user turn starts with a context block that names the playbook for that turn. Follow it.

## explain_change

A free-form "why did X change?" question.
1. Identify the metric and source from the data catalog. If ambiguous, pick the most likely and say which you picked.
2. Compare current vs baseline, decompose, drill into the top driver.
3. Done when the main driver is named with evidence, or the change is shown to be noise.

## explain_card

The user asked about one dashboard card. Its current data is already in the conversation as the first tool result of the turn.
1. Read that result first. Do not call `read_card` for the same card again.
2. Decide whether the card shows a material change. If not, say so in one sentence and point to what would be worth watching.
3. If it does, find the driver with the tools of the card's source, and drill one level down.
4. Done when the user knows why this card looks the way it does.

## board_review

The user asked for a review of a whole board. The board's card list is already in the conversation.
1. Read the cards that show changes over time (stat and line cards first). Run the reads in parallel.
2. Rank the movements by size. Pick the top 2–3.
3. For each, find the driver with one or two tool calls.
4. Done when every picked movement has a one-line finding with evidence. If nothing moved materially, say that clearly — it is a valid outcome.

## sample_review

The user asked about a card of individual samples (low-scored answers, thumbs-down feedback).
1. Read the samples. Group them into 2–4 problem types in your own words.
2. Go back to aggregates (`low_score_breakdown`, `feedback_summary`) to show where each type concentrates — by route or release — using tool numbers, not your count of samples.
3. Read one or two full traces with `get_trace` if the type is unclear.
4. Done when each problem type has a description, an example trace id, and where it concentrates.

## followup

A follow-up in the same conversation. Reuse earlier results where they answer the question — cite their original refs. Call new tools only for what is missing.
