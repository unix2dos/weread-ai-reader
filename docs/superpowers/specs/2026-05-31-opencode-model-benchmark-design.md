# Opencode Model Benchmark Design

## Context

The reading judgement flow now has a stable strategy boundary in `server/readingStrategy.js`. Model selection should use that same request and parser instead of ad hoc prompts, otherwise speed and quality comparisons will not match the production reading panel.

## Goal

Add a local operator tool that compares OpenAI-compatible models for the WeRead reading judgement task. The first version should answer which model is fast enough, returns valid structured JSON, fills the required schema, and gives useful `nextMustKnow`, `questionsForAuthor`, and `readingAdvice` fields.

## Non-Goals

- Do not change the Chrome extension or live server route.
- Do not add a database or persistent benchmark history.
- Do not include copyrighted chapter text in fixtures.
- Do not make human review mandatory for every benchmark run.

## Design

The benchmark runner lives at `scripts/benchmark-models.js`. It loads fixed synthetic samples from `scripts/fixtures/reading-strategy-samples.json`, calls each requested model with `buildRequestBody`, parses output with `parseReadingJudgement`, and emits a Markdown or JSON report.

The runner records:

- time to first content delta
- total completion time
- JSON validity
- schema completeness
- recommendation and mastery score
- automatic quality checks for actionable mastery output, answer-free author questions, reader perspective, and reading advice

`--models all` calls the configured OpenAI-compatible `/models` endpoint so opencode go model lists do not need to be hardcoded.

## Data Flow

`sample snapshot + signalPanel` -> `readingStrategy.buildRequestBody` -> `/chat/completions` -> streamed deltas -> `readingStrategy.parseReadingJudgement` -> quality scoring -> report.

## Error Handling

Each model/sample run is isolated. HTTP failures, invalid JSON, and schema failures become failed result rows instead of aborting the whole benchmark. Missing API keys, missing models, or missing samples fail before network calls.

Each model/sample call has a configurable timeout, defaulting to 45 seconds, so one slow or reasoning-heavy model cannot block the whole run.

## Testing

`test/model-benchmark.test.js` covers argument parsing, `/models` discovery, latency measurement, schema failure handling, quality scoring, and Markdown rendering with fake OpenAI-compatible streams.
