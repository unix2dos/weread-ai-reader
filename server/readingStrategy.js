const PROMPT_VERSION = 'reading-strategy-v3';

const RECOMMENDATIONS = new Set(['must_deep_read', 'deep_read', 'quick_read', 'skip_read']);
const LEGACY_CONCLUSIONS = {
  must_deep_read: 'worth_deep_read',
  deep_read: 'worth_deep_read',
  quick_read: 'quick_read',
  skip_read: 'skip_read'
};
const MASTERY_SCORE_WEIGHTS = Object.freeze({
  takeawayValue: 0.45,
  understandingLeverage: 0.35,
  attentionROI: 0.2
});
const SCORE_THRESHOLDS = Object.freeze({
  mustDeepRead: 90,
  deepRead: 80,
  quickRead: 65
});
const MAX_OUTPUT_TOKENS = 900;
const SIGNAL_LIMITS = {
  bestBookmarks: 8,
  bookmarkReviews: 6,
  bookmarkReviewComments: 2,
  bookReviews: 2,
  personalItems: 6,
  personalReviews: 2,
  shortText: 180,
  reviewText: 240
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
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: 'json_object' },
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
        '你是微信读书实时跟读助手，只判断当前章节读完能带走什么可靠收获。',
        '只基于当前章节正文快照、采集覆盖率、当前章节相关的公开信号和个人信号判断；不要扩展到后续章节正文。',
        '优先使用公开阅读信号，其次参考书籍上下文，仅在存在个人信号时使用个人信号。',
        '收获价值分衡量读完这一章能带走的可靠收获、理解杠杆和投入回报，不是文学质量、文笔好坏、热度或个人喜好评分。',
        '收获价值总分由服务端按固定权重派生：可带走收获 45%，理解杠杆 35%，投入回报 20%；你只需要给三个维度分，overall 即使输出也会被忽略。',
        '热度不能直接抬高收获价值：热门划线只说明读者关注过；金句、共鸣、重复观点和泛泛赞同不自动构成高收获。',
        '只有清晰概念、方法、重要区分、因果链、反证、适用边界或后文枢纽，才应提高收获价值。',
        '严格使用精读门槛：90-100 必须精读，80-89 值得精读，65-79 快读为主，0-64 可跳读或只扫结论。',
        'recommendation 只能是 must_deep_read、deep_read、quick_read 或 skip_read。',
        '当 recommendation 是 quick_read（可快读）时，readingAdvice 可以写“局部精读”，但不能写成“必须精读”；“必须精读”只用于 must_deep_read。',
        'questionsForAuthor 是给读者带着读的问题；带着读的问题只给问题，不要给答案，不要模拟作者对话。',
        'questionsForAuthor 至少一个问题要验证核心收获；第二个问题可追问边界、前提、反证或常见误读。',
        '按二八原则输出：首屏只需要结论、收获价值总分、三个子分、最多三个收获点、最多两个带着读的问题和一句明确阅读动作。',
        'reasons、evidenceSnippets、readerPerspective 是折叠证据层，不要写成长解释。',
        '证据片段必须来自输入证据：热门划线、划线评论或当前章节正文快照；不要自由编造原文。',
        '所有 JSON 字段都必须有实际内容；没有评论信号时 readerPerspective 要说明“暂无足够公开评论信号”，不能留空。',
        '必须只输出 JSON，不要输出 Markdown、解释文字或代码块。',
        'JSON 字段必须包含 recommendation, masteryScore, nextMustKnow, reasons, evidenceSnippets, questionsForAuthor, readerPerspective, readingAdvice。'
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
  const signals = buildSignalsInput(signalPanel);

  return {
    promptVersion: PROMPT_VERSION,
    task: '判断当前章节读完能带走什么可靠收获，并给出精读、快读或跳读建议。',
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
    signals,
    scoreRubric: {
      masteryScoreOverall: '服务端按固定权重从三个收获价值子分派生，模型输出的 overall 会被忽略',
      weights: MASTERY_SCORE_WEIGHTS,
      thresholds: {
        mustDeepRead: '90-100 必须精读，本章是全书理解枢纽',
        deepRead: '80-89 值得精读，但必须说明具体价值来源',
        quickRead: '65-79 快读为主，只精读局部段落',
        skipRead: '0-64 可跳读或只扫结论'
      }
    },
    outputShape: {
      recommendation: 'must_deep_read | deep_read | quick_read | skip_read',
      masteryScore: {
        takeawayValue: '0-100 可带走收获分',
        understandingLeverage: '0-100 理解杠杆分',
        attentionROI: '0-100 投入回报分'
      },
      nextMustKnow: ['1-3 条读完本章能带走的概念、方法、判断框架、关键事实或可迁移理解'],
      reasons: ['1-2 条只基于当前章节与信号的判断依据'],
      evidenceSnippets: ['1-3 条可追溯证据片段；必须来自热门划线、划线评论或当前可见正文片段'],
      questionsForAuthor: ['1-2 个带着读的问题；至少一个验证核心收获，可有一个追问边界、前提、反证或常见误读；只给问题，不要给答案'],
      readerPerspective: '评论中的共识、争议、误读或补充；没有评论信号时说明暂无足够公开评论信号',
      readingAdvice: '一句明确阅读动作，60字内，直接说明精读、快读或跳读怎么做'
    }
  };
}

