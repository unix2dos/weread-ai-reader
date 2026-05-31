# Reading Strategy Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor AI request construction and reading judgement rendering so WeRead signals, reading strategy, LLM transport, and extension display have stable boundaries.

**Architecture:** Add a server-side strategy module that owns prompt/schema/parsing, a signal builder that owns layered WeRead Skill aggregation, and a thinner LLM client that only sends OpenAI-compatible requests. Keep the existing snapshot upload plus SSE flow, while returning a new `readingJudgement` shape with a compatibility `judgement` shape during migration.

**Tech Stack:** Node.js 18+, Express 5, CommonJS modules, Chrome extension content/background scripts, Node built-in test runner.

---

## File Structure

- Create `server/readingStrategy.js`: prompt version, capture interpretation, strategy input, OpenAI request body construction, parsing, and legacy mapping.
- Create `server/signalBuilder.js`: WeRead Skill calls and normalization into `bookContext`, `publicSignals`, `personalSignals`, and compatibility top-level arrays.
- Modify `server/llmClient.js`: delegate request body and result parsing to `readingStrategy`; keep streaming transport.
- Modify `server/createApp.js`: delegate signal building to `signalBuilder`, pass config, cache the new result shape, and keep compatible SSE output.
- Modify `server/index.js`: add `enablePersonalSignals` config from `ENABLE_PERSONAL_SIGNALS`.
- Modify `extension/content.js`: render `readingJudgement` fields, consume compatible complete payloads, and remove divergent prompt fallback.
- Modify `extension/styles/content.css`: add compact score and next-must-know styles.
- Modify `test/agent-server.test.js`: update server integration expectations for signal tiers and SSE payloads.
- Add `test/reading-strategy.test.js`: focused strategy parser/input tests.
- Modify `test/extension-ui-contract.test.js`: contract checks for new UI fields and debug behavior.
- Modify `CONTEXT.md` and `README.md`: document new schema and config flag after code lands.

---

### Task 1: Add Reading Strategy Module

**Files:**
- Create: `server/readingStrategy.js`
- Create: `test/reading-strategy.test.js`

- [ ] **Step 1: Write failing strategy tests**

Create `test/reading-strategy.test.js` with:

```javascript
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PROMPT_VERSION,
  buildRequestBody,
  buildStrategyInput,
  parseReadingJudgement,
  toLegacyJudgement
} = require('../server/readingStrategy');

function createSnapshot(overrides = {}) {
  return {
    bookId: 'book-1',
    bookTitle: '测试书',
    chapterUid: 101,
    chapterTitle: '第一章',
    chapterText: '这一章提出核心概念，并说明后文会反复使用。',
    captureMode: 'passive-accumulated',
    captureStats: { segmentCount: 2 },
    ...overrides
  };
}

function createSignalPanel(overrides = {}) {
  return {
    chapter: { chapterUid: 101, title: '第一章', wordCount: 3200, chapterIdx: 1 },
    bookContext: {
      bookInfo: { title: '测试书', author: '作者', newRating: 86, newRatingCount: 1200 },
      readingProgress: { progress: 25, chapterUid: 101 }
    },
    publicSignals: {
      bestBookmarks: [{ range: '1-20', markText: '核心概念', totalCount: 12, chapterUid: 101 }],
      bookmarkReviews: [{ range: '1-20', totalCount: 1, comments: ['这段是后面理解的基础。'] }],
      bookReviews: [{ content: '结构清楚。', likeCount: 4 }]
    },
    personalSignals: { enabled: false, bookmarks: [], reviews: [], underlines: [] },
    bestBookmarks: [{ range: '1-20', markText: '核心概念', totalCount: 12, chapterUid: 101 }],
    bookmarkReviews: [{ range: '1-20', totalCount: 1, comments: ['这段是后面理解的基础。'] }],
    bookReviews: [{ content: '结构清楚。', likeCount: 4 }],
    debug: { resolvedBookId: 'book-1', warnings: [] },
    ...overrides
  };
}

test('buildStrategyInput includes mastery score and author-question output requirements', () => {
  const input = buildStrategyInput({
    snapshot: createSnapshot(),
    signalPanel: createSignalPanel()
  });

  assert.equal(input.promptVersion, PROMPT_VERSION);
  assert.equal(input.task, '判断当前章节接下来最需要掌握什么，并给出精读、快读或跳读建议。');
  assert.equal(input.chapter.capture.status, 'partial');
  assert.equal(input.outputShape.recommendation, 'deep_read | quick_read | skip_read');
  assert.equal(input.outputShape.masteryScore.overall, '0-100 掌握价值分');
  assert.equal(input.outputShape.questionsForAuthor[0], '带着阅读的问题，不要给答案');
});

test('buildRequestBody asks for JSON-only mastery judgement', () => {
  const body = buildRequestBody({
    snapshot: createSnapshot(),
    signalPanel: createSignalPanel(),
    model: 'deepseek-v4-flash'
  });

  assert.equal(body.model, 'deepseek-v4-flash');
  assert.equal(body.stream, true);
  assert.match(body.messages[0].content, /掌握价值分/);
  assert.match(body.messages[0].content, /追问问题只给问题/);
  assert.match(body.messages[1].content, /questionsForAuthor/);
  assert.match(body.messages[1].content, /bookContext/);
});

test('parseReadingJudgement normalizes score ranges and arrays', () => {
  const judgement = parseReadingJudgement(JSON.stringify({
    recommendation: 'deep_read',
    masteryScore: {
      overall: 120,
      informationDensity: 91,
      structuralImportance: 80,
      skipRisk: -5
    },
    nextMustKnow: ['核心概念', '后文章节会复用的区分'],
    reasons: ['热门划线集中在定义段。'],
    keyPassages: ['核心概念'],
    questionsForAuthor: ['作者为什么先定义这个概念？'],
    readerPerspective: '读者认为这里是基础。',
    readingAdvice: '先精读定义段，再快读例子。'
  }));

  assert.equal(judgement.recommendation, 'deep_read');
  assert.deepEqual(judgement.masteryScore, {
    overall: 100,
    informationDensity: 91,
    structuralImportance: 80,
    skipRisk: 0
  });
  assert.deepEqual(judgement.questionsForAuthor, ['作者为什么先定义这个概念？']);
  assert.equal(judgement.readingAdvice, '先精读定义段，再快读例子。');
});

test('toLegacyJudgement maps new recommendation to existing conclusion labels', () => {
  const legacy = toLegacyJudgement({
    recommendation: 'deep_read',
    reasons: ['理由'],
    keyPassages: ['段落'],
    readerPerspective: '读者视角',
    readingAdvice: '阅读建议'
  });

  assert.deepEqual(legacy, {
    conclusion: 'worth_deep_read',
    reasons: ['理由'],
    keyPassages: ['段落'],
    readerPerspective: '读者视角',
    readingAction: '阅读建议'
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/reading-strategy.test.js
```

