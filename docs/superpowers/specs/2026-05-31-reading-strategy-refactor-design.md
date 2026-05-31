# Reading Strategy Refactor Design

## Context

WeRead AI Reader currently builds the AI request, prompt wording, JSON shape, parsing, debug request, and some display assumptions inside a small number of files. That was enough for the first "reading judgement" flow, but it makes the next step harder: the assistant now needs to show what the user should master next, ask questions the user should carry into reading, score the chapter, and support later model benchmarking across opencode go models.

The accepted direction is to split strategy, provider transport, and UI display into separate boundaries while keeping the existing snapshot upload plus SSE stream interaction.

## Goals

- Give the reader a faster answer to "what do I most need to master next?"
- Add chapter scoring with a 0-100 mastery value score and three sub-scores: information density, structural importance, and skip risk.
- Add 1-2 questions for the reader to ask while reading. These are not answered by the model and do not simulate a conversation with the author.
- Expand WeRead Skill usage with layered signals instead of indiscriminately calling every available endpoint.
- Make AI request construction and result parsing stable enough to reuse in model benchmarking.
- Preserve the current signal-first, SSE-streamed reading judgement flow.

## Non-Goals

- Do not add selected-text Q&A in this refactor.
- Do not simulate author answers.
- Do not introduce a multi-agent runtime for every chapter.
- Do not make `/shelf/sync`, `/readdata/detail`, or book recommendation endpoints part of the default per-chapter judgement path.
- Do not run the opencode go model benchmark as part of this refactor unless a separate implementation step supplies the model list and benchmark dataset.

## Domain Terms

- Public reading signals: chapter popular highlights, highlight comments, and public book reviews.
- Book context signals: book metadata, chapter catalogue, chapter word count, book rating, and current reading progress.
- Personal reading signals: the current user's highlights, ideas, reviews, and reading progress. These are optional enhancement signals.
- Mastery value score: a 0-100 score for how much attention this chapter deserves for understanding the book or continuing the reading path. It is not a literary-quality score.
- Questions for author: 1-2 questions the user should carry into reading. They contain no answers.

## Architecture

### Signal Layer

`server/createApp.js` should stop owning all signal assembly details directly. A dedicated signal-building boundary should normalize WeRead Skill responses into tiers:

- Public reading signals:
  - `/book/bestbookmarks`
  - `/book/readreviews`
  - `/review/list`
- Book context signals:
  - `/book/chapterinfo`
  - `/book/info`
  - `/book/getprogress`
  - `/store/search` only when the raw reader book id needs to be resolved to an official book id
- Optional personal reading signals:
  - `/book/bookmarklist`
  - `/review/list/mine`
  - `/book/underlines`

Personal signals should be guarded by server configuration so the default path can remain conservative and predictable.

### Strategy Layer

Add a reading strategy boundary that owns:

- Prompt version.
- Capture coverage interpretation.
- Stable AI input shape.
- Stable output schema.
- Backward-compatible mapping from old `conclusion` values to new `recommendation` values.
- Debug request input summaries.

The strategy layer should not perform network calls. It receives a normalized snapshot and normalized signal bundle, then returns provider-ready messages and parser expectations.

### Provider Layer

`llmClient` should focus on:

- OpenAI-compatible request transport.
- Streaming content deltas.
- Provider error handling.
- Parsing the final JSON into the strategy-owned schema.
- Exposing sanitized request debug data.

The provider layer should not decide which WeRead signals matter or what the product judgement fields mean.

### UI Layer

The extension should render a structured `readingJudgement` result. It should not rebuild a fallback prompt that can drift from the server. Debug output can still display the sanitized server-generated request.

## Output Schema

The new complete SSE payload should carry:

```json
{
  "readingJudgement": {
    "recommendation": "deep_read | quick_read | skip_read",
    "masteryScore": {
      "overall": 0,
      "informationDensity": 0,
      "structuralImportance": 0,
      "skipRisk": 0
    },
    "nextMustKnow": ["string"],
    "reasons": ["string"],
    "keyPassages": ["string"],
    "questionsForAuthor": ["string"],
    "readerPerspective": "string",
    "readingAdvice": "string"
  }
}
```

For compatibility during migration, the server may also expose `judgement` and `conclusion` fields derived from the new result:

- `deep_read` maps to old `worth_deep_read`
- `quick_read` maps to old `quick_read`
- `skip_read` maps to old `skip_read`

## Prompt Contract

The prompt should instruct the model to:

- Judge the current chapter only.
- Respect capture coverage. Partial captures must produce stage-aware advice.
- Use public reading signals first, book context second, and personal reading signals only when present.
- Return JSON only.
- Score mastery value, not literary quality.
- Produce questions for reading without answering them.
- Give explicit deep-read, quick-read, or skip-read advice.

## Error Handling

The server should distinguish critical and non-critical failures.

Critical failures:

- Invalid client token.
- Missing or invalid reading snapshot.
- WeRead authentication failure.
- No minimum chapter context can be built.

Non-critical failures should become warnings inside the signal bundle:

- `/book/info` unavailable.
- `/book/getprogress` unavailable.
- Public reviews unavailable.
- Personal signal calls unavailable or disabled.
- `/book/underlines` unavailable.

The UI should show warnings in the existing signal/debug areas without blocking the judgement when enough evidence remains.

## Model Benchmark Readiness

The refactor should make model benchmarking possible by exposing a stable strategy input and normalized output. A later benchmark runner can reuse the same request builder against multiple opencode go models and record:

- Time to first delta.
- Total completion time.
- JSON validity.
- Schema completeness.
- Score consistency.
- Human or rubric-based quality score for `nextMustKnow`, `questionsForAuthor`, and `readingAdvice`.

The benchmark should be a separate implementation step because it depends on current opencode go model availability and chosen sample chapters.

## Testing

Server tests should cover:

- Signal bundle contains public, book context, and optional personal tiers.
- `/book/info` and `/book/getprogress` are included in the default signal path.
- Non-critical signal failures return warnings instead of failing snapshot upload.
- Strategy input includes mastery score and questions-for-author output requirements.
- Parser normalizes missing or malformed model fields.
- SSE complete returns the new result shape and compatible old judgement shape during migration.

Extension contract tests should cover:

- Reading judgement renders mastery score.
- Reading judgement renders next must-know items.
- Reading judgement renders questions for author without answer labels.
- Reading advice still maps to deep-read, quick-read, and skip-read display labels.
- Debug output uses server-generated request data and no longer contains a separate divergent fallback prompt.

## Implementation Defaults

- Personal reading signals default to off and are enabled by an explicit server config flag such as `ENABLE_PERSONAL_SIGNALS=true`.
- `/book/underlines` is called only when `chapterUid` is available and popular highlight coverage is sparse, so it supplements weak text evidence instead of adding latency every time.
- The later benchmark runner should live under `scripts/` because it is an operator tool, not a regression test.