function buildSignalsInput(signalPanel) {
  return {
    bookContext: trimObjectStrings(signalPanel.bookContext || {}, SIGNAL_LIMITS.reviewText),
    publicSignals: buildPublicSignalsInput(signalPanel),
    personalSignals: buildPersonalSignalsInput(signalPanel.personalSignals)
  };
}

function buildPublicSignalsInput(signalPanel) {
  const publicSignals = signalPanel.publicSignals || {
    bestBookmarks: signalPanel.bestBookmarks || [],
    bookmarkReviews: signalPanel.bookmarkReviews || [],
    bookReviews: signalPanel.bookReviews || []
  };

  return {
    bestBookmarks: limitArray(publicSignals.bestBookmarks, SIGNAL_LIMITS.bestBookmarks, (item) => (
      trimObjectStrings(item, SIGNAL_LIMITS.shortText)
    )),
    bookmarkReviews: limitArray(publicSignals.bookmarkReviews, SIGNAL_LIMITS.bookmarkReviews, (item) => ({
      ...trimObjectStrings(item, SIGNAL_LIMITS.shortText),
      comments: normalizeBookmarkReviewComments(item?.comments, SIGNAL_LIMITS.bookmarkReviewComments)
    })),
    bookReviews: limitArray(publicSignals.bookReviews, SIGNAL_LIMITS.bookReviews, (item) => (
      trimObjectStrings(item, SIGNAL_LIMITS.reviewText)
    ))
  };
}

