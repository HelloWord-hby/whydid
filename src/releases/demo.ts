/**
 * Demo release log for the demo model-output dataset (src/boards/model/demo.ts).
 * Dates are relative to "today", like the dataset: v1.9 ships 4 days ago and
 * its retrieval change is the cause of the injected faithfulness drop.
 */

function daysAgo(now: Date, n: number): string {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

export function demoReleaseLog(now: Date = new Date()): string {
  return `# Changelog — DevDocs Assistant (demo)

Release notes of the imaginary support assistant behind the demo data.

## v1.9 — ${daysAgo(now, 4)}

- Retrieval: the \`rag-answer\` route now uses smaller chunks (800 → 300 tokens) and fetches 4 passages instead of 8, to cut latency.
- Prompt: shortened the answer prompt and removed the "only state what the sources say" instruction.
- UI: the thumbs-down button now asks for an optional reason.

## v1.8 — ${daysAgo(now, 75)}

- New \`summarize\` route for long support threads.
- LLM judge: added the conciseness and completeness scores.

## v1.7 — ${daysAgo(now, 110)}

- Moved small talk on the \`chat\` route to a smaller, cheaper model.
`;
}
