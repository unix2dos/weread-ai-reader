const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MASTERY_SCORE_WEIGHTS,
  PROMPT_VERSION,
  buildCaptureInput,
  buildEvidenceWarning,
  buildMessages,
  buildRequestBody,
  buildStrategyInput,
  calculateMasteryScore,
  parseReadingJudgement,
  toCompatibleReadingJudgement,
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
      bookmarkReviews: [{ range: '1-20', totalCount: 1, comments: [{ content: '这段是后面理解的基础。', likeCount: 8 }] }],
      bookReviews: [{ content: '结构清楚。', likeCount: 4 }]
    },
    personalSignals: { enabled: false, bookmarks: [], reviews: [], underlines: [] },
    bestBookmarks: [{ range: '1-20', markText: '核心概念', totalCount: 12, chapterUid: 101 }],
    bookmarkReviews: [{ range: '1-20', totalCount: 1, comments: [{ content: '这段是后面理解的基础。', likeCount: 8 }] }],
    bookReviews: [{ content: '结构清楚。', likeCount: 4 }],
    debug: { resolvedBookId: 'book-1', warnings: [] },
    ...overrides
  };
}

function completeReadingJudgement(overrides = {}) {
  return {
    recommendation: 'quick_read',
    masteryScore: {
      overall: 58,
      takeawayValue: 45,
      understandingLeverage: 50,
      attentionROI: 70
    },
    nextMustKnow: ['理解本章的过渡作用'],
    reasons: ['当前可见正文更像承接段。'],
    evidenceSnippets: ['当前可见正文'],
    questionsForAuthor: ['这一章为什么放在这里？'],
    readerPerspective: '公开评论不足，暂以正文和划线信号判断。',
    readingAdvice: '快读结构句，遇到概念定义再放慢。',
    ...overrides
  };
}

test('buildStrategyInput includes harvest-value score and reading-question output requirements', () => {
  const signalPanel = createSignalPanel();
  const input = buildStrategyInput({
    snapshot: createSnapshot(),
    signalPanel
  });

  assert.equal(input.promptVersion, PROMPT_VERSION);
  assert.equal(input.task, '判断当前章节读完能带走什么可靠收获，并给出精读、快读或跳读建议。');
  assert.equal(input.chapter.capture.status, 'partial');
  assert.equal(input.bookContext, undefined);
  assert.equal(input.publicSignals, undefined);
  assert.equal(input.personalSignals, undefined);
  assert.deepEqual(input.signals, {
    bookContext: signalPanel.bookContext,
    publicSignals: signalPanel.publicSignals,
    personalSignals: signalPanel.personalSignals
  });
  assert.equal(input.outputShape.recommendation, 'must_deep_read | deep_read | quick_read | skip_read');
  assert.equal(input.scoreRubric.masteryScoreOverall, '服务端按固定权重从三个收获价值子分派生，模型输出的 overall 会被忽略');
  assert.deepEqual(input.scoreRubric.weights, MASTERY_SCORE_WEIGHTS);
  assert.deepEqual(input.scoreRubric.thresholds, {
    mustDeepRead: '90-100 必须精读，本章是全书理解枢纽',
    deepRead: '80-89 值得精读，但必须说明具体价值来源',
    quickRead: '65-79 快读为主，只精读局部段落',
    skipRead: '0-64 可跳读或只扫结论'
  });
  assert.equal(input.outputShape.masteryScore.overall, undefined);
  assert.equal(input.outputShape.masteryScore.takeawayValue, '0-100 可带走收获分');
  assert.equal(input.outputShape.masteryScore.understandingLeverage, '0-100 理解杠杆分');
  assert.equal(input.outputShape.masteryScore.attentionROI, '0-100 投入回报分');
  assert.equal(input.outputShape.masteryScore.contentGain, undefined);
  assert.equal(input.outputShape.masteryScore.structuralImportance, undefined);
  assert.equal(input.outputShape.masteryScore.deepReadNecessity, undefined);
  assert.equal(input.outputShape.masteryScore.informationDensity, undefined);
  assert.equal(input.outputShape.masteryScore.skipRisk, undefined);
  assert.equal(input.outputShape.nextMustKnow[0], '1-3 条读完本章能带走的概念、方法、判断框架、关键事实或可迁移理解');
  assert.equal(input.outputShape.reasons[0], '1-2 条只基于当前章节与信号的判断依据');
  assert.equal(input.outputShape.evidenceSnippets[0], '1-3 条可追溯证据片段；必须来自热门划线、划线评论或当前可见正文片段');
  assert.equal(input.outputShape.keyPassages, undefined);
  assert.equal(input.outputShape.questionsForAuthor[0], '1-2 个带着读的问题；至少一个验证核心收获，可有一个追问边界、前提、反证或常见误读；只给问题，不要给答案');
  assert.equal(input.outputShape.readingAdvice, '一句明确阅读动作，60字内，直接说明精读、快读或跳读怎么做');
});