function buildPersonalSignalsInput(personalSignals = {}) {
  return {
    enabled: Boolean(personalSignals.enabled),
    bookmarks: limitArray(personalSignals.bookmarks, SIGNAL_LIMITS.personalItems, (item) => (
      trimObjectStrings(item, SIGNAL_LIMITS.shortText)
    )),
    reviews: limitArray(personalSignals.reviews, SIGNAL_LIMITS.personalReviews, (item) => (
      trimObjectStrings(item, SIGNAL_LIMITS.reviewText)
    )),
    underlines: limitArray(personalSignals.underlines, SIGNAL_LIMITS.personalItems, (item) => (
      trimObjectStrings(item, SIGNAL_LIMITS.shortText)
    ))
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

function buildEvidenceWarning({ snapshot, signalPanel }) {
  const capture = buildCaptureInput(snapshot, signalPanel);
  const publicSignals = signalPanel.publicSignals || {
    bestBookmarks: signalPanel.bestBookmarks || [],
    bookmarkReviews: signalPanel.bookmarkReviews || [],
    bookReviews: signalPanel.bookReviews || []
  };
  const bestBookmarkCount = (publicSignals.bestBookmarks || []).length;
  const commentCount = (publicSignals.bookmarkReviews || [])
    .reduce((sum, review) => sum + (review.comments || []).length, 0);
  const warnings = signalPanel.debug?.warnings || [];
  const reasons = [];

  if (capture.status === 'partial') reasons.push('正文覆盖偏低');
  if (!signalPanel.chapter?.chapterUid) reasons.push('章节定位不完整');
  if (bestBookmarkCount < 3) reasons.push('本章热门划线较少');
  if (commentCount < 2) reasons.push('划线评论较少');
  if (warnings.length > 0) reasons.push('Skill 信号有告警');

  return reasons.length
    ? `依据偏弱：${reasons.join('，')}，建议只把本判断当作读前预判。`
    : '';
}

function parseReadingJudgement(raw) {
  const parsed = parseJsonObject(raw);
  parseRecommendation(parsed.recommendation || parsed.conclusion);
  const masteryScore = normalizeMasteryScore(parsed.masteryScore);
  const recommendation = normalizeRecommendationForScore(masteryScore.overall);
  const judgement = {
    recommendation,
    masteryScore,
    nextMustKnow: normalizeStringArray(parsed.nextMustKnow, 3),
    reasons: normalizeStringArray(parsed.reasons, 2),
    evidenceSnippets: normalizeStringArray(parsed.evidenceSnippets || parsed.keyPassages, 3),
    questionsForAuthor: normalizeStringArray(parsed.questionsForAuthor, 2),
    readerPerspective: normalizeString(parsed.readerPerspective),
    readingAdvice: normalizeReadingAdviceForRecommendation(normalizeString(parsed.readingAdvice), recommendation)
  };

  assertCompleteJudgement(parsed, judgement);
  return judgement;
}

function toLegacyJudgement(judgement) {
  const recommendation = normalizeRecommendation(judgement.recommendation);

  return {
    conclusion: LEGACY_CONCLUSIONS[recommendation],
    reasons: normalizeStringArray(judgement.reasons, 2),
    keyPassages: normalizeStringArray(judgement.evidenceSnippets || judgement.keyPassages, 3),
    readerPerspective: normalizeString(judgement.readerPerspective),
    readingAction: normalizeString(judgement.readingAdvice)
  };
}

function toCompatibleReadingJudgement(judgement) {
  const masteryScore = judgement.masteryScore || {};
  const evidenceSnippets = normalizeStringArray(judgement.evidenceSnippets || judgement.keyPassages, 3);
  const readingAdvice = normalizeString(judgement.readingAdvice || judgement.readingAction);
  const recommendation = normalizeRecommendation(judgement.recommendation || judgement.conclusion);

  return {
    ...judgement,
    recommendation,
    masteryScore: {
      ...masteryScore,
      contentGain: readScoreDimension(masteryScore, 'takeawayValue', 'contentGain', 'informationDensity'),
      structuralImportance: readScoreDimension(masteryScore, 'understandingLeverage', 'structuralImportance'),
      deepReadNecessity: readScoreDimension(masteryScore, 'attentionROI', 'deepReadNecessity', 'skipRisk')
    },
    evidenceSnippets,
    keyPassages: evidenceSnippets,
    readingAdvice,
    readingAction: readingAdvice,
    conclusion: LEGACY_CONCLUSIONS[recommendation]
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
    throw new Error('Invalid reading judgement JSON');
  }
}

function parseRecommendation(value) {
  if (!value) {
    throw new Error('Missing reading judgement recommendation');
  }
  if (value === 'worth_deep_read') return 'deep_read';
  if (RECOMMENDATIONS.has(value)) return value;
  throw new Error(`Invalid reading judgement recommendation: ${value}`);
}

function normalizeRecommendation(value) {
  if (value === 'worth_deep_read') return 'deep_read';
  return RECOMMENDATIONS.has(value) ? value : 'quick_read';
}

function normalizeRecommendationForScore(overallScore) {
  if (overallScore >= SCORE_THRESHOLDS.mustDeepRead) return 'must_deep_read';
  if (overallScore >= SCORE_THRESHOLDS.deepRead) return 'deep_read';
  if (overallScore >= SCORE_THRESHOLDS.quickRead) return 'quick_read';
  return 'skip_read';
}

function normalizeMasteryScore(value) {
  const score = value && typeof value === 'object' ? value : {};
  const dimensionScores = {
    takeawayValue: clampScore(readScoreDimension(score, 'takeawayValue', 'contentGain', 'informationDensity')),
    understandingLeverage: clampScore(readScoreDimension(score, 'understandingLeverage', 'structuralImportance')),
    attentionROI: clampScore(readScoreDimension(score, 'attentionROI', 'deepReadNecessity', 'skipRisk'))
  };

  return {
    overall: calculateMasteryScore(dimensionScores),
    ...dimensionScores
  };
}

function calculateMasteryScore(score) {
  const dimensionScores = {
    takeawayValue: readScoreDimension(score, 'takeawayValue', 'contentGain', 'informationDensity'),
    understandingLeverage: readScoreDimension(score, 'understandingLeverage', 'structuralImportance'),
    attentionROI: readScoreDimension(score, 'attentionROI', 'deepReadNecessity', 'skipRisk')
  };

  return clampScore(
    (Number(dimensionScores.takeawayValue) * MASTERY_SCORE_WEIGHTS.takeawayValue)
    + (Number(dimensionScores.understandingLeverage) * MASTERY_SCORE_WEIGHTS.understandingLeverage)
    + (Number(dimensionScores.attentionROI) * MASTERY_SCORE_WEIGHTS.attentionROI)
  );
}

function assertCompleteJudgement(parsed, judgement) {
  assertScoreField(parsed.masteryScore, 'takeawayValue', 'contentGain', 'informationDensity');
  assertScoreField(parsed.masteryScore, 'understandingLeverage', 'structuralImportance');
  assertScoreField(parsed.masteryScore, 'attentionROI', 'deepReadNecessity', 'skipRisk');

  assertNonEmptyArray(judgement.nextMustKnow, 'nextMustKnow');
  assertNonEmptyArray(judgement.reasons, 'reasons');
  assertNonEmptyArray(judgement.evidenceSnippets, 'evidenceSnippets');
  assertNonEmptyArray(judgement.questionsForAuthor, 'questionsForAuthor');
  assertNonEmptyString(judgement.readerPerspective, 'readerPerspective');
  assertNonEmptyString(judgement.readingAdvice, 'readingAdvice');
}

function assertScoreField(score, field, ...legacyFields) {
  if (!score || typeof score !== 'object' || !hasFiniteScore(readScoreDimension(score, field, ...legacyFields))) {
    throw new Error(`Missing reading judgement field: masteryScore.${field}`);
  }
}

function readScoreDimension(score, field, ...legacyFields) {
  if (!score || typeof score !== 'object') return undefined;
  if (hasFiniteScore(score[field])) return score[field];
  for (const legacyField of legacyFields) {
    if (hasFiniteScore(score[legacyField])) return score[legacyField];
  }
  return undefined;
}

function normalizeReadingAdviceForRecommendation(readingAdvice, recommendation) {
  if (recommendation === 'quick_read') {
    return readingAdvice.replaceAll('必须精读', '局部精读');
  }
  return readingAdvice;
}

function assertNonEmptyArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Missing reading judgement field: ${field}`);
  }
}

function assertNonEmptyString(value, field) {
  if (!value || !value.trim()) {
    throw new Error(`Missing reading judgement field: ${field}`);
  }
}

function hasFiniteScore(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

function limitArray(value, limit, mapper) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map(mapper);
}

function trimObjectStrings(value, maxLength) {
  if (Array.isArray(value)) {
    return value.map((item) => trimObjectStrings(item, maxLength));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, trimObjectStrings(item, maxLength)])
    );
  }
  return typeof value === 'string' ? truncateText(value, maxLength) : value;
}

function truncateText(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
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

function normalizeBookmarkReviewComments(value, limit) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return { content: item.trim() };
      }
      if (!item || typeof item !== 'object') {
        return { content: '' };
      }
      const comment = {
        content: String(item.content || item.text || item.review || '').trim()
      };
      const likeCount = optionalNumberFromFields(item, ['likeCount', 'likesCount']);
      if (likeCount !== undefined) comment.likeCount = likeCount;
      return comment;
    })
    .filter((item) => item.content)
    .slice(0, limit)
    .map((item) => ({
      content: truncateText(item.content, SIGNAL_LIMITS.shortText),
      ...(item.likeCount !== undefined ? { likeCount: item.likeCount } : {})
    }));
}

function optionalNumberFromFields(source, fields) {
  if (!source || typeof source !== 'object') return undefined;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = source[field];
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return undefined;
}

function normalizeString(value) {
  return typeof value === 'string' ? value : '';
}

module.exports = {
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
};
