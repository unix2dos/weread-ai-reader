const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

const {
  parseArgs,
  renderMarkdownReport,
  resolveModels,
  runBenchmark,
  scoreReadingJudgement
} = require('../scripts/benchmark-models');

function createSample(overrides = {}) {
  return {
    id: 'sample-1',
    title: '方向章节样本',
    snapshot: {
      bookId: 'book-1',
      bookTitle: '测试书',
      chapterUid: 101,
      chapterTitle: '第五章 方向',
      chapterText: '本章讨论大学生在关键选择前如何判断方向。作者先区分短期机会和长期能力，再说明信息差、家庭资源和学校平台会改变选择边界。',
      captureMode: 'passive-accumulated',
      captureStats: { segmentCount: 2 }
    },
    signalPanel: {
      chapter: { chapterUid: 101, title: '第五章 方向', wordCount: 2200, chapterIdx: 5 },
      bookContext: {
        bookInfo: { title: '测试书', author: '作者', newRating: 86 },
        readingProgress: { progress: 32 }
      },
      publicSignals: {
        bestBookmarks: [{ range: '1-20', markText: '方向不是口号，而是资源、能力和风险的组合。', totalCount: 18 }],
        bookmarkReviews: [{ range: '1-20', totalCount: 2, comments: ['这里解释了为什么同样努力会有不同结果。'] }],
        bookReviews: [{ content: '这本书适合用来理解结构性差异。', likeCount: 5 }]
      },
      personalSignals: { enabled: false, bookmarks: [], reviews: [], underlines: [] },
      debug: { resolvedBookId: 'book-1', warnings: [] }
    },
    ...overrides
  };
}

function createJudgement(overrides = {}) {
  return {
    recommendation: 'deep_read',
    masteryScore: {
      overall: 88,
      takeawayValue: 84,
      understandingLeverage: 90,
      attentionROI: 78
    },
    nextMustKnow: ['方向选择背后的资源约束', '短期机会和长期能力的区别', '结构差异如何影响个人选择'],
    reasons: ['热门划线集中在方向定义。', '评论认为这一段解释了分化原因。'],
    evidenceSnippets: ['方向不是口号，而是资源、能力和风险的组合。'],
    questionsForAuthor: ['作者如何区分真正的方向和短期机会？', '资源约束会怎样改变个人选择？'],
    readerPerspective: '读者普遍认为本章解释了选择差异的结构性原因。',
    readingAdvice: '先精读方向定义，再快读案例部分，最后回看资源约束的判断框架。',
    ...overrides
  };
}

function createOpenAiSseBody(contentDeltas) {
  const chunks = contentDeltas.map((content) => (
    Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
  ));
  chunks.push(Buffer.from('data: [DONE]\n\n'));
  return Readable.from(chunks);
}

test('parseArgs accepts model lists, sample paths, and output format', () => {
  const args = parseArgs([
    '--models', 'kimi-k2.6,deepseek-v4-flash',
    '--sample-file', 'samples.json',
    '--output', 'report.md',
    '--format', 'markdown',
    '--timeout-ms', '30000'
  ]);

  assert.deepEqual(args.models, ['kimi-k2.6', 'deepseek-v4-flash']);
  assert.equal(args.sampleFile, 'samples.json');
  assert.equal(args.output, 'report.md');
  assert.equal(args.format, 'markdown');
  assert.equal(args.timeoutMs, 30000);
});

test('resolveModels discovers model ids when models is all', async () => {
  const requestedUrls = [];
  const models = await resolveModels({
    apiBase: 'https://example.test/v1',
    apiKey: 'test-key',
    models: ['all'],
    fetchImpl: async (url, options) => {
      requestedUrls.push({ url, auth: options.headers.Authorization });
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 'kimi-k2.6' },
            { id: 'deepseek-v4-flash' }
          ]
        })
      };
    }
  });

  assert.deepEqual(models, ['kimi-k2.6', 'deepseek-v4-flash']);
  assert.equal(requestedUrls[0].url, 'https://example.test/v1/models');
  assert.equal(requestedUrls[0].auth, 'Bearer test-key');
});

