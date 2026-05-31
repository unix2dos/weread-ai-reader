#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  buildRequestBody,
  parseReadingJudgement
} = require('../server/readingStrategy');
const { readOpenAiContentDeltas } = require('../server/llmClient');

const DEFAULT_SAMPLE_FILE = path.join(__dirname, 'fixtures', 'reading-strategy-samples.json');
const DEFAULT_API_BASE = 'https://api.openai.com/v1';

function parseArgs(argv) {
  const args = {
    models: [],
    sampleFile: DEFAULT_SAMPLE_FILE,
    output: null,
    format: 'markdown',
    apiBase: null,
    apiKey: null,
    timeoutMs: 45000,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--models') {
      args.models = splitCsv(readValue(argv, ++i, arg));
    } else if (arg === '--sample-file') {
      args.sampleFile = readValue(argv, ++i, arg);
    } else if (arg === '--output') {
      args.output = readValue(argv, ++i, arg);
    } else if (arg === '--format') {
      const format = readValue(argv, ++i, arg);
      if (!['markdown', 'json'].includes(format)) {
        throw new Error(`Unsupported format: ${format}`);
      }
      args.format = format;
    } else if (arg === '--api-base') {
      args.apiBase = readValue(argv, ++i, arg);
    } else if (arg === '--api-key') {
      args.apiKey = readValue(argv, ++i, arg);
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = readPositiveInteger(readValue(argv, ++i, arg), arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function runBenchmark({
  apiBase = DEFAULT_API_BASE,
  apiKey,
  models,
  samples,
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 45000
}) {
  if (!apiKey) throw new Error('LLM_API_KEY is required');
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('At least one model is required');
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('At least one benchmark sample is required');
  }

  const generatedAt = new Date().toISOString();
  const results = [];

  for (const model of models) {
    for (const sample of samples) {
      results.push(await runOneModelSample({
        apiBase,
        apiKey,
        model,
        sample,
        fetchImpl,
        now,
        timeoutMs
      }));
    }
  }

  return {
    generatedAt,
    summary: summarizeResults(results),
    results
  };
}

async function resolveModels({
  apiBase = DEFAULT_API_BASE,
  apiKey,
  models,
  fetchImpl = fetch
}) {
  if (!(models.length === 1 && models[0] === 'all')) return models;
  if (!apiKey) throw new Error('LLM_API_KEY is required to list models');

  const resp = await fetchImpl(`${trimTrailingSlash(apiBase)}/models`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });
  if (!resp.ok) {
    const text = typeof resp.text === 'function' ? await resp.text() : '';
    throw new Error(`Model list failed: HTTP ${resp.status} ${text}`.trim());
  }

  const data = await resp.json();
  const ids = extractModelIds(data);
  if (ids.length === 0) {
    throw new Error('Model list did not contain any model ids');
  }
  return ids;
}

async function runOneModelSample({ apiBase, apiKey, model, sample, fetchImpl, now, timeoutMs }) {
  const sampleId = sample.id || sample.title || 'sample';
  const startedAt = now();
  let raw = '';
  let timeToFirstDeltaMs = null;
  let totalMs = null;
  const abortController = new AbortController();
  const timeout = timeoutMs > 0
    ? setTimeout(() => abortController.abort(), timeoutMs)
    : null;

  try {
    const requestBody = buildRequestBody({
      snapshot: sample.snapshot,
      signalPanel: sample.signalPanel,
      model
    });
    const resp = await fetchImpl(`${trimTrailingSlash(apiBase)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      signal: abortController.signal,
      body: JSON.stringify(requestBody)
    });

    if (!resp.ok) {
      const text = typeof resp.text === 'function' ? await resp.text() : '';
      totalMs = now() - startedAt;
      return buildFailedResult({
        model,
        sampleId,
        timeToFirstDeltaMs,
        totalMs,
        error: `HTTP ${resp.status}: ${text}`.trim()
      });
    }

    for await (const content of readOpenAiContentDeltas(resp.body)) {
      if (timeToFirstDeltaMs === null) {
        timeToFirstDeltaMs = now() - startedAt;
      }
      raw += content;
    }
    totalMs = now() - startedAt;

    const parsedJson = parseJson(raw);
    if (!parsedJson.ok) {
      return buildFailedResult({
        model,
        sampleId,
        timeToFirstDeltaMs,
        totalMs,
        raw,
        outputChars: raw.length,
        jsonValid: false,
        schemaComplete: false,
        error: parsedJson.error
      });
    }

    try {
      const readingJudgement = parseReadingJudgement(raw);
      const quality = scoreReadingJudgement(readingJudgement);
      return {
        model,
        sampleId,
        ok: true,
        timeToFirstDeltaMs,
        totalMs,
        outputChars: raw.length,
        jsonValid: true,
        schemaComplete: true,
        qualityScore: quality.score,
        checks: quality.checks,
        recommendation: readingJudgement.recommendation,
        masteryScoreOverall: readingJudgement.masteryScore.overall,
        error: null
      };
    } catch (err) {
      return buildFailedResult({
        model,
        sampleId,
        timeToFirstDeltaMs,
        totalMs,
        raw,
        outputChars: raw.length,
        jsonValid: true,
        schemaComplete: false,
        error: err.message
      });
    }
  } catch (err) {
    totalMs = totalMs === null ? now() - startedAt : totalMs;
    return buildFailedResult({
      model,
      sampleId,
      timeToFirstDeltaMs,
      totalMs,
      raw,
      outputChars: raw.length,
      error: err.message
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildFailedResult({
  model,
  sampleId,
  timeToFirstDeltaMs = null,
  totalMs = null,
  outputChars = 0,
  jsonValid = false,
  schemaComplete = false,
  error
}) {
  return {
    model,
    sampleId,
    ok: false,
    timeToFirstDeltaMs,
    totalMs,
    outputChars,
    jsonValid,
    schemaComplete,
    qualityScore: 0,
    checks: {},
    recommendation: null,
    masteryScoreOverall: null,
    error: sanitizeErrorMessage(error)
  };
}

function scoreReadingJudgement(judgement) {
  const questions = judgement.questionsForAuthor || [];
  const checks = {
    hasRecommendation: ['deep_read', 'quick_read', 'skip_read'].includes(judgement.recommendation),
    hasCompleteScores: hasCompleteScores(judgement.masteryScore),
    nextMustKnowActionable: hasActionableItems(judgement.nextMustKnow, { min: 1, max: 4 }),
    reasonsEvidenceBased: hasActionableItems(judgement.reasons, { min: 2, max: 3 }),
    keyPassagesPresent: hasActionableItems(judgement.keyPassages, { min: 1, max: 5 }),
    questionsAreQuestions: questions.length >= 3 && questions.length <= 5 && questions.every(looksLikeQuestion),
    questionsAvoidAnswers: questions.length > 0 && questions.every(avoidsAnswerLeak),
    readerPerspectivePresent: hasMeaningfulText(judgement.readerPerspective),
    readingAdviceActionable: hasActionableAdvice(judgement.readingAdvice)
  };

  const weights = {
    hasRecommendation: 8,
    hasCompleteScores: 12,
    nextMustKnowActionable: 18,
    reasonsEvidenceBased: 12,
    keyPassagesPresent: 8,
    questionsAreQuestions: 14,
    questionsAvoidAnswers: 12,
    readerPerspectivePresent: 6,
    readingAdviceActionable: 10
  };

  const score = Object.entries(weights).reduce((sum, [key, weight]) => (
    sum + (checks[key] ? weight : 0)
  ), 0);

  return { score, checks };
}

function renderMarkdownReport(report) {
  const lines = [
    '# WeRead AI Model Benchmark',
    '',
    `Generated at: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    '| Model | Samples | OK | TTFT Avg | Total Avg | Schema Complete | Quality Avg |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];

  for (const row of report.summary) {
    lines.push(markdownRow([
      escapeMarkdownCell(row.model),
      row.sampleCount,
      row.okCount,
      formatMs(row.avgTimeToFirstDeltaMs),
      formatMs(row.avgTotalMs),
      formatPercent(row.schemaCompleteRate),
      formatNumber(row.avgQualityScore)
    ]));
  }

  lines.push(
    '',
    '## Details',
    '',
    '| Model | Sample | OK | TTFT | Total | Chars | JSON | Schema | Quality | Recommendation | Score | Error |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |'
  );

  for (const result of report.results) {
    lines.push(markdownRow([
      escapeMarkdownCell(result.model),
      escapeMarkdownCell(result.sampleId),
      result.ok ? 'yes' : 'no',
      formatMs(result.timeToFirstDeltaMs),
      formatMs(result.totalMs),
      result.outputChars === null || result.outputChars === undefined ? '' : result.outputChars,
      result.jsonValid ? 'yes' : 'no',
      result.schemaComplete ? 'yes' : 'no',
      formatNumber(result.qualityScore),
      escapeMarkdownCell(result.recommendation || ''),
      result.masteryScoreOverall === null ? '' : String(result.masteryScoreOverall),
      escapeMarkdownCell(result.error || '')
    ]));
  }

  return `${lines.join('\n')}\n`;
}

function summarizeResults(results) {
  const byModel = new Map();
  for (const result of results) {
    if (!byModel.has(result.model)) byModel.set(result.model, []);
    byModel.get(result.model).push(result);
  }

  return Array.from(byModel.entries())
    .map(([model, items]) => {
      const okItems = items.filter((item) => item.ok);
      return {
        model,
        sampleCount: items.length,
        okCount: okItems.length,
        avgTimeToFirstDeltaMs: average(okItems.map((item) => item.timeToFirstDeltaMs)),
        avgTotalMs: average(okItems.map((item) => item.totalMs)),
        schemaCompleteRate: items.filter((item) => item.schemaComplete).length / items.length,
        avgQualityScore: average(okItems.map((item) => item.qualityScore))
      };
    })
    .sort((a, b) => {
      if (b.okCount !== a.okCount) return b.okCount - a.okCount;
      if (b.avgQualityScore !== a.avgQualityScore) return b.avgQualityScore - a.avgQualityScore;
      return nullsLast(a.avgTotalMs, b.avgTotalMs);
    });
}

function loadSamples(sampleFile) {
  const resolved = path.resolve(sampleFile);
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const samples = Array.isArray(data) ? data : data.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(`No samples found in ${resolved}`);
  }
  return samples;
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractModelIds(data) {
  if (Array.isArray(data)) {
    return data.map((item) => item && (item.id || item.name || item.model))
      .filter(Boolean);
  }
  if (Array.isArray(data?.data)) {
    return extractModelIds(data.data);
  }
  if (Array.isArray(data?.models)) {
    return extractModelIds(data.models);
  }
  return [];
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function readPositiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return number;
}

function parseJson(raw) {
  try {
    JSON.parse(raw);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err.message}` };
  }
}

function hasCompleteScores(score) {
  return ['overall', 'informationDensity', 'structuralImportance', 'skipRisk']
    .every((key) => Number.isFinite(Number(score && score[key])));
}

function hasActionableItems(items, { min, max }) {
  return Array.isArray(items)
    && items.length >= min
    && items.length <= max
    && items.every((item) => hasMeaningfulText(item));
}

function hasMeaningfulText(value) {
  return typeof value === 'string' && value.trim().length >= 6;
}

function looksLikeQuestion(value) {
  const text = String(value || '').trim();
  return /[?？]$/.test(text) || /^(作者)?(为什么|如何|怎样|怎么|哪些|什么|是否|何以)/.test(text);
}

function avoidsAnswerLeak(value) {
  return !/(因为|答案是|这说明|这意味着|所以|因此|结论是)/.test(String(value || ''));
}

function hasActionableAdvice(value) {
  const text = String(value || '').trim();
  return text.length >= 8 && /(精读|快读|跳读|先|再|重点|建议|回看)/.test(text);
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(Number(value)));
  if (numbers.length === 0) return null;
  return Math.round(numbers.reduce((sum, value) => sum + Number(value), 0) / numbers.length);
}

function nullsLast(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function formatMs(value) {
  return value === null || value === undefined ? '' : `${Math.round(value)}ms`;
}

function formatPercent(value) {
  return value === null || value === undefined ? '' : `${Math.round(value * 100)}%`;
}

function formatNumber(value) {
  return value === null || value === undefined ? '' : String(Math.round(value));
}

function escapeMarkdownCell(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
}

function sanitizeErrorMessage(value) {
  return String(value || '')
    .replace(/"user_id"\s*:\s*"[^"]+"/g, '"user_id":"[hidden]"')
    .replace(/user_[A-Za-z0-9]{6,}/g, 'user_[hidden]');
}

function markdownRow(cells) {
  return `| ${cells.map((cell) => String(cell)).join(' | ')} |`;
}

function trimTrailingSlash(value) {
  return String(value || DEFAULT_API_BASE).replace(/\/+$/, '');
}

function usage() {
  return [
    'Usage: node scripts/benchmark-models.js --models model-a,model-b [options]',
    '',
    'Options:',
    '  --models <list>       Comma-separated model ids, or "all" to call /models.',
    '                        Defaults to BENCHMARK_MODELS or LLM_MODEL.',
    '  --sample-file <path>  JSON file with benchmark samples.',
    '  --format <format>     markdown or json. Default: markdown.',
    '  --output <path>       Write report to a file instead of stdout.',
    '  --api-base <url>      OpenAI-compatible base URL. Defaults to LLM_API_BASE.',
    '  --api-key <key>       API key. Defaults to LLM_API_KEY.',
    '  --timeout-ms <n>      Per model/sample timeout. Default: 45000.',
    '  -h, --help            Show this help.'
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const models = args.models.length
    ? args.models
    : splitCsv(process.env.BENCHMARK_MODELS || process.env.LLM_MODEL);
  const samples = loadSamples(args.sampleFile);
  const apiBase = args.apiBase || process.env.LLM_API_BASE || DEFAULT_API_BASE;
  const apiKey = args.apiKey || process.env.LLM_API_KEY;
  const resolvedModels = await resolveModels({
    apiBase,
    apiKey,
    models
  });
  const report = await runBenchmark({
    apiBase,
    apiKey,
    models: resolvedModels,
    samples,
    timeoutMs: args.timeoutMs
  });
  const rendered = args.format === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderMarkdownReport(report);

  if (args.output) {
    fs.writeFileSync(args.output, rendered);
  } else {
    process.stdout.write(rendered);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_SAMPLE_FILE,
  loadSamples,
  main,
  parseArgs,
  renderMarkdownReport,
  resolveModels,
  runBenchmark,
  sanitizeErrorMessage,
  scoreReadingJudgement,
  summarizeResults
};
