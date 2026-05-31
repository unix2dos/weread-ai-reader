const crypto = require('node:crypto');
const express = require('express');

const PROMPT_VERSION = 'short-judgement-v1';

function createApp({ config, wereadClient, llmClient, logger = console }) {
  const app = express();
  const snapshots = new Map();
  const snapshotCache = new Map();
  const judgementCache = new Map();

  app.use(express.json({ limit: '2mb' }));
  app.use(corsMiddleware);

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/reading-snapshots', async (req, res) => {
    const snapshot = req.body || {};
    if (!isValidClientToken(config, snapshot.clientToken)) {
      res.status(401).json({
        error: { code: 'invalid_client_token', message: 'Invalid client token' }
      });
      return;
    }

    const validation = validateSnapshot(snapshot);
    if (!validation.valid) {
      res.status(400).json({
        error: { code: 'invalid_reading_snapshot', message: validation.message }
      });
      return;
    }

    const normalizedSnapshot = normalizeSnapshot(snapshot);
    const snapshotCacheKey = buildSnapshotCacheKey(normalizedSnapshot);
    const cachedSnapshotId = snapshotCache.get(snapshotCacheKey);
    if (cachedSnapshotId && snapshots.has(cachedSnapshotId)) {
      const cached = snapshots.get(cachedSnapshotId);
      logger.info('reading_snapshot_cache_hit', buildSnapshotLog(cached.snapshot, cached.signalPanel, { snapshotId: cachedSnapshotId }));
      res.json(buildSnapshotResponse(cachedSnapshotId, cached, { hit: true }, llmClient));
      return;
    }

    const snapshotId = createSnapshotId();

    try {
      const signalPanel = await buildSignalPanel(wereadClient, normalizedSnapshot, logger);
      const skillSignalVersion = hashJson(signalPanel);
      const record = {
        snapshot: normalizedSnapshot,
        signalPanel,
        skillSignalVersion,
        promptVersion: PROMPT_VERSION
      };
      snapshots.set(snapshotId, record);
      snapshotCache.set(snapshotCacheKey, snapshotId);

      logger.info('reading_snapshot_received', buildSnapshotLog(normalizedSnapshot, signalPanel, { snapshotId }));

      res.json(buildSnapshotResponse(snapshotId, record, { hit: false }, llmClient));
    } catch (err) {
      logger.error('reading_snapshot_failed', { snapshotId, message: err.message });
      res.status(502).json({
        error: { code: 'skill_signal_failed', message: err.message }
      });
    }
  });

  app.get('/api/reading-snapshots/:snapshotId/judgement/stream', async (req, res) => {
    if (!isValidClientToken(config, req.query.clientToken)) {
      res.status(401).json({
        error: { code: 'invalid_client_token', message: 'Invalid client token' }
      });
      return;
    }

    const record = snapshots.get(req.params.snapshotId);
    if (!record) {
      res.status(404).json({
        error: { code: 'snapshot_not_found', message: 'Snapshot not found' }
      });
      return;
    }

    setSseHeaders(res);
    writeSse(res, 'start', { snapshotId: req.params.snapshotId });

    const judgementCacheKey = buildJudgementCacheKey(record);
    const cachedJudgement = judgementCache.get(judgementCacheKey);
    if (cachedJudgement) {
      writeSse(res, 'complete', { judgement: cachedJudgement });
      res.end();
      return;
    }

    try {
      logger.info('judgement_stream_start', {
        snapshotId: req.params.snapshotId,
        promptVersion: record.promptVersion,
        input: buildLlmInputLog(record)
      });

      let completedJudgement = null;
      for await (const event of llmClient.streamShortJudgement({
        snapshot: record.snapshot,
        signalPanel: record.signalPanel,
        promptVersion: record.promptVersion
      })) {
        if (event.type === 'delta') {
          writeSse(res, 'delta', { field: event.field, text: event.text });
        } else if (event.type === 'complete') {
          completedJudgement = event.judgement;
          writeSse(res, 'complete', { judgement: event.judgement });
        }
      }

      if (completedJudgement) {
        judgementCache.set(judgementCacheKey, completedJudgement);
      }
      res.end();
    } catch (err) {
      logger.error('judgement_stream_failed', {
        snapshotId: req.params.snapshotId,
        message: err.message
      });
      writeSse(res, 'error', {
        code: 'judgement_stream_failed',
        message: err.message
      });
      res.end();
    }
  });

  return app;
}