Expected: FAIL with `Cannot find module '../server/readingStrategy'`.

- [ ] **Step 3: Implement `server/readingStrategy.js`**

Create `server/readingStrategy.js` with:

```javascript
const PROMPT_VERSION = 'reading-strategy-v2';

function buildRequestBody({ snapshot, signalPanel, promptVersion = PROMPT_VERSION, model }) {
  return {
    model,
    stream: true,
    temperature: 0.2,
    messages: buildMessages({ snapshot, signalPanel, promptVersion })
  };
}

function buildMessages({ snapshot, signalPanel, promptVersion = PROMPT_VERSION }) {
  return [
    {
      role: 'system',
      content: [
        '你是微信读书实时跟读助手，只判断当前章节的阅读策略。',
        '目标是帮助用户快速知道接下来最需要掌握什么，而不是写长篇总结。',
        '你会看到章节正文采集覆盖率、公共阅读信号、书籍上下文信号，以及可能存在的个人阅读信号。',
        '公共阅读信号优先，书籍上下文信号用于校准章节位置，个人阅读信号只在存在时用于个性化建议。',
        '如果 chapter.capture.status 不是 full，应明确这是阶段性建议，不得声称已经读完整章正文。',
        '掌握价值分表示本章对理解全书或继续阅读最值得投入注意力的程度，不是文学质量分。',
        '追问问题只给问题，不要回答问题，不要模拟作者对话。',
        '必须输出 JSON，不要输出 Markdown。',
        'JSON 字段：recommendation, masteryScore, nextMustKnow, reasons, keyPassages, questionsForAuthor, readerPerspective, readingAdvice。',
        'recommendation 只能是 deep_read、quick_read 或 skip_read。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify(buildStrategyInput({ snapshot, signalPanel, promptVersion }))
    }
  ];
}

function buildStrategyInput({ snapshot, signalPanel, promptVersion = PROMPT_VERSION }) {
  const capture = buildCaptureInput(snapshot, signalPanel);
  const resolvedBookId = signalPanel.debug?.resolvedBookId || snapshot.bookId;

  return {
    promptVersion,
    task: '判断当前章节接下来最需要掌握什么，并给出精读、快读或跳读建议。',
    chapter: {
      bookId: resolvedBookId,
      rawBookId: snapshot.bookId,
      bookTitle: snapshot.bookTitle,
      chapterUid: signalPanel.chapter?.chapterUid || snapshot.chapterUid,
      chapterTitle: snapshot.chapterTitle,
      chapterIndex: signalPanel.chapter?.chapterIdx || null,
      expectedWordCount: capture.expectedWordCount,
      capture,
      chapterText: snapshot.chapterText
    },
    signals: {
      bookContext: signalPanel.bookContext || {},
      publicSignals: signalPanel.publicSignals || {
        bookReviews: signalPanel.bookReviews || [],
        bestBookmarks: signalPanel.bestBookmarks || [],
        bookmarkReviews: signalPanel.bookmarkReviews || []
      },
      personalSignals: signalPanel.personalSignals || { enabled: false, bookmarks: [], reviews: [], underlines: [] }
    },
    outputShape: {
      recommendation: 'deep_read | quick_read | skip_read',
      masteryScore: {
        overall: '0-100 掌握价值分',
        informationDensity: '0-100 信息密度分',
        structuralImportance: '0-100 结构关键性分',
        skipRisk: '0-100 可跳读风险分'
      },
      nextMustKnow: ['接下来最需要掌握的东西，1-4 条'],
      reasons: ['2-3 条证据'],
      keyPassages: ['3-5 条热门划线或正文片段'],
      questionsForAuthor: ['带着阅读的问题，不要给答案'],
      readerPerspective: '评论中的共识、争议、误读或补充',
      readingAdvice: '具体精读、快读或跳读建议'
    }
  };
}

function buildCaptureInput(snapshot, signalPanel) {
  const expectedWordCount = positiveNumberOrNull(signalPanel.chapter?.wordCount);
  const capturedTextLength = snapshot.chapterText.length;
  const coverageRatio = expectedWordCount ? capturedTextLength / expectedWordCount : null;
  const coveragePercent = coverageRatio === null ? null : Math.min(100, Math.round(coverageRatio * 100));
  const status = classifyCoverage(snapshot.captureMode, coverageRatio);

  return {
    mode: snapshot.captureMode || 'active-visible',
    stats: snapshot.captureStats || {},
    capturedTextLength,
    expectedWordCount,
    coverageRatio: coverageRatio === null ? null : Number(coverageRatio.toFixed(3)),
    coveragePercent,
    status,
    coverage: {
      status,
      ratio: coverageRatio === null ? null : Number(coverageRatio.toFixed(3)),
      percent: coveragePercent,
      capturedTextLength,
      expectedWordCount
    },
    note: 'passive-accumulated means the text was accumulated only from pages the user naturally rendered; it may still be partial.',
    instruction: status === 'full'
      ? 'You may treat the captured chapter text as approximately complete.'
      : 'Treat the chapter text as partial. Make a stage-aware judgement and do not imply the full chapter body was read.'
  };
}

function classifyCoverage(mode, ratio) {
  if (mode === 'server-skill') return 'full';
  if (ratio !== null && ratio >= 0.9) return 'full';
  if (ratio !== null && ratio >= 0.6) return 'substantial';
  return 'partial';
}

function parseReadingJudgement(raw) {
  const parsed = parseJsonObject(raw);
  return normalizeReadingJudgement(parsed);
}

function normalizeReadingJudgement(value) {
  const recommendation = normalizeRecommendation(value.recommendation || value.conclusion);
  return {
    recommendation,
    masteryScore: normalizeMasteryScore(value.masteryScore || {}),
    nextMustKnow: normalizeStringArray(value.nextMustKnow, 4),
    reasons: normalizeStringArray(value.reasons, 3),
    keyPassages: normalizeStringArray(value.keyPassages, 5),
    questionsForAuthor: normalizeStringArray(value.questionsForAuthor, 5),
    readerPerspective: String(value.readerPerspective || ''),
    readingAdvice: String(value.readingAdvice || value.readingAction || '')
  };
}

function toLegacyJudgement(readingJudgement) {
  return {
    conclusion: toLegacyConclusion(readingJudgement.recommendation),
    reasons: normalizeStringArray(readingJudgement.reasons, 3),
    keyPassages: normalizeStringArray(readingJudgement.keyPassages, 5),
    readerPerspective: String(readingJudgement.readerPerspective || ''),
    readingAction: String(readingJudgement.readingAdvice || '')
  };
}

function parseJsonObject(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = String(raw || '').match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function normalizeRecommendation(value) {
  if (value === 'worth_deep_read') return 'deep_read';
  if (['deep_read', 'quick_read', 'skip_read'].includes(value)) return value;
  return 'quick_read';
}

function toLegacyConclusion(value) {
  if (value === 'deep_read') return 'worth_deep_read';
  if (value === 'skip_read') return 'skip_read';
  return 'quick_read';
}

function normalizeMasteryScore(value) {
  return {
    overall: clampScore(value.overall),
    informationDensity: clampScore(value.informationDensity),
    structuralImportance: clampScore(value.structuralImportance),
    skipRisk: clampScore(value.skipRisk)
  };
}

function clampScore(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function normalizeStringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

module.exports = {
  PROMPT_VERSION,
  buildCaptureInput,
  buildMessages,
  buildRequestBody,
  buildStrategyInput,
  parseReadingJudgement,
  toLegacyJudgement
};
```