test('buildCaptureInput reports capture coverage for partial chapter text', () => {
  const capture = buildCaptureInput(createSnapshot(), createSignalPanel());

  assert.equal(capture.status, 'partial');
  assert.equal(capture.coverage.status, 'partial');
  assert.equal(capture.coveragePercent, 1);
  assert.equal(capture.expectedWordCount, 3200);
});

test('buildEvidenceWarning only warns when capture or public signals are weak', () => {
  const warning = buildEvidenceWarning({
    snapshot: createSnapshot(),
    signalPanel: createSignalPanel({
      publicSignals: { bestBookmarks: [], bookmarkReviews: [], bookReviews: [] },
      bestBookmarks: [],
      bookmarkReviews: [],
      bookReviews: [],
      debug: { warnings: ['热门划线获取失败'] }
    })
  });

  assert.match(warning, /依据偏弱/);
  assert.match(warning, /正文覆盖偏低/);
  assert.match(warning, /本章热门划线较少/);
  assert.match(warning, /Skill 信号有告警/);

  assert.equal(buildEvidenceWarning({
    snapshot: createSnapshot({
      chapterText: '完整正文。'.repeat(1200)
    }),
    signalPanel: createSignalPanel({
      publicSignals: {
        bestBookmarks: Array.from({ length: 3 }, (_, index) => ({
          range: `${index}-${index + 1}`,
          markText: `收获证据 ${index}`,
          totalCount: 20,
          chapterUid: 101
        })),
        bookmarkReviews: [
          { range: '1-2', totalCount: 2, comments: [{ content: '解释原因' }, { content: '补充边界' }] }
        ],
        bookReviews: []
      },
      bestBookmarks: Array.from({ length: 3 }, (_, index) => ({
        range: `${index}-${index + 1}`,
        markText: `收获证据 ${index}`,
        totalCount: 20,
        chapterUid: 101
      })),
      bookmarkReviews: [
        { range: '1-2', totalCount: 2, comments: [{ content: '解释原因' }, { content: '补充边界' }] }
      ]
    })
  }), '');
});

test('buildMessages includes required system prompt constraints', () => {
  const messages = buildMessages({
    snapshot: createSnapshot(),
    signalPanel: createSignalPanel()
  });
  const systemPrompt = messages[0].content;

  assert.match(systemPrompt, /只判断当前章节/);
  assert.match(systemPrompt, /不是文学质量/);
  assert.match(systemPrompt, /带着读的问题只给问题/);
  assert.match(systemPrompt, /不要给答案/);
  assert.match(systemPrompt, /不要模拟作者对话/);
  assert.match(systemPrompt, /二八原则/);
  assert.match(systemPrompt, /收获价值总分由服务端按固定权重派生/);
  assert.match(systemPrompt, /90-100/);
  assert.match(systemPrompt, /80-89/);
  assert.match(systemPrompt, /65-79/);
  assert.match(systemPrompt, /首屏/);
  assert.match(systemPrompt, /一句明确阅读动作/);
  assert.match(systemPrompt, /可带走收获/);
  assert.match(systemPrompt, /理解杠杆/);
  assert.match(systemPrompt, /投入回报/);
  assert.match(systemPrompt, /热度不能直接抬高收获价值/);
  assert.match(systemPrompt, /金句、共鸣、重复观点和泛泛赞同/);
  assert.match(systemPrompt, /证据片段必须来自输入证据/);
  assert.match(systemPrompt, /可快读.*不能写成“必须精读”/);
  assert.match(systemPrompt, /必须只输出 JSON/);
  assert.match(systemPrompt, /recommendation 只能是 must_deep_read、deep_read、quick_read 或 skip_read/);
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
  assert.equal(body.max_tokens, 900);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[0].content, /收获价值分/);
  assert.match(body.messages[0].content, /带着读的问题只给问题/);
  assert.match(body.messages[1].content, /questionsForAuthor/);
  assert.match(body.messages[1].content, /evidenceSnippets/);
  assert.match(body.messages[1].content, /"signals":\{/);
  assert.match(body.messages[1].content, /bookContext/);
});

