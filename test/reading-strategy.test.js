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