- [ ] **Step 4: Run strategy tests**

Run:

```bash
npm test -- test/reading-strategy.test.js
```

Expected: PASS for all `reading-strategy` tests.

- [ ] **Step 5: Commit strategy module**

Run:

```bash
git add server/readingStrategy.js test/reading-strategy.test.js
git commit -m "Separate reading strategy from provider transport" -m "Constraint: Keep OpenAI-compatible message construction while moving product schema ownership out of llmClient." -m "Rejected: Keep prompt construction inside llmClient | It would preserve the coupling this refactor is meant to remove." -m "Confidence: high" -m "Scope-risk: narrow" -m "Directive: Treat questionsForAuthor as unanswered reading prompts, never simulated author dialogue." -m "Tested: npm test -- test/reading-strategy.test.js" -m "Not-tested: Extension rendering and SSE integration remain in later tasks."
```

---

### Task 2: Refactor LLM Client Around Strategy

**Files:**
- Modify: `server/llmClient.js`
- Modify: `test/agent-server.test.js`

- [ ] **Step 1: Write failing integration expectation for new request schema**

In `test/agent-server.test.js`, inside `returns snapshot id and structured signal panel for a valid reading snapshot`, add these assertions after the existing model assertion:

```javascript
    const requestContent = JSON.parse(body.agentRequest.body.messages[1].content);
    assert.equal(requestContent.promptVersion, 'reading-strategy-v2');
    assert.equal(requestContent.outputShape.recommendation, 'deep_read | quick_read | skip_read');
    assert.equal(requestContent.outputShape.masteryScore.overall, '0-100 掌握价值分');
    assert.equal(requestContent.outputShape.questionsForAuthor[0], '带着阅读的问题，不要给答案');
```

In the same file, add this test after `streams short judgement events for a stored snapshot`:

```javascript
test('streams reading judgement and compatible legacy judgement', async () => {
  const app = createApp({
    config: { clientToken: 'dev-token' },
    wereadClient: createStubWeReadClient([]),
    llmClient: {
      async *streamShortJudgement() {
        yield { type: 'delta', field: 'readingAdvice', text: '先精读核心概念。' };
        yield {
          type: 'complete',
          readingJudgement: {
            recommendation: 'deep_read',
            masteryScore: {
              overall: 88,
              informationDensity: 82,
              structuralImportance: 90,
              skipRisk: 75
            },
            nextMustKnow: ['核心概念如何支撑后文'],
            reasons: ['热门划线集中在核心定义。'],
            keyPassages: ['核心概念'],
            questionsForAuthor: ['作者为什么先定义这个概念？'],
            readerPerspective: '读者认为这里是基础。',
            readingAdvice: '先精读定义段。'
          },
          judgement: {
            conclusion: 'worth_deep_read',
            reasons: ['热门划线集中在核心定义。'],
            keyPassages: ['核心概念'],
            readerPerspective: '读者认为这里是基础。',
            readingAction: '先精读定义段。'
          }
        };
      }
    },
    logger: { info() {}, warn() {}, error() {} }
  });

  await withServer(app, async (baseUrl) => {
    const snapshotResp = await fetch(`${baseUrl}/api/reading-snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createSnapshot())
    });
    const { snapshotId } = await snapshotResp.json();

    const streamResp = await fetch(`${baseUrl}/api/reading-snapshots/${snapshotId}/judgement/stream?clientToken=dev-token`);
    assert.equal(streamResp.status, 200);

    const text = await streamResp.text();
    assert.match(text, /"readingJudgement":\{"recommendation":"deep_read"/);
    assert.match(text, /"questionsForAuthor":\["作者为什么先定义这个概念？"\]/);
    assert.match(text, /"judgement":\{"conclusion":"worth_deep_read"/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- test/agent-server.test.js
```

Expected: FAIL because `llmClient` still emits `short-judgement-v1` request content and `createApp` does not yet normalize `readingJudgement`.

- [ ] **Step 3: Replace prompt and parser logic in `server/llmClient.js`**

Replace `server/llmClient.js` with:

```javascript
const {
  buildRequestBody,
  parseReadingJudgement,
  toLegacyJudgement
} = require('./readingStrategy');

const DEFAULT_LLM_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_LLM_MODEL = 'gpt-4.1-nano';

function createLlmClient({
  apiKey,
  apiBase = DEFAULT_LLM_API_BASE,
  model = DEFAULT_LLM_MODEL,
  fetchImpl = fetch
}) {
  return {
    async *streamShortJudgement({ snapshot, signalPanel, promptVersion }) {
      if (!apiKey) {
        throw new Error('LLM_API_KEY is not configured');
      }

      const requestBody = buildRequestBody({ snapshot, signalPanel, promptVersion, model });
      const resp = await fetchImpl(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`LLM API failed: ${resp.status} ${text}`);
      }

      let raw = '';
      for await (const content of readOpenAiContentDeltas(resp.body)) {
        raw += content;
        yield { type: 'delta', field: 'readingAdvice', text: content };
      }

      const readingJudgement = parseReadingJudgement(raw);
      yield {
        type: 'complete',
        readingJudgement,
        judgement: toLegacyJudgement(readingJudgement)
      };
    },

    buildRequestDebug({ snapshot, signalPanel, promptVersion }) {
      return {
        method: 'POST',
        url: `${apiBase}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer [hidden]'
        },
        body: buildRequestBody({ snapshot, signalPanel, promptVersion, model }),
        note: 'Authorization 使用服务器上的 LLM_API_KEY；调试输出故意隐藏。'
      };
    }
  };
}

async function* readOpenAiContentDeltas(body) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      const data = JSON.parse(payload);
      const content = data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content;
      if (content) yield content;
    }
  }
}

module.exports = {
  createLlmClient,
  readOpenAiContentDeltas
};
```

- [ ] **Step 4: Run focused server tests**

Run:

```bash
npm test -- test/reading-strategy.test.js test/agent-server.test.js
```

Expected: the new request schema assertions pass; the new SSE compatibility test may still fail until Task 4 if `createApp` only writes `event.judgement`.

- [ ] **Step 5: Commit LLM client refactor when focused tests pass or after Task 4 integration**

If Task 4 is needed before tests pass, defer this commit until Task 4. Otherwise run:

```bash
git add server/llmClient.js test/agent-server.test.js
git commit -m "Route LLM requests through the reading strategy" -m "Constraint: Preserve the existing streamShortJudgement API while changing the payload it emits." -m "Rejected: Rename the SSE endpoint now | Endpoint stability keeps the extension migration smaller." -m "Confidence: high" -m "Scope-risk: moderate" -m "Directive: Keep llmClient transport-focused; schema decisions belong in readingStrategy." -m "Tested: npm test -- test/reading-strategy.test.js test/agent-server.test.js" -m "Not-tested: Browser extension rendering remains in later tasks."
```

---

### Task 3: Extract Layered WeRead Signal Builder

**Files:**
- Create: `server/signalBuilder.js`
- Modify: `server/createApp.js`
- Modify: `server/index.js`
- Modify: `test/agent-server.test.js`

- [ ] **Step 1: Extend stub WeRead client responses**

In `test/agent-server.test.js`, update `createStubWeReadClient` so it supports the new default calls:

```javascript
      if (apiName === '/book/info') {
        return {
          bookId: 'book-1',
          title: '测试书',
          author: '测试作者',
          intro: '一本用于测试的书。',
          category: '学习',
          newRating: 86,
          newRatingCount: 1200
        };
      }
      if (apiName === '/book/getprogress') {
        return {
          bookId: 'book-1',
          book: {
            chapterUid: 101,
            chapterOffset: 0,
            progress: 25,
            recordReadingTime: 3600
          },
          timestamp: 1780200000
        };
      }
```

- [ ] **Step 2: Add failing signal tier assertions**

In `returns snapshot id and structured signal panel for a valid reading snapshot`, add:

```javascript
    assert.equal(body.signalPanel.bookContext.bookInfo.author, '测试作者');
    assert.equal(body.signalPanel.bookContext.bookInfo.newRating, 86);
    assert.equal(body.signalPanel.bookContext.readingProgress.progress, 25);
    assert.equal(body.signalPanel.publicSignals.bestBookmarks[0].markText, '值得精读的关键段落');
    assert.equal(body.signalPanel.personalSignals.enabled, false);
    assert.deepEqual(body.signalPanel.debug.skillCalls, [
      '/book/chapterinfo',
      '/book/info',
      '/book/getprogress',
      '/book/bestbookmarks',
      '/book/readreviews',
      '/review/list'
    ]);
```

Replace any older `debug.skillCalls` assertion in that test with the block above.

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- test/agent-server.test.js
```

Expected: FAIL because `buildSignalPanel` still lives in `createApp.js` and does not call `/book/info` or `/book/getprogress`.

- [ ] **Step 4: Create `server/signalBuilder.js`**

Create `server/signalBuilder.js` with:

```javascript
async function buildSignalPanel(wereadClient, snapshot, options = {}) {
  const logger = options.logger || console;
  const skillCalls = [];
  const warnings = [];
  let skillBookId = snapshot.bookId;

  let chaptersResp = await callOptionalSkill(wereadClient, skillCalls, warnings, '/book/chapterinfo', {
    bookId: skillBookId
  }, '章节目录获取失败');

  if ((!chaptersResp.chapters || chaptersResp.chapters.length === 0) && snapshot.bookTitle) {
    const resolvedBookId = await resolveBookIdByTitle(wereadClient, skillCalls, snapshot.bookTitle).catch((err) => {
      warnings.push(`通过书名解析 bookId 失败: ${err.message}`);
      return null;
    });
    if (resolvedBookId && resolvedBookId !== skillBookId) {
      warnings.push(`已通过书名将 reader id 解析为官方 bookId: ${skillBookId} -> ${resolvedBookId}`);
      skillBookId = resolvedBookId;
      chaptersResp = await callOptionalSkill(wereadClient, skillCalls, warnings, '/book/chapterinfo', {
        bookId: skillBookId
      }, '官方 bookId 章节目录获取失败');
    }
  }

  const chapter = resolveChapter(snapshot, chaptersResp.chapters || [], warnings);
  const chapterUid = chapter.chapterUid;
  const bookInfoResp = await callOptionalSkill(wereadClient, skillCalls, warnings, '/book/info', {
    bookId: skillBookId
  }, '书籍信息获取失败');
  const progressResp = await callOptionalSkill(wereadClient, skillCalls, warnings, '/book/getprogress', {
    bookId: skillBookId
  }, '阅读进度获取失败');
  const bestBookmarksResp = await callOptionalSkill(wereadClient, skillCalls, warnings, '/book/bestbookmarks', {
    bookId: skillBookId,
    chapterUid: chapterUid || 0
  }, '热门划线获取失败');

  const bestBookmarks = normalizeBestBookmarks(bestBookmarksResp.items || [], chapterUid);
  const bookmarkReviewsResp = bestBookmarks.length > 0 && chapterUid
    ? await callOptionalSkill(wereadClient, skillCalls, warnings, '/book/readreviews', {
      bookId: skillBookId,
      chapterUid,
      reviews: bestBookmarks.slice(0, 8).map((bookmark) => ({
        range: bookmark.range,
        maxIdx: 0,
        count: 5
      }))
    }, '划线评论获取失败')
    : { reviews: [] };

  const bookReviewsResp = await callOptionalSkill(wereadClient, skillCalls, warnings, '/review/list', {
    bookId: skillBookId,
    reviewListType: 0,
    count: 8
  }, '整本书评价获取失败');

  const personalSignals = await buildPersonalSignals({
    wereadClient,
    skillCalls,
    warnings,
    enabled: Boolean(options.enablePersonalSignals),
    bookId: skillBookId,
    chapterUid,
    popularHighlightCount: bestBookmarks.length
  });

  const publicSignals = {
    bookReviews: normalizeBookReviews(bookReviewsResp.reviews || []),
    bestBookmarks,
    bookmarkReviews: normalizeBookmarkReviews(bookmarkReviewsResp.reviews || [])
  };
  const bookContext = {
    bookInfo: normalizeBookInfo(bookInfoResp),
    readingProgress: normalizeReadingProgress(progressResp)
  };

  const signalPanel = {
    chapter: {
      chapterUid,
      title: chapter.title || snapshot.chapterTitle,
      chapterIdx: numberOrNull(chapter.chapterIdx),
      wordCount: numberOrNull(chapter.wordCount)
    },
    bookContext,
    publicSignals,
    personalSignals,
    bookReviews: publicSignals.bookReviews,
    bestBookmarks: publicSignals.bestBookmarks,
    bookmarkReviews: publicSignals.bookmarkReviews,
    debug: {
      skillCalls,
      rawBookId: snapshot.bookId,
      resolvedBookId: skillBookId,
      warnings
    }
  };

  logger.info('skill_signal_built', {
    bookId: snapshot.bookId,
    resolvedBookId: skillBookId,
    chapterUid,
    bestBookmarkCount: signalPanel.bestBookmarks.length,
    bookmarkReviewCount: signalPanel.bookmarkReviews.reduce((sum, review) => sum + review.comments.length, 0),
    bookReviewCount: signalPanel.bookReviews.length,
    warnings
  });

  return signalPanel;
}

async function buildPersonalSignals({ wereadClient, skillCalls, warnings, enabled, bookId, chapterUid, popularHighlightCount }) {
  if (!enabled) {
    return { enabled: false, bookmarks: [], reviews: [], underlines: [] };
  }

  const bookmarkListResp = await callOptionalSkill(wereadClient, skillCalls, warnings, '/book/bookmarklist', {
    bookId
  }, '个人划线获取失败');
  const mineReviewsResp = await callOptionalSkill(wereadClient, skillCalls, warnings, '/review/list/mine', {
    bookid: bookId,
    count: 20
  }, '个人想法获取失败');
  const underlinesResp = chapterUid && popularHighlightCount < 3
    ? await callOptionalSkill(wereadClient, skillCalls, warnings, '/book/underlines', {
      bookId,
      chapterUid,
      synckey: 0
    }, '划线热度获取失败')
    : { underlines: [] };

  return {
    enabled: true,
    bookmarks: normalizePersonalBookmarks(bookmarkListResp.updated || [], chapterUid),
    reviews: normalizeMineReviews(mineReviewsResp.reviews || [], chapterUid),
    underlines: normalizeUnderlines(underlinesResp.underlines || [])
  };
}

async function callOptionalSkill(wereadClient, skillCalls, warnings, apiName, params, label) {
  try {
    return await callSkill(wereadClient, skillCalls, apiName, params);
  } catch (err) {
    warnings.push(`${label}: ${err.message}`);
    return {};
  }
}

async function callSkill(wereadClient, skillCalls, apiName, params) {
  skillCalls.push(apiName);
  return wereadClient.call(apiName, params);
}

async function resolveBookIdByTitle(wereadClient, skillCalls, bookTitle) {
  const resp = await callSkill(wereadClient, skillCalls, '/store/search', {
    keyword: bookTitle,
    count: 5
  });
  const books = extractSearchBooks(resp);
  const normalizedTitle = normalizeTitle(bookTitle);
  const exact = books.find((book) => normalizeTitle(book.title) === normalizedTitle);
  const partial = books.find((book) => {
    const title = normalizeTitle(book.title);
    return title && normalizedTitle && (title.includes(normalizedTitle) || normalizedTitle.includes(title));
  });
  const selected = exact || partial || books[0];
  return selected ? selected.bookId : null;
}

function extractSearchBooks(resp) {
  return (resp.results || []).flatMap((group) => group.books || [])
    .map((item) => item.bookInfo || item)
    .filter((book) => book && book.bookId && book.title);
}

function normalizeTitle(value) {
  return String(value || '')
    .replace(/[《》]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function resolveChapter(snapshot, chapters, warnings) {
  if (snapshot.chapterUid) {
    const found = chapters.find((chapter) => chapter.chapterUid === snapshot.chapterUid);
    return found || { chapterUid: snapshot.chapterUid, title: snapshot.chapterTitle };
  }

  const found = chapters.find((chapter) => chapter.title === snapshot.chapterTitle);
  if (found) return found;

  warnings.push(`未能通过章节标题补齐 chapterUid: ${snapshot.chapterTitle}`);
  return { chapterUid: null, title: snapshot.chapterTitle };
}

function normalizeBookInfo(value) {
  return {
    bookId: String(value.bookId || ''),
    title: String(value.title || ''),
    author: String(value.author || ''),
    translator: String(value.translator || ''),
    intro: String(value.intro || ''),
    category: String(value.category || ''),
    publisher: String(value.publisher || ''),
    publishTime: String(value.publishTime || ''),
    isbn: String(value.isbn || ''),
    wordCount: numberOrNull(value.wordCount),
    newRating: numberOrNull(value.newRating),
    newRatingCount: numberOrNull(value.newRatingCount),
    newRatingDetail: value.newRatingDetail || null
  };
}

function normalizeReadingProgress(value) {
  const book = value.book || {};
  return {
    chapterUid: numberOrNull(book.chapterUid),
    chapterOffset: numberOrNull(book.chapterOffset),
    progress: numberOrNull(book.progress),
    updateTime: numberOrNull(book.updateTime),
    recordReadingTime: numberOrNull(book.recordReadingTime),
    finishTime: numberOrNull(book.finishTime),
    isStartReading: numberOrNull(book.isStartReading),
    timestamp: numberOrNull(value.timestamp)
  };
}

function normalizeBestBookmarks(items, chapterUid) {
  return items
    .filter((item) => !chapterUid || !item.chapterUid || item.chapterUid === chapterUid)
    .slice(0, 20)
    .map((item) => ({
      range: String(item.range || ''),
      markText: String(item.markText || ''),
      totalCount: Number(item.totalCount || 0),
      chapterUid: item.chapterUid || chapterUid || null
    }))
    .filter((item) => item.range && item.markText);
}

function normalizeBookmarkReviews(reviews) {
  return reviews.map((item) => ({
    range: String(item.range || ''),
    totalCount: Number(item.totalCount || 0),
    comments: (item.pageReviews || [])
      .map((pageReview) => pageReview.review && pageReview.review.content)
      .filter(Boolean)
      .slice(0, 5)
  })).filter((item) => item.range);
}

function normalizeBookReviews(reviews) {
  return reviews.map((item) => {
    const review = item.review && (item.review.review || item.review);
    return {
      content: String((review && review.content) || ''),
      likeCount: Number((review && (review.likeCount || review.likesCount)) || 0)
    };
  }).filter((item) => item.content).slice(0, 8);
}

function normalizePersonalBookmarks(items, chapterUid) {
  return items
    .filter((item) => !chapterUid || item.chapterUid === chapterUid)
    .map((item) => ({
      bookmarkId: String(item.bookmarkId || ''),
      chapterUid: item.chapterUid || null,
      markText: String(item.markText || ''),
      range: String(item.range || ''),
      createTime: numberOrNull(item.createTime)
    }))
    .filter((item) => item.markText);
}

function normalizeMineReviews(items, chapterUid) {
  return items.map((item) => item.review || item)
    .filter((review) => !chapterUid || !review.chapterUid || review.chapterUid === chapterUid)
    .map((review) => ({
      reviewId: String(review.reviewId || ''),
      content: String(review.content || ''),
      chapterName: String(review.chapterName || ''),
      createTime: numberOrNull(review.createTime),
      star: numberOrNull(review.star)
    }))
    .filter((item) => item.content);
}

function normalizeUnderlines(items) {
  return items.map((item) => ({
    range: String(item.range || ''),
    count: Number(item.count || 0),
    score: Number(item.score || 0),
    type: numberOrNull(item.type)
  })).filter((item) => item.range);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = {
  buildSignalPanel,
  normalizeBestBookmarks,
  normalizeBookmarkReviews,
  normalizeBookReviews,
  resolveChapter
};
```

- [ ] **Step 5: Modify `server/createApp.js` imports and config usage**

At the top of `server/createApp.js`, replace the prompt constant and internal signal builder ownership with imports:

```javascript
const crypto = require('node:crypto');
const express = require('express');

const { PROMPT_VERSION } = require('./readingStrategy');
const { buildSignalPanel } = require('./signalBuilder');
```

In the snapshot upload route, replace:

```javascript
      const signalPanel = await buildSignalPanel(wereadClient, normalizedSnapshot, logger);
```

with:

```javascript
      const signalPanel = await buildSignalPanel(wereadClient, normalizedSnapshot, {
        logger,
        enablePersonalSignals: config.enablePersonalSignals
      });
```

Remove these functions from `server/createApp.js` because they now live in `server/signalBuilder.js`:

```text
buildSignalPanel
callSkill
resolveBookIdByTitle
extractSearchBooks
normalizeTitle
resolveChapter
normalizeBestBookmarks
normalizeBookmarkReviews
normalizeBookReviews
numberOrNull
```

Keep `writeSse` exported. Remove `buildSignalPanel` from the `module.exports` object.

- [ ] **Step 6: Add personal signal config in `server/index.js`**

Change the config object to:

```javascript
const config = {
  port: Number(process.env.PORT || 19763),
  clientToken: process.env.CLIENT_TOKEN || 'dev-token',
  enablePersonalSignals: process.env.ENABLE_PERSONAL_SIGNALS === 'true'
};
```

Add this log line inside `app.listen`:

```javascript
  console.log(`[WeRead AI Agent] personal signals: ${config.enablePersonalSignals ? 'enabled' : 'disabled'}`);
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- test/agent-server.test.js test/reading-strategy.test.js
```

Expected: PASS for signal tier assertions. If the SSE compatibility test still fails, complete Task 4 before committing Task 3.

- [ ] **Step 8: Commit signal builder extraction**

Run after focused tests pass:

```bash
git add server/signalBuilder.js server/createApp.js server/index.js test/agent-server.test.js
git commit -m "Layer WeRead signals before strategy generation" -m "Constraint: Use more WeRead Skill data without making every personal endpoint part of the default path." -m "Rejected: Call every available WeRead endpoint on each chapter | It adds latency and unnecessary personal-data exposure." -m "Confidence: high" -m "Scope-risk: moderate" -m "Directive: Keep personal reading signals behind explicit ENABLE_PERSONAL_SIGNALS configuration." -m "Tested: npm test -- test/agent-server.test.js test/reading-strategy.test.js" -m "Not-tested: Live WeRead API behavior; tests use stubbed gateway responses."
```

---

### Task 4: Integrate New SSE Complete Payload and Cache

**Files:**
- Modify: `server/createApp.js`
- Modify: `test/agent-server.test.js`

- [ ] **Step 1: Update failing cache expectation**

Add this test to `test/agent-server.test.js` after the new SSE compatibility test:

```javascript
test('caches reading judgement with compatible legacy judgement', async () => {
  let streamCount = 0;
  const app = createApp({
    config: { clientToken: 'dev-token' },
    wereadClient: createStubWeReadClient([]),
    llmClient: {
      async *streamShortJudgement() {
        streamCount += 1;
        yield {
          type: 'complete',
          readingJudgement: {
            recommendation: 'quick_read',
            masteryScore: {
              overall: 52,
              informationDensity: 40,
              structuralImportance: 55,
              skipRisk: 30
            },
            nextMustKnow: ['了解本章过渡作用'],
            reasons: ['证据较少。'],
            keyPassages: ['过渡段'],
            questionsForAuthor: ['这一章为什么放在这里？'],
            readerPerspective: '',
            readingAdvice: '快读即可。'
          },
          judgement: {
            conclusion: 'quick_read',
            reasons: ['证据较少。'],
            keyPassages: ['过渡段'],
            readerPerspective: '',
            readingAction: '快读即可。'
          }
        };
      }
    },
    logger: { info() {}, warn() {}, error() {} }
  });

  await withServer(app, async (baseUrl) => {
    const snapshotResp = await fetch(`${baseUrl}/api/reading-snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createSnapshot())
    });
    const { snapshotId } = await snapshotResp.json();

    const first = await fetch(`${baseUrl}/api/reading-snapshots/${snapshotId}/judgement/stream?clientToken=dev-token`);
    const second = await fetch(`${baseUrl}/api/reading-snapshots/${snapshotId}/judgement/stream?clientToken=dev-token`);

    assert.equal(streamCount, 1);
    assert.match(await first.text(), /"readingJudgement":\{"recommendation":"quick_read"/);
    assert.match(await second.text(), /"readingJudgement":\{"recommendation":"quick_read"/);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- test/agent-server.test.js
```

Expected: FAIL if cached SSE complete writes only `{ judgement }`.

- [ ] **Step 3: Update complete event handling in `server/createApp.js`**

In the SSE route, replace:

```javascript
    const cachedJudgement = judgementCache.get(judgementCacheKey);
    if (cachedJudgement) {
      writeSse(res, 'complete', { judgement: cachedJudgement });
      res.end();
      return;
    }
```

with:

```javascript
    const cachedResult = judgementCache.get(judgementCacheKey);
    if (cachedResult) {
      writeSse(res, 'complete', cachedResult);
      res.end();
      return;
    }
```

Replace:

```javascript
      let completedJudgement = null;
```

with:

```javascript
      let completedResult = null;
```

Replace the complete-event branch with:

```javascript
        } else if (event.type === 'complete') {
          completedResult = {
            readingJudgement: event.readingJudgement || null,
            judgement: event.judgement || event.readingJudgement || {}
          };
          writeSse(res, 'complete', completedResult);
        }
```

Replace:

```javascript
      if (completedJudgement) {
        judgementCache.set(judgementCacheKey, completedJudgement);
      }
```

with:

```javascript
      if (completedResult) {
        judgementCache.set(judgementCacheKey, completedResult);
      }
```

- [ ] **Step 4: Run server tests**

Run:

```bash
npm test -- test/agent-server.test.js test/reading-strategy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit SSE integration**

Run:

```bash
git add server/createApp.js test/agent-server.test.js
git commit -m "Stream structured reading judgements with legacy compatibility" -m "Constraint: Preserve existing extension consumers while introducing readingJudgement." -m "Rejected: Break the existing judgement payload immediately | Compatibility keeps the browser migration incremental." -m "Confidence: high" -m "Scope-risk: moderate" -m "Directive: Cache the complete SSE payload, not only the legacy judgement object." -m "Tested: npm test -- test/agent-server.test.js test/reading-strategy.test.js" -m "Not-tested: Manual browser SSE rendering remains in Task 5."
```

---

### Task 5: Render New Judgement Fields in the Extension

**Files:**
- Modify: `extension/content.js`
- Modify: `extension/styles/content.css`
- Modify: `test/extension-ui-contract.test.js`

- [ ] **Step 1: Add failing extension contract checks**

Append these tests to `test/extension-ui-contract.test.js`:

```javascript
test('reading judgement renders mastery score and next must-know items', () => {
  assert.match(contentJs, /function renderMasteryScore\(masteryScore\)/);
  assert.match(contentJs, /掌握价值分/);
  assert.match(contentJs, /renderList\('最需要掌握', judgement\.nextMustKnow\)/);
  assert.match(contentCss, /\.wap-score-grid/);
});

test('reading judgement renders questions for author without answer wording', () => {
  assert.match(contentJs, /renderList\('追问问题', judgement\.questionsForAuthor\)/);
  assert.doesNotMatch(contentJs, /作者回答|模拟作者|答案/);
});

test('debug fallback no longer rebuilds a divergent prompt', () => {
  assert.doesNotMatch(contentJs, /function buildAgentRequestFallback/);
  assert.doesNotMatch(contentJs, /server-generated-url-unavailable/);
});
```

- [ ] **Step 2: Run contract tests to verify failure**

Run:

```bash
npm test -- test/extension-ui-contract.test.js
```

Expected: FAIL because `renderMasteryScore` is not defined and the old fallback prompt still exists.

- [ ] **Step 3: Update SSE complete handling in `extension/content.js`**

Replace:

```javascript
      } else if (message.event === 'complete') {
        renderJudgement(message.data.judgement || {});
```

with:

```javascript
      } else if (message.event === 'complete') {
        renderJudgement(normalizeReadingJudgement(message.data));
```

Add this function before `renderJudgement`:

```javascript
  function normalizeReadingJudgement(data) {
    const judgement = data?.readingJudgement || data?.judgement || {};
    return {
      recommendation: judgement.recommendation || fromLegacyConclusion(judgement.conclusion),
      masteryScore: judgement.masteryScore || {},
      nextMustKnow: judgement.nextMustKnow || [],
      reasons: judgement.reasons || [],
      keyPassages: judgement.keyPassages || [],
      questionsForAuthor: judgement.questionsForAuthor || [],
      readerPerspective: judgement.readerPerspective || '',
      readingAdvice: judgement.readingAdvice || judgement.readingAction || ''
    };
  }

  function fromLegacyConclusion(value) {
    if (value === 'worth_deep_read') return 'deep_read';
    if (value === 'skip_read') return 'skip_read';
    return 'quick_read';
  }
```

- [ ] **Step 4: Replace `renderJudgement` body**

Replace the current `renderJudgement` function with:

```javascript
  function renderJudgement(judgement) {
    const el = document.querySelector('#weread-ai-panel .wap-judgement');
    if (!el) return;
    const adviceScope = buildAdviceScopeText(lastExpectedChapterWordCount, currentChapterText.length, lastCaptureMode) || '实时建议';
    el.innerHTML = `
      <div class="wap-section wap-judgement-card">
        <div class="wap-judgement-heading">
          <div class="wap-section-title">阅读判断</div>
          <span class="wap-scope-badge">${escapeHtml(adviceScope)}</span>
        </div>
        <div class="wap-verdict">${escapeHtml(labelRecommendation(judgement.recommendation))}</div>
        ${renderMasteryScore(judgement.masteryScore)}
        ${renderList('最需要掌握', judgement.nextMustKnow)}
        ${renderList('理由', judgement.reasons)}
        ${renderList('重点段落', judgement.keyPassages)}
        ${renderList('追问问题', judgement.questionsForAuthor)}
        <div class="wap-analysis-section">
          <div class="wap-analysis-title">读者视角</div>
          <div class="wap-analysis-content">${escapeHtml(judgement.readerPerspective || '')}</div>
        </div>
        <div class="wap-analysis-section">
          <div class="wap-analysis-title">阅读建议</div>
          <div class="wap-analysis-content">${escapeHtml(judgement.readingAdvice || '')}</div>
        </div>
      </div>
    `;
  }
```

Add this function after `renderJudgement`:

```javascript
  function renderMasteryScore(masteryScore) {
    const score = masteryScore || {};
    const overall = normalizeDisplayScore(score.overall);
    const items = [
      ['信息密度', score.informationDensity],
      ['结构关键性', score.structuralImportance],
      ['跳读风险', score.skipRisk]
    ];

    return `
      <div class="wap-score-panel">
        <div class="wap-score-main">
          <span class="wap-score-label">掌握价值分</span>
          <span class="wap-score-value">${overall}</span>
        </div>
        <div class="wap-score-grid">
          ${items.map(([label, value]) => `
            <div class="wap-score-item">
              <span>${escapeHtml(label)}</span>
              <strong>${normalizeDisplayScore(value)}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function normalizeDisplayScore(value) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return '--';
    return String(Math.max(0, Math.min(100, number)));
  }
```

Replace `labelConclusion` with:

```javascript
  function labelRecommendation(value) {
    if (value === 'deep_read') return '值得精读';
    if (value === 'skip_read') return '可跳读';
    return '可快读';
  }
```

- [ ] **Step 5: Remove divergent debug fallback in `extension/content.js`**

In `buildFullRequestDebug`, replace:

```javascript
      agentRequest: uploadResponse.agentRequest || buildAgentRequestFallback(agentInput),
```

with:

```javascript
      agentRequest: uploadResponse.agentRequest || {
        note: '服务器未返回完整 LLM 请求调试体。',
        agentInputSummary: summarizeAgentInput(agentInput)
      },
```

Remove the entire `buildAgentRequestFallback` function.

In `buildAgentInputDebug`, update the task and output shape to match the strategy:

```javascript
      task: '判断当前章节接下来最需要掌握什么，并给出精读、快读或跳读建议。',
```

and:

```javascript
      outputShape: {
        recommendation: 'deep_read | quick_read | skip_read',
        masteryScore: {
          overall: '0-100 掌握价值分',
          informationDensity: '0-100 信息密度分',
          structuralImportance: '0-100 结构关键性分',
          skipRisk: '0-100 可跳读风险分'
        },
        nextMustKnow: ['接下来最需要掌握的东西'],
        reasons: ['2-3 条证据'],
        keyPassages: ['3-5 条热门划线或正文片段'],
        questionsForAuthor: ['带着阅读的问题，不要给答案'],
        readerPerspective: '评论中的共识、争议、误读或补充',
        readingAdvice: '具体精读、快读或跳读建议'
      }
```

- [ ] **Step 6: Add score styles**

Append to `extension/styles/content.css` after `.wap-verdict`:

```css
.wap-score-panel {
  padding: 10px 12px;
  margin-bottom: 12px;
  border: 1px solid #e5edf7;
  border-radius: 8px;
  background: #ffffff;
}

.wap-score-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.wap-score-label {
  color: #475569;
  font-size: 12px;
  font-weight: 600;
}

.wap-score-value {
  color: #124c77;
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
}

.wap-score-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.wap-score-item {
  min-width: 0;
  padding: 6px;
  border-radius: 6px;
  background: #f8fbff;
  color: #64748b;
  font-size: 11px;
  line-height: 1.3;
}

.wap-score-item strong {
  display: block;
  margin-top: 2px;
  color: #1f2937;
  font-size: 13px;
}
```

- [ ] **Step 7: Run extension tests**

Run:

```bash
npm test -- test/extension-ui-contract.test.js
```

Expected: PASS.

- [ ] **Step 8: Run full test suite and syntax checks**

Run:

```bash
npm test
node --check server/createApp.js server/index.js server/llmClient.js server/readingStrategy.js server/signalBuilder.js server/wereadClient.js test/agent-server.test.js test/reading-strategy.test.js extension/background.js extension/content.js extension/canvas-hook.js extension/options.js extension/popup.js
```

Expected: PASS and no syntax errors.

- [ ] **Step 9: Commit extension rendering**

Run:

```bash
git add extension/content.js extension/styles/content.css test/extension-ui-contract.test.js
git commit -m "Render mastery-focused reading judgements" -m "Constraint: Keep the existing panel layout while adding score, next-must-know, and questions sections." -m "Rejected: Rebuild a client-side fallback prompt | It can drift from the server strategy contract." -m "Confidence: high" -m "Scope-risk: moderate" -m "Directive: Do not add answer text under questionsForAuthor." -m "Tested: npm test; node --check server/createApp.js server/index.js server/llmClient.js server/readingStrategy.js server/signalBuilder.js server/wereadClient.js test/agent-server.test.js test/reading-strategy.test.js extension/background.js extension/content.js extension/canvas-hook.js extension/options.js extension/popup.js" -m "Not-tested: Live Chrome extension rendering on WeRead page."
```

---

### Task 6: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `CONTEXT.md`

- [ ] **Step 1: Update README environment section**

In `README.md`, after `export CLIENT_TOKEN="change-me"`, add:

```bash
export ENABLE_PERSONAL_SIGNALS="false"
```

In the usage or data boundary section, add this paragraph:

```markdown
`ENABLE_PERSONAL_SIGNALS=true` 会把个人划线和个人想法加入章节判断输入。默认关闭时，Agent 只使用公共阅读信号、书籍上下文信号和浏览器采集到的章节正文快照。
```

- [ ] **Step 2: Update README flow description**

Replace the sentence describing the LLM output with:

```markdown
LLM 返回的阅读判断会包含精读/快读/跳读建议、掌握价值分、接下来最需要掌握的内容、追问问题、重点段落和读者视角。
```

- [ ] **Step 3: Update CONTEXT interface examples**

In `CONTEXT.md`, update the signal panel response example to include:

```json
    "bookContext": {
      "bookInfo": { "title": "string", "author": "string", "newRating": 86 },
      "readingProgress": { "progress": 25 }
    },
    "publicSignals": {
      "bookReviews": [],
      "bestBookmarks": [],
      "bookmarkReviews": []
    },
    "personalSignals": {
      "enabled": false,
      "bookmarks": [],
      "reviews": [],
      "underlines": []
    },
```

Update the short judgement SSE complete example to:

```text
event: complete
data: {"readingJudgement":{"recommendation":"deep_read","masteryScore":{"overall":88,"informationDensity":82,"structuralImportance":90,"skipRisk":75},"nextMustKnow":[],"reasons":[],"keyPassages":[],"questionsForAuthor":[],"readerPerspective":"","readingAdvice":""},"judgement":{"conclusion":"worth_deep_read","reasons":[],"keyPassages":[],"readerPerspective":"","readingAction":""}}
```

- [ ] **Step 4: Run final verification**

Run:

```bash
npm test
node --check server/createApp.js server/index.js server/llmClient.js server/readingStrategy.js server/signalBuilder.js server/wereadClient.js test/agent-server.test.js test/reading-strategy.test.js extension/background.js extension/content.js extension/canvas-hook.js extension/options.js extension/popup.js
git status --short
```

Expected:

```text
all tests pass
all node --check commands exit 0
git status --short shows only README.md and CONTEXT.md before the documentation commit
```

- [ ] **Step 5: Commit documentation**

Run:

```bash
git add README.md CONTEXT.md
git commit -m "Document mastery-focused reading judgements" -m "Constraint: Keep docs aligned with the new server schema and the personal-signal config boundary." -m "Rejected: Document personal signals as always-on | Default-off behavior is the safer local baseline." -m "Confidence: high" -m "Scope-risk: narrow" -m "Directive: Keep public, book-context, and personal signal terms distinct in future docs." -m "Tested: npm test; node --check server/createApp.js server/index.js server/llmClient.js server/readingStrategy.js server/signalBuilder.js server/wereadClient.js test/agent-server.test.js test/reading-strategy.test.js extension/background.js extension/content.js extension/canvas-hook.js extension/options.js extension/popup.js" -m "Not-tested: Live WeRead browser session."
```

- [ ] **Step 6: Final working tree check**

Run:

```bash
git status --short
git log --oneline -n 6
```

Expected: clean working tree and task commits visible at the top of history.