test('runBenchmark measures model latency and parses complete reading judgements', async () => {
  const calls = [];
  const clock = [1000, 1020, 1050];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), signal: options.signal });
    return {
      ok: true,
      body: createOpenAiSseBody([
        JSON.stringify(createJudgement()).slice(0, 120),
        JSON.stringify(createJudgement()).slice(120)
      ])
    };
  };

  const report = await runBenchmark({
    apiBase: 'https://example.test/v1',
    apiKey: 'test-key',
    models: ['kimi-k2.6'],
    samples: [createSample()],
    fetchImpl,
    now: () => clock.shift()
  });

  assert.equal(calls[0].url, 'https://example.test/v1/chat/completions');
  assert.ok(calls[0].signal);
  assert.equal(calls[0].body.model, 'kimi-k2.6');
  assert.equal(calls[0].body.response_format.type, 'json_object');
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].ok, true);
  assert.equal(report.results[0].timeToFirstDeltaMs, 20);
  assert.equal(report.results[0].totalMs, 50);
  assert.equal(report.results[0].jsonValid, true);
  assert.equal(report.results[0].schemaComplete, true);
  assert.equal(report.results[0].recommendation, 'deep_read');
  assert.equal(report.results[0].masteryScoreOverall, 85);
  assert.equal(report.summary[0].model, 'kimi-k2.6');
  assert.equal(report.summary[0].okCount, 1);
  assert.equal(report.summary[0].sampleCount, 1);
});

test('runBenchmark records invalid schema without aborting the whole report', async () => {
  const fetchImpl = async () => ({
    ok: true,
    body: createOpenAiSseBody([
      JSON.stringify({
        recommendation: 'quick_read',
        masteryScore: { overall: 60 }
      })
    ])
  });

  const report = await runBenchmark({
    apiBase: 'https://example.test/v1',
    apiKey: 'test-key',
    models: ['bad-model'],
    samples: [createSample()],
    fetchImpl,
    now: (() => {
      let value = 0;
      return () => value += 10;
    })()
  });

  assert.equal(report.results[0].ok, false);
  assert.equal(report.results[0].jsonValid, true);
  assert.equal(report.results[0].schemaComplete, false);
  assert.match(report.results[0].error, /Missing|Invalid/);
});

test('runBenchmark redacts provider user ids from failed rows', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    text: async () => '{"error":{"message":"No endpoint"},"user_id":"user_secret123"}'
  });

  const report = await runBenchmark({
    apiBase: 'https://example.test/v1',
    apiKey: 'test-key',
    models: ['bad-model'],
    samples: [createSample()],
    fetchImpl,
    now: (() => {
      let value = 0;
      return () => value += 10;
    })()
  });

  assert.doesNotMatch(report.results[0].error, /user_secret123/);
  assert.match(report.results[0].error, /"user_id":"\[hidden\]"/);
});

test('scoreReadingJudgement rewards actionable mastery output and flags answered questions', () => {
  const strong = scoreReadingJudgement(createJudgement());
  const leaky = scoreReadingJudgement(createJudgement({
    questionsForAuthor: ['作者为什么这样区分？因为资源约束决定选择边界。']
  }));

  assert.equal(strong.checks.nextMustKnowActionable, true);
  assert.equal(strong.checks.questionsAreQuestions, true);
  assert.equal(strong.checks.questionsAvoidAnswers, true);
  assert.ok(strong.score > leaky.score);
  assert.equal(leaky.checks.questionsAvoidAnswers, false);
});

test('renderMarkdownReport includes sortable model summary and detailed failures', () => {
  const markdown = renderMarkdownReport({
    generatedAt: '2026-05-31T00:00:00.000Z',
    summary: [{
      model: 'kimi-k2.6',
      sampleCount: 1,
      okCount: 1,
      avgTimeToFirstDeltaMs: 20,
      avgTotalMs: 50,
      schemaCompleteRate: 1,
      avgQualityScore: 92
    }],
    results: [{
      model: 'kimi-k2.6',
      sampleId: 'sample-1',
      ok: true,
      timeToFirstDeltaMs: 20,
      totalMs: 50,
      outputChars: 333,
      jsonValid: true,
      schemaComplete: true,
      qualityScore: 92,
      recommendation: 'deep_read',
      masteryScoreOverall: 88
    }]
  });

  assert.match(markdown, /# WeRead AI Model Benchmark/);
  assert.match(markdown, /\| Model \| Samples \| OK \| TTFT Avg/);
  assert.match(markdown, /\| Model \| Sample \| OK \| TTFT \| Total \| Chars \| JSON \| Schema \| Quality \| Recommendation \| Score \| Error \|/);
  assert.match(markdown, /kimi-k2\.6/);
  assert.match(markdown, /\| kimi-k2\.6 \| sample-1 \| yes \| 20ms \| 50ms \| 333 \| yes \| yes \| 92 \| deep_read \| 88 \|  \|/);
  assert.match(markdown, /\| kimi-k2\.6 \| 1 \| 1 \| 20ms \| 50ms \| 100% \| 92 \|/);
  assert.doesNotMatch(markdown, /\| \|$/m);
  assert.match(markdown, /sample-1/);
});