test('buildStrategyInput caps signal volume for fast judgement', () => {
  const longText = '这是一段很长的评论。'.repeat(80);
  const signalPanel = createSignalPanel({
    publicSignals: {
      bestBookmarks: Array.from({ length: 20 }, (_, index) => ({
        range: `${index}-${index + 1}`,
        markText: longText,
        totalCount: 1000 - index,
        chapterUid: 101
      })),
      bookmarkReviews: Array.from({ length: 20 }, (_, index) => ({
        range: `${index}-${index + 1}`,
        totalCount: 10,
        comments: [
          { content: longText, likeCount: 3 },
          { content: longText, likeCount: 2 },
          { content: longText, likeCount: 1 }
        ]
      })),
      bookReviews: Array.from({ length: 8 }, (_, index) => ({
        content: `${index}${longText}`,
        likeCount: index
      }))
    }
  });

  const input = buildStrategyInput({
    snapshot: createSnapshot(),
    signalPanel
  });

  assert.equal(input.signals.publicSignals.bestBookmarks.length, 8);
  assert.equal(input.signals.publicSignals.bookmarkReviews.length, 6);
  assert.equal(input.signals.publicSignals.bookmarkReviews[0].comments.length, 2);
  assert.equal(input.signals.publicSignals.bookReviews.length, 2);
  assert.ok(input.signals.publicSignals.bestBookmarks[0].markText.length <= 180);
  assert.ok(input.signals.publicSignals.bookmarkReviews[0].comments[0].content.length <= 180);
  assert.equal(input.signals.publicSignals.bookmarkReviews[0].comments[0].likeCount, 3);
  assert.ok(input.signals.publicSignals.bookReviews[0].content.length <= 240);
});

test('buildStrategyInput does not invent zero likes for comments without like fields', () => {
  const input = buildStrategyInput({
    snapshot: createSnapshot(),
    signalPanel: createSignalPanel({
      publicSignals: {
        bestBookmarks: [{ range: '1-20', markText: '核心概念', totalCount: 12, chapterUid: 101 }],
        bookmarkReviews: [
          {
            range: '1-20',
            totalCount: 1,
            comments: [{ content: '接口没有返回点赞字段。' }]
          }
        ],
        bookReviews: []
      }
    })
  });

  assert.deepEqual(input.signals.publicSignals.bookmarkReviews[0].comments, [
    { content: '接口没有返回点赞字段。' }
  ]);
});

test('parseReadingJudgement normalizes score ranges and arrays', () => {
  const judgement = parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    recommendation: 'deep_read',
    masteryScore: {
      overall: 120,
      takeawayValue: 91,
      understandingLeverage: 80,
      attentionROI: -5
    },
    nextMustKnow: ['核心概念', '后文章节会复用的区分'],
    reasons: ['热门划线集中在定义段。'],
    evidenceSnippets: ['核心概念'],
    questionsForAuthor: ['作者为什么先定义这个概念？'],
    readerPerspective: '读者认为这里是基础。',
    readingAdvice: '先精读定义段，再快读例子。'
  })));

  assert.equal(judgement.recommendation, 'quick_read');
  assert.deepEqual(judgement.masteryScore, {
    overall: 69,
    takeawayValue: 91,
    understandingLeverage: 80,
    attentionROI: 0
  });
  assert.deepEqual(judgement.evidenceSnippets, ['核心概念']);
  assert.deepEqual(judgement.questionsForAuthor, ['作者为什么先定义这个概念？']);
  assert.equal(judgement.readingAdvice, '先精读定义段，再快读例子。');
});

test('parseReadingJudgement derives overall score from weighted dimensions', () => {
  assert.equal(calculateMasteryScore({
    takeawayValue: 80,
    understandingLeverage: 90,
    attentionROI: 70
  }), 82);

  const judgement = parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    recommendation: 'quick_read',
    masteryScore: {
      overall: 99,
      takeawayValue: 80,
      understandingLeverage: 90,
      attentionROI: 70
    }
  })));

  assert.equal(judgement.masteryScore.overall, 82);
  assert.equal(judgement.recommendation, 'deep_read');
});

test('parseReadingJudgement enforces strict four-level recommendation thresholds', () => {
  const mustRead = parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    recommendation: 'quick_read',
    masteryScore: {
      overall: 10,
      takeawayValue: 95,
      understandingLeverage: 95,
      attentionROI: 90
    }
  })));

  assert.equal(mustRead.masteryScore.overall, 94);
  assert.equal(mustRead.recommendation, 'must_deep_read');

  const judgement = parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    recommendation: 'deep_read',
    masteryScore: {
      overall: 95,
      takeawayValue: 70,
      understandingLeverage: 70,
      attentionROI: 80
    }
  })));

  assert.equal(judgement.masteryScore.overall, 72);
  assert.equal(judgement.recommendation, 'quick_read');
});

test('parseReadingJudgement removes must-read wording from quick-read advice', () => {
  const judgement = parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    recommendation: 'deep_read',
    masteryScore: {
      takeawayValue: 70,
      understandingLeverage: 70,
      attentionROI: 80
    },
    readingAdvice: '必须精读消费主义链条，其余快读。'
  })));

  assert.equal(judgement.recommendation, 'quick_read');
  assert.equal(judgement.readingAdvice, '局部精读消费主义链条，其余快读。');
});

