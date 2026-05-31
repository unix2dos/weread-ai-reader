const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PROMPT_VERSION,
  buildCaptureInput,
  buildMessages,
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
  const signalPanel = createSignalPanel();
  const input = buildStrategyInput({
    snapshot: createSnapshot(),
    signalPanel
  });

  assert.equal(input.promptVersion, PROMPT_VERSION);
  assert.equal(input.task, '判断当前章节接下来最需要掌握什么，并给出精读、快读或跳读建议。');
  assert.equal(input.chapter.capture.status, 'partial');
  assert.equal(input.bookContext, undefined);
  assert.equal(input.publicSignals, undefined);
  assert.equal(input.personalSignals, undefined);
  assert.deepEqual(input.signals, {
    bookContext: signalPanel.bookContext,
    publicSignals: signalPanel.publicSignals,
    personalSignals: signalPanel.personalSignals
  });
  assert.equal(input.outputShape.recommendation, 'deep_read | quick_read | skip_read');
  assert.equal(input.outputShape.masteryScore.overall, '0-100 掌握价值分');
  assert.equal(input.outputShape.masteryScore.informationDensity, '0-100 信息密度分');
  assert.equal(input.outputShape.masteryScore.structuralImportance, '0-100 结构关键性分');
  assert.equal(input.outputShape.masteryScore.skipRisk, '0-100 可跳读风险分');
  assert.equal(input.outputShape.nextMustKnow[0], '1-4 条接下来最需要掌握的概念、区分或结构');
  assert.equal(input.outputShape.questionsForAuthor[0], '带着阅读的问题，不要给答案');
});

test('buildCaptureInput reports capture coverage for partial chapter text', () => {
  const capture = buildCaptureInput(createSnapshot(), createSignalPanel());

  assert.equal(capture.status, 'partial');
  assert.equal(capture.coverage.status, 'partial');
  assert.equal(capture.coveragePercent, 1);
  assert.equal(capture.expectedWordCount, 3200);
});

test('buildMessages includes required system prompt constraints', () => {
  const messages = buildMessages({
    snapshot: createSnapshot(),
    signalPanel: createSignalPanel()
  });
  const systemPrompt = messages[0].content;

  assert.match(systemPrompt, /只判断当前章节/);
  assert.match(systemPrompt, /不是文学质量/);
  assert.match(systemPrompt, /追问问题只给问题/);
  assert.match(systemPrompt, /不要给答案/);
  assert.match(systemPrompt, /不要模拟作者对话/);
  assert.match(systemPrompt, /必须只输出 JSON/);
  assert.match(systemPrompt, /recommendation 只能是 deep_read、quick_read 或 skip_read/);
  assert.match(systemPrompt, /优先使用公开阅读信号，其次参考书籍上下文，仅在存在个人信号时使用个人信号/);
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
  assert.match(body.messages[1].content, /"signals":\{/);
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

test('parseReadingJudgement limits list fields', () => {
  const judgement = parseReadingJudgement(JSON.stringify({
    recommendation: 'quick_read',
    nextMustKnow: ['一', '二', '三', '四', '五'],
    reasons: ['一', '二', '三', '四'],
    keyPassages: ['一', '二', '三', '四', '五', '六'],
    questionsForAuthor: ['一', '二', '三', '四', '五', '六']
  }));

  assert.deepEqual(judgement.nextMustKnow, ['一', '二', '三', '四']);
  assert.deepEqual(judgement.reasons, ['一', '二', '三']);
  assert.deepEqual(judgement.keyPassages, ['一', '二', '三', '四', '五']);
  assert.deepEqual(judgement.questionsForAuthor, ['一', '二', '三', '四', '五']);
});

test('parseReadingJudgement accepts legacy conclusion labels as new recommendations', () => {
  assert.equal(parseReadingJudgement(JSON.stringify({
    recommendation: 'worth_deep_read'
  })).recommendation, 'deep_read');
  assert.equal(parseReadingJudgement(JSON.stringify({
    conclusion: 'worth_deep_read'
  })).recommendation, 'deep_read');
});

test('toLegacyJudgement maps new recommendation to existing conclusion labels', () => {
  const judgement = {
    reasons: ['理由'],
    keyPassages: ['段落'],
    readerPerspective: '读者视角',
    readingAdvice: '阅读建议'
  };

  assert.deepEqual(toLegacyJudgement({
    ...judgement,
    recommendation: 'deep_read'
  }), {
    conclusion: 'worth_deep_read',
    reasons: ['理由'],
    keyPassages: ['段落'],
    readerPerspective: '读者视角',
    readingAction: '阅读建议'
  });
  assert.equal(toLegacyJudgement({
    ...judgement,
    recommendation: 'quick_read'
  }).conclusion, 'quick_read');
  assert.equal(toLegacyJudgement({
    ...judgement,
    recommendation: 'skip_read'
  }).conclusion, 'skip_read');
});