function corsMiddleware(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

function isValidClientToken(config, token) {
  return Boolean(config.clientToken && token && token === config.clientToken);
}

function validateSnapshot(snapshot) {
  const required = [
    'clientToken',
    'requestId',
    'bookId',
    'bookTitle',
    'chapterTitle',
    'url',
    'chapterText',
    'contentHash',
    'capturedAt',
    'source'
  ];

  for (const field of required) {
    if (!snapshot[field] || typeof snapshot[field] !== 'string') {
      return { valid: false, message: `Missing or invalid field: ${field}` };
    }
  }

  if (snapshot.chapterUid !== null && snapshot.chapterUid !== undefined && typeof snapshot.chapterUid !== 'number') {
    return { valid: false, message: 'Missing or invalid field: chapterUid' };
  }

  return { valid: true };
}

function normalizeSnapshot(snapshot) {
  return {
    clientToken: snapshot.clientToken,
    requestId: snapshot.requestId,
    bookId: snapshot.bookId,
    bookTitle: snapshot.bookTitle,
    chapterUid: snapshot.chapterUid || null,
    chapterTitle: snapshot.chapterTitle,
    url: snapshot.url,
    chapterText: snapshot.chapterText,
    contentHash: snapshot.contentHash,
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
    captureMode: typeof snapshot.captureMode === 'string' ? snapshot.captureMode : 'active-visible',
    captureStats: normalizeCaptureStats(snapshot.captureStats)
  };
}

function normalizeCaptureStats(stats) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    return {};
  }

  return {
    visibleTextLength: numberOrNull(stats.visibleTextLength),
    accumulatedTextLength: numberOrNull(stats.accumulatedTextLength),
    segmentCount: numberOrNull(stats.segmentCount),
    uniqueLineCount: numberOrNull(stats.uniqueLineCount),
    addedLineCount: numberOrNull(stats.addedLineCount),
    startedAt: typeof stats.startedAt === 'string' ? stats.startedAt : null,
    updatedAt: typeof stats.updatedAt === 'string' ? stats.updatedAt : null
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function buildSignalPanel(wereadClient, snapshot, logger) {
  const skillCalls = [];
  const warnings = [];
  let skillBookId = snapshot.bookId;
  let chaptersResp = await callSkill(wereadClient, skillCalls, '/book/chapterinfo', {
    bookId: skillBookId
  }).catch((err) => {
    warnings.push(`章节目录获取失败: ${err.message}`);
    return { chapters: [] };
  });

  if ((!chaptersResp.chapters || chaptersResp.chapters.length === 0) && snapshot.bookTitle) {
    const resolvedBookId = await resolveBookIdByTitle(wereadClient, skillCalls, snapshot.bookTitle).catch((err) => {
      warnings.push(`通过书名解析 bookId 失败: ${err.message}`);
      return null;
    });
    if (resolvedBookId && resolvedBookId !== skillBookId) {
      warnings.push(`已通过书名将 reader id 解析为官方 bookId: ${skillBookId} -> ${resolvedBookId}`);
      skillBookId = resolvedBookId;
      chaptersResp = await callSkill(wereadClient, skillCalls, '/book/chapterinfo', {
        bookId: skillBookId
      }).catch((err) => {
        warnings.push(`官方 bookId 章节目录获取失败: ${err.message}`);
        return { chapters: [] };
      });
    }
  }

  const chapter = resolveChapter(snapshot, chaptersResp.chapters || [], warnings);
  const chapterUid = chapter.chapterUid;

  const bestBookmarksResp = await callSkill(wereadClient, skillCalls, '/book/bestbookmarks', {
    bookId: skillBookId,
    chapterUid: chapterUid || 0
  }).catch((err) => {
    warnings.push(`热门划线获取失败: ${err.message}`);
    return { items: [] };
  });

  const bestBookmarks = normalizeBestBookmarks(bestBookmarksResp.items || [], chapterUid);
  const bookmarkReviewsResp = bestBookmarks.length > 0 && chapterUid
    ? await callSkill(wereadClient, skillCalls, '/book/readreviews', {
      bookId: skillBookId,
      chapterUid,
      reviews: bestBookmarks.slice(0, 8).map((bookmark) => ({
        range: bookmark.range,
        maxIdx: 0,
        count: 5
      }))
    }).catch((err) => {
      warnings.push(`划线评论获取失败: ${err.message}`);
      return { reviews: [] };
    })
    : { reviews: [] };

  const bookReviewsResp = await callSkill(wereadClient, skillCalls, '/review/list', {
    bookId: skillBookId,
    reviewListType: 0,
    count: 8
  }).catch((err) => {
    warnings.push(`整本书评价获取失败: ${err.message}`);
    return { reviews: [] };
  });

  const signalPanel = {
    chapter: {
      chapterUid,
      title: chapter.title || snapshot.chapterTitle,
      chapterIdx: numberOrNull(chapter.chapterIdx),
      wordCount: numberOrNull(chapter.wordCount)
    },
    bookReviews: normalizeBookReviews(bookReviewsResp.reviews || []),
    bestBookmarks,
    bookmarkReviews: normalizeBookmarkReviews(bookmarkReviewsResp.reviews || []),
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

function setSseHeaders(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
}

function writeSse(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createSnapshotId() {
  return `snap_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function buildSnapshotCacheKey(snapshot) {
  return [
    snapshot.bookId,
    snapshot.chapterUid || snapshot.chapterTitle,
    snapshot.contentHash
  ].join(':');
}

function buildJudgementCacheKey(record) {
  return [
    record.snapshot.bookId,
    record.snapshot.chapterUid || record.snapshot.chapterTitle,
    record.snapshot.contentHash,
    record.skillSignalVersion,
    record.promptVersion
  ].join(':');
}

function buildSnapshotResponse(snapshotId, record, cache, llmClient) {
  return {
    snapshotId,
    cache,
    signalPanel: record.signalPanel,
    agentRequest: buildAgentRequestDebug(llmClient, record)
  };
}

function buildAgentRequestDebug(llmClient, record) {
  if (typeof llmClient.buildRequestDebug !== 'function') {
    return {
      promptVersion: record.promptVersion,
      input: buildLlmInputLog(record),
      note: 'llmClient 未暴露完整请求调试接口。'
    };
  }

  try {
    return llmClient.buildRequestDebug({
      snapshot: record.snapshot,
      signalPanel: record.signalPanel,
      promptVersion: record.promptVersion
    });
  } catch (err) {
    return {
      promptVersion: record.promptVersion,
      input: buildLlmInputLog(record),
      error: err.message,
      note: '完整请求调试生成失败，已退回摘要输入。'
    };
  }
}

function hashJson(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function buildSnapshotLog(snapshot, signalPanel, extra = {}) {
  return {
    ...extra,
    requestId: snapshot.requestId,
    bookId: snapshot.bookId,
    resolvedBookId: signalPanel && signalPanel.debug ? signalPanel.debug.resolvedBookId : snapshot.bookId,
    bookTitle: snapshot.bookTitle,
    chapterUid: signalPanel && signalPanel.chapter ? signalPanel.chapter.chapterUid : snapshot.chapterUid,
    chapterTitle: snapshot.chapterTitle,
    source: snapshot.source,
    contentHash: snapshot.contentHash,
    chapterTextLength: snapshot.chapterText.length,
    chapterTextPreview: previewText(snapshot.chapterText),
    capturedAt: snapshot.capturedAt,
    captureMode: snapshot.captureMode,
    captureStats: snapshot.captureStats,
    signalCounts: signalPanel ? {
      bookReviews: signalPanel.bookReviews.length,
      bestBookmarks: signalPanel.bestBookmarks.length,
      bookmarkReviews: signalPanel.bookmarkReviews.length
    } : undefined
  };
}

function buildLlmInputLog(record) {
  return {
    bookId: record.snapshot.bookId,
    resolvedBookId: record.signalPanel.debug?.resolvedBookId || record.snapshot.bookId,
    bookTitle: record.snapshot.bookTitle,
    chapterTitle: record.snapshot.chapterTitle,
    source: record.snapshot.source,
    captureMode: record.snapshot.captureMode,
    captureStats: record.snapshot.captureStats,
    chapterTextLength: record.snapshot.chapterText.length,
    expectedChapterWordCount: record.signalPanel.chapter.wordCount || null,
    chapterTextPreview: previewText(record.snapshot.chapterText),
    contentHash: record.snapshot.contentHash,
    signalCounts: {
      bookReviews: record.signalPanel.bookReviews.length,
      bestBookmarks: record.signalPanel.bestBookmarks.length,
      bookmarkReviews: record.signalPanel.bookmarkReviews.length
    },
    promptVersion: record.promptVersion,
    estimatedInputTokens: estimateTokens([
      record.snapshot.chapterText,
      JSON.stringify(record.signalPanel)
    ].join('\n'))
  };
}

function previewText(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 80)} ... ${normalized.slice(-80)}`;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 3);
}

module.exports = {
  createApp,
  buildSignalPanel,
  writeSse
};