test('parseReadingJudgement accepts legacy score and evidence fields and emits new names', () => {
  const judgement = parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    masteryScore: {
      informationDensity: 80,
      structuralImportance: 90,
      skipRisk: 70
    },
    evidenceSnippets: undefined,
    keyPassages: ['旧重点段落']
  })));

  assert.deepEqual(judgement.masteryScore, {
    overall: 82,
    takeawayValue: 80,
    understandingLeverage: 90,
    attentionROI: 70
  });
  assert.deepEqual(judgement.evidenceSnippets, ['旧重点段落']);

  assert.equal(calculateMasteryScore({
    contentGain: 100,
    structuralImportance: 0,
    deepReadNecessity: 0
  }), 45);
});

test('parseReadingJudgement limits list fields', () => {
  const judgement = parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    recommendation: 'quick_read',
    nextMustKnow: ['一', '二', '三', '四', '五'],
    reasons: ['一', '二', '三', '四'],
    evidenceSnippets: ['一', '二', '三', '四', '五', '六'],
    questionsForAuthor: ['一', '二', '三', '四', '五', '六']
  })));

  assert.deepEqual(judgement.nextMustKnow, ['一', '二', '三']);
  assert.deepEqual(judgement.reasons, ['一', '二']);
  assert.deepEqual(judgement.evidenceSnippets, ['一', '二', '三']);
  assert.deepEqual(judgement.questionsForAuthor, ['一', '二']);
});

test('parseReadingJudgement rejects invalid model output', () => {
  assert.throws(() => parseReadingJudgement('not-json'), /Invalid reading judgement JSON/);
  assert.throws(
    () => parseReadingJudgement('prefix {"recommendation":"deep_read"} suffix'),
    /Invalid reading judgement JSON/
  );
  assert.throws(
    () => parseReadingJudgement('```json\n{"recommendation":"deep_read"}\n```'),
    /Invalid reading judgement JSON/
  );
  assert.throws(() => parseReadingJudgement('{}'), /Missing reading judgement recommendation/);
  assert.throws(() => parseReadingJudgement(JSON.stringify({
    reasons: ['缺少推荐']
  })), /Missing reading judgement recommendation/);
  assert.throws(() => parseReadingJudgement(JSON.stringify({
    recommendation: 'maybe_read'
  })), /Invalid reading judgement recommendation/);
  assert.throws(() => parseReadingJudgement(JSON.stringify({
    recommendation: 'quick_read'
  })), /Missing reading judgement field: masteryScore/);
  assert.throws(() => parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    nextMustKnow: []
  }))), /Missing reading judgement field: nextMustKnow/);
});

test('parseReadingJudgement accepts legacy conclusion labels as new recommendations', () => {
  const highScores = {
    overall: 10,
    takeawayValue: 88,
    understandingLeverage: 90,
    attentionROI: 82
  };
  assert.equal(parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    recommendation: 'worth_deep_read',
    masteryScore: highScores
  }))).recommendation, 'deep_read');
  assert.equal(parseReadingJudgement(JSON.stringify(completeReadingJudgement({
    recommendation: undefined,
    conclusion: 'worth_deep_read',
    masteryScore: highScores
  }))).recommendation, 'deep_read');
});

test('toLegacyJudgement maps new recommendation to existing conclusion labels', () => {
  const judgement = {
    reasons: ['理由'],
    evidenceSnippets: ['段落'],
    readerPerspective: '读者视角',
    readingAdvice: '阅读建议'
  };

  assert.equal(toLegacyJudgement({
    ...judgement,
    recommendation: 'must_deep_read'
  }).conclusion, 'worth_deep_read');
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

test('toCompatibleReadingJudgement keeps legacy aliases for stale summary windows', () => {
  const judgement = toCompatibleReadingJudgement({
    recommendation: 'deep_read',
    masteryScore: {
      overall: 83,
      takeawayValue: 82,
      understandingLeverage: 90,
      attentionROI: 75
    },
    evidenceSnippets: ['证据片段'],
    readingAdvice: '精读定义段。',
    reasons: ['理由'],
    nextMustKnow: ['收获'],
    questionsForAuthor: ['问题？'],
    readerPerspective: '读者视角'
  });

  assert.deepEqual(judgement.keyPassages, ['证据片段']);
  assert.equal(judgement.readingAction, '精读定义段。');
  assert.equal(judgement.conclusion, 'worth_deep_read');
  assert.deepEqual(judgement.masteryScore, {
    overall: 83,
    takeawayValue: 82,
    understandingLeverage: 90,
    attentionROI: 75,
    contentGain: 82,
    structuralImportance: 90,
    deepReadNecessity: 75
  });
});
