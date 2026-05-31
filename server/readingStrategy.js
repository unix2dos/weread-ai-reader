const PROMPT_VERSION = 'reading-strategy-v2';

const RECOMMENDATIONS = new Set(['deep_read', 'quick_read', 'skip_read']);
const LEGACY_CONCLUSIONS = {
  deep_read: 'worth_deep_read',
  quick_read: 'quick_read',
  skip_read: 'skip_read'
};

function buildRequestBody({
  snapshot,
  signalPanel,
  model
}) {
  return {
    model,
    stream: true,
    temperature: 0.2,
    messages: buildMessages({ snapshot, signalPanel })
  };
}

function buildMessages({
  snapshot,
  signalPanel
}) {
  return [
    {
      role: 'system',
      content: [
        '你是微信读书实时跟读助手，只判断当前章节接下来最需要掌握什么。',
        '只基于当前章节正文快照、采集覆盖率、当前章节相关的公开信号和个人信号判断；不要扩展到后续章节正文。',
        '掌握价值分衡量继续读这一章能获得的概念、结构和风险收益，不是文学质量、文笔好坏或个人喜好评分。',
        'recommendation 只能是 deep_read、quick_read 或 skip_read。',
        'questionsForAuthor 是给读者带着阅读的追问问题；追问问题只给问题，不要给答案，不要模拟作者对话。',
        '必须只输出 JSON，不要输出 Markdown、解释文字或代码块。',
        'JSON 字段必须包含 recommendation, masteryScore, nextMustKnow, reasons, keyPassages, questionsForAuthor, readerPerspective, readingAdvice。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify(buildStrategyInput({ snapshot, signalPanel }))
    }
  ];
}

function buildStrategyInput({
  snapshot,
  signalPanel
}) {
  const capture = buildCaptureInput(snapshot, signalPanel);

  return {
    promptVersion: PROMPT_VERSION,
    task: '判断当前章节接下来最需要掌握什么，并给出精读、快读或跳读建议。',
    chapter: {
      bookId: signalPanel.debug?.resolvedBookId || snapshot.bookId,
      rawBookId: snapshot.bookId,
      bookTitle: snapshot.bookTitle,
      chapterUid: signalPanel.chapter?.chapterUid || snapshot.chapterUid,
      chapterTitle: snapshot.chapterTitle || signalPanel.chapter?.title,
      chapterIdx: signalPanel.chapter?.chapterIdx,
      expectedWordCount: capture.expectedWordCount,
      capture,
      chapterText: snapshot.chapterText || ''
    },
    signals: {
      bookContext: signalPanel.bookContext || {},
      publicSignals: signalPanel.publicSignals || {
        bestBookmarks: signalPanel.bestBookmarks || [],
        bookmarkReviews: signalPanel.bookmarkReviews || [],
        bookReviews: signalPanel.bookReviews || []
      },
      personalSignals: signalPanel.personalSignals || {
        enabled: false,
        bookmarks: [],
        reviews: [],
        underlines: []
      }
    },
    outputShape: {
      recommendation: 'deep_read | quick_read | skip_read',
      masteryScore: {
        overall: '0-100 掌握价值分',
        informationDensity: '0-100 信息密度分',
        structuralImportance: '0-100 结构关键性分',
        skipRisk: '0-100 可跳读风险分'
      },
      nextMustKnow: ['接下来最需要掌握的概念、区分或结构'],
      reasons: ['2-3 条只基于当前章节与信号的判断依据'],
      keyPassages: ['3-5 条热门划线或已采集正文片段'],
      questionsForAuthor: ['带着阅读的问题，不要给答案'],
      readerPerspective: '评论中的共识、争议、误读或补充',
      readingAdvice: '接下来精读、快读或跳读的具体方式'
    }
  };
}

function buildCaptureInput(snapshot, signalPanel) {
  const expectedWordCount = numberOrNull(signalPanel.chapter?.wordCount);
  const chapterText = snapshot.chapterText || '';
  const capturedTextLength = chapterText.length;
  const coverageRatio = expectedWordCount ? capturedTextLength / expectedWordCount : null;
  const coveragePercent = coverageRatio === null ? null : Math.min(100, Math.round(coverageRatio * 100));
  const status = classifyCoverage(snapshot.captureMode, coverageRatio);

  return {
    mode: snapshot.captureMode || 'active-visible',
    stats: snapshot.captureStats || {},
    capturedTextLength,
    expectedWordCount,
    coverageRatio: formatRatio(coverageRatio),
    coveragePercent,
    status,
    coverage: {
      status,
      ratio: formatRatio(coverageRatio),
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

function parseReadingJudgement(raw) {
  const parsed = parseJsonObject(raw);
  const recommendation = normalizeRecommendation(parsed.recommendation || parsed.conclusion);

  return {
    recommendation,
    masteryScore: normalizeMasteryScore(parsed.masteryScore),
    nextMustKnow: normalizeStringArray(parsed.nextMustKnow, 5),
    reasons: normalizeStringArray(parsed.reasons, 3),
    keyPassages: normalizeStringArray(parsed.keyPassages, 5),
    questionsForAuthor: normalizeStringArray(parsed.questionsForAuthor, 5),
    readerPerspective: normalizeString(parsed.readerPerspective),
    readingAdvice: normalizeString(parsed.readingAdvice)
  };
}

function toLegacyJudgement(judgement) {
  const recommendation = normalizeRecommendation(judgement.recommendation);

  return {
    conclusion: LEGACY_CONCLUSIONS[recommendation],
    reasons: normalizeStringArray(judgement.reasons, 3),
    keyPassages: normalizeStringArray(judgement.keyPassages, 5),
    readerPerspective: normalizeString(judgement.readerPerspective),
    readingAction: normalizeString(judgement.readingAdvice)
  };
}

function classifyCoverage(mode, ratio) {
  if (mode === 'server-skill') return 'full';
  if (ratio !== null && ratio >= 0.9) return 'full';
  if (ratio !== null && ratio >= 0.6) return 'substantial';
  return 'partial';
}

function formatRatio(ratio) {
  return ratio === null ? null : Number(ratio.toFixed(3));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseJsonObject(raw) {
  if (raw && typeof raw === 'object') return raw;

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
  return RECOMMENDATIONS.has(value) ? value : 'quick_read';
}

function normalizeMasteryScore(value) {
  const score = value && typeof value === 'object' ? value : {};

  return {
    overall: clampScore(score.overall),
    informationDensity: clampScore(score.informationDensity),
    structuralImportance: clampScore(score.structuralImportance),
    skipRisk: clampScore(score.skipRisk)
  };
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeStringArray(value, limit) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim())
    .slice(0, limit);
}

function normalizeString(value) {
  return typeof value === 'string' ? value : '';
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
