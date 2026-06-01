const BOOKMARK_REVIEW_COMMENT_FETCH_COUNT = 20;
const BOOKMARK_REVIEW_COMMENT_DISPLAY_COUNT = 3;
const BOOKMARK_REVIEW_DETAIL_FETCH_LIMIT = 20;
const BOOKMARK_REVIEW_DETAIL_LIKES_COUNT = 1;

async function buildSignalPanel(wereadClient, snapshot, options = {}) {
  const logger = options.logger || console;
  const enablePersonalSignals = options.enablePersonalSignals === true;
  const skillCalls = [];
  const warnings = [];
  let resolution = null;
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
      resolution = {
        from: skillBookId,
        to: resolvedBookId,
        method: 'title_search'
      };
      logger.info('book_id_resolved_by_title', {
        rawBookId: skillBookId,
        resolvedBookId,
        bookTitle: snapshot.bookTitle
      });
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

  const bookInfoResp = await callSkill(wereadClient, skillCalls, '/book/info', {
    bookId: skillBookId
  }).catch((err) => {
    warnings.push(`书籍信息获取失败: ${err.message}`);
    return {};
  });

  const readingProgressResp = await callSkill(wereadClient, skillCalls, '/book/getprogress', {
    bookId: skillBookId
  }).catch((err) => {
    warnings.push(`阅读进度获取失败: ${err.message}`);
    return {};
  });

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
        count: BOOKMARK_REVIEW_COMMENT_FETCH_COUNT
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

  const bookReviews = normalizeBookReviews(bookReviewsResp.reviews || []);
  const bookmarkReviewDetails = await buildBookmarkReviewDetails(
    wereadClient,
    skillCalls,
    warnings,
    bookmarkReviewsResp.reviews || []
  );
  const bookmarkReviews = normalizeBookmarkReviews(bookmarkReviewsResp.reviews || [], bookmarkReviewDetails.likeCounts);
  const personalSignals = enablePersonalSignals
    ? await buildPersonalSignals(wereadClient, skillCalls, warnings, {
      bookId: skillBookId,
      chapterUid,
      shouldFetchUnderlines: Boolean(chapterUid) && bestBookmarks.length < 3
    })
    : {
      enabled: false,
      bookmarks: [],
      reviews: [],
      underlines: []
    };
  const signalPanel = {
    chapter: {
      chapterUid,
      title: chapter.title || snapshot.chapterTitle,
      chapterIdx: numberOrNull(chapter.chapterIdx),
      wordCount: numberOrNull(chapter.wordCount)
    },
    bookContext: {
      bookInfo: normalizeBookInfo(bookInfoResp),
      readingProgress: normalizeReadingProgress(readingProgressResp)
    },
    publicSignals: {
      bookReviews,
      bestBookmarks,
      bookmarkReviews
    },
    personalSignals,
    bookReviews,
    bestBookmarks,
    bookmarkReviews,
    debug: {
      skillCalls,
      rawBookId: snapshot.bookId,
      resolvedBookId: skillBookId,
      resolution,
      bookmarkReviewDetails: bookmarkReviewDetails.debug,
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
    personalSignalsEnabled: signalPanel.personalSignals.enabled,
    warnings
  });

  return signalPanel;
}

async function buildPersonalSignals(wereadClient, skillCalls, warnings, context) {
  const bookmarksResp = await callSkill(wereadClient, skillCalls, '/book/bookmarklist', {
    bookId: context.bookId
  }).catch((err) => {
    warnings.push(`个人书签获取失败: ${err.message}`);
    return { bookmarks: [] };
  });

  const reviewsResp = await callSkill(wereadClient, skillCalls, '/review/list/mine', {
    bookid: context.bookId,
    count: 20
  }).catch((err) => {
    warnings.push(`个人评论获取失败: ${err.message}`);
    return { reviews: [] };
  });

  const underlinesResp = context.shouldFetchUnderlines
    ? await callSkill(wereadClient, skillCalls, '/book/underlines', {
      bookId: context.bookId,
      chapterUid: context.chapterUid,
      synckey: 0
    }).catch((err) => {
      warnings.push(`个人划线获取失败: ${err.message}`);
      return { items: [] };
    })
    : { items: [] };

  return {
    enabled: true,
    bookmarks: normalizePersonalBookmarks(extractArray(bookmarksResp, ['bookmarks', 'items'])),
    reviews: normalizePersonalReviews(extractArray(reviewsResp, ['reviews', 'items'])),
    underlines: normalizePersonalUnderlines(extractArray(underlinesResp, ['items', 'underlines']))
  };
}

async function callSkill(wereadClient, skillCalls, apiName, params) {
  skillCalls.push(apiName);
  return wereadClient.call(apiName, params);
}

async function buildBookmarkReviewDetails(wereadClient, skillCalls, warnings, reviews) {
  const candidates = collectBookmarkReviewDetailCandidates(reviews, BOOKMARK_REVIEW_DETAIL_FETCH_LIMIT);
  const directCount = countBookmarkReviewDirectLikeCounts(reviews);
  const likeCounts = new Map();
  let requestCount = 0;

  if (directCount > 0) {
    return {
      likeCounts,
      debug: {
        candidateCount: countBookmarkReviewDetailCandidates(reviews),
        requestCount,
        directCount,
        enrichedCount: 0,
        fetchLimit: BOOKMARK_REVIEW_DETAIL_FETCH_LIMIT
      }
    };
  }

  for (const candidate of candidates) {
    requestCount += 1;
    const detail = await callSkill(wereadClient, skillCalls, '/review/single', {
      reviewId: candidate.reviewId,
      commentsCount: 0,
      likesCount: BOOKMARK_REVIEW_DETAIL_LIKES_COUNT,
      likesDirection: 0
    }).catch((err) => {
      warnings.push(`划线评论点赞详情获取失败(${candidate.reviewId}): ${err.message}`);
      return null;
    });
    const likeCount = extractReviewDetailLikeCount(detail);
    if (likeCount !== undefined) likeCounts.set(candidate.reviewId, likeCount);
  }

  if (directCount === 0 && requestCount > 0 && likeCounts.size === 0) {
    warnings.push('划线评论点赞详情未返回可识别的点赞数字段。');
  }

  return {
    likeCounts,
    debug: {
      candidateCount: countBookmarkReviewDetailCandidates(reviews),
      requestCount,
      directCount,
      enrichedCount: likeCounts.size,
      fetchLimit: BOOKMARK_REVIEW_DETAIL_FETCH_LIMIT
    }
  };
}

function collectBookmarkReviewDetailCandidates(reviews, limit) {
  const queues = (reviews || []).map((item) => (item.pageReviews || [])
    .map((pageReview) => {
      const source = extractPageReviewSource(pageReview);
      const reviewId = extractPageReviewId(pageReview, source);
      if (!reviewId) return null;
      if (extractPageReviewLikeCount(pageReview, source) !== undefined) return null;
      return { reviewId };
    })
    .filter(Boolean));
  const selected = [];
  const seen = new Set();

  while (selected.length < limit) {
    let picked = false;
    for (const queue of queues) {
      let candidate = queue.shift();
      while (candidate && seen.has(candidate.reviewId)) {
        candidate = queue.shift();
      }
      if (!candidate) continue;
      seen.add(candidate.reviewId);
      selected.push(candidate);
      picked = true;
      if (selected.length >= limit) break;
    }
    if (!picked) break;
  }

  return selected;
}

function countBookmarkReviewDetailCandidates(reviews) {
  const seen = new Set();
  for (const item of reviews || []) {
    for (const pageReview of item.pageReviews || []) {
      const source = extractPageReviewSource(pageReview);
      const reviewId = extractPageReviewId(pageReview, source);
      if (!reviewId) continue;
      if (extractPageReviewLikeCount(pageReview, source) !== undefined) continue;
      seen.add(reviewId);
    }
  }
  return seen.size;
}

function countBookmarkReviewDirectLikeCounts(reviews) {
  let count = 0;
  for (const item of reviews || []) {
    for (const pageReview of item.pageReviews || []) {
      const source = extractPageReviewSource(pageReview);
      if (extractPageReviewLikeCount(pageReview, source) !== undefined) count += 1;
    }
  }
  return count;
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

function normalizeBookInfo(resp) {
  if (!resp || typeof resp !== 'object') return {};
  if (Object.keys(resp).length === 0) return {};
  return {
    bookId: stringOrNull(resp.bookId),
    title: stringOrNull(resp.title),
    author: stringOrNull(resp.author),
    intro: stringOrNull(resp.intro),
    category: stringOrNull(resp.category),
    newRating: numberOrNull(resp.newRating),
    newRatingCount: numberOrNull(resp.newRatingCount)
  };
}

function normalizeReadingProgress(resp) {
  const book = resp && typeof resp === 'object' && resp.book && typeof resp.book === 'object'
    ? resp.book
    : {};
  return {
    bookId: stringOrNull(resp && resp.bookId),
    chapterUid: numberOrNull(book.chapterUid),
    chapterOffset: numberOrNull(book.chapterOffset),
    progress: numberOrNull(book.progress),
    recordReadingTime: numberOrNull(book.recordReadingTime),
    timestamp: numberOrNull(resp && resp.timestamp)
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

function normalizeBookmarkReviews(reviews, detailLikeCounts = new Map()) {
  return reviews.map((item) => ({
    range: String(item.range || ''),
    totalCount: Number(item.totalCount || 0),
    comments: normalizeBookmarkReviewComments(item.pageReviews || [], detailLikeCounts)
  })).filter((item) => item.range);
}

function normalizeBookmarkReviewComments(pageReviews, detailLikeCounts) {
  return pageReviews
    .map((pageReview, index) => {
      const source = extractPageReviewSource(pageReview);
      const comment = {
        content: String(source.content || ''),
        index
      };
      const reviewId = extractPageReviewId(pageReview, source);
      const likeCount = extractPageReviewLikeCount(pageReview, source)
        ?? lookupLikeCount(detailLikeCounts, reviewId);
      if (likeCount !== undefined) comment.likeCount = likeCount;
      return comment;
    })
    .filter((item) => item.content)
    .sort((a, b) => comparableLikeCount(b) - comparableLikeCount(a) || a.index - b.index)
    .slice(0, BOOKMARK_REVIEW_COMMENT_DISPLAY_COUNT)
    .map(({ content, likeCount }) => {
      const comment = { content };
      if (likeCount !== undefined) comment.likeCount = likeCount;
      return comment;
    });
}

function normalizeBookReviews(reviews) {
  return reviews.map((item) => {
    const review = item.review && (item.review.review || item.review);
    return withOptionalLikeCount({
      content: String((review && review.content) || '')
    }, review);
  }).filter((item) => item.content).slice(0, 8);
}

function normalizePersonalBookmarks(items) {
  return items.map((item) => ({
    chapterUid: numberOrNull(item.chapterUid),
    range: String(item.range || ''),
    markText: String(item.markText || item.text || item.content || ''),
    createTime: numberOrNull(item.createTime)
  })).filter((item) => item.markText || item.range).slice(0, 20);
}

function normalizePersonalReviews(items) {
  return items.map((item) => {
    const review = item.review && (item.review.review || item.review);
    const source = review || item;
    return withOptionalLikeCount({
      content: String(source.content || source.review || ''),
      chapterUid: numberOrNull(source.chapterUid || item.chapterUid)
    }, source);
  }).filter((item) => item.content).slice(0, 20);
}

function normalizePersonalUnderlines(items) {
  return items.map((item) => ({
    chapterUid: numberOrNull(item.chapterUid),
    range: String(item.range || ''),
    markText: String(item.markText || item.text || item.content || ''),
    colorStyle: numberOrNull(item.colorStyle)
  })).filter((item) => item.markText || item.range).slice(0, 20);
}

function extractArray(resp, keys) {
  if (!resp || typeof resp !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(resp[key])) return resp[key];
  }
  return [];
}

function stringOrNull(value) {
  return typeof value === 'string' && value ? value : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractPageReviewSource(pageReview) {
  if (!pageReview || typeof pageReview !== 'object') return {};
  if (!pageReview.review || typeof pageReview.review !== 'object') return pageReview;
  return pageReview.review.review || pageReview.review;
}

function extractPageReviewId(pageReview, source) {
  if (!pageReview || typeof pageReview !== 'object') return null;
  return stringValueOrNull(
    source && source.reviewId,
    pageReview.reviewId,
    pageReview.review && pageReview.review.reviewId,
    pageReview.review && pageReview.review.review && pageReview.review.review.reviewId
  );
}

function extractPageReviewLikeCount(pageReview, source) {
  return optionalNumberFromFields(source, ['likeCount', 'likesCount'])
    ?? optionalNumberFromFields(pageReview, ['likeCount', 'likesCount']);
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

function extractReviewDetailLikeCount(resp) {
  if (!resp || typeof resp !== 'object') return undefined;
  const sources = [
    resp,
    resp.review,
    resp.review && resp.review.review,
    resp.data,
    resp.data && resp.data.review,
    resp.data && resp.data.review && resp.data.review.review
  ].filter((source) => source && typeof source === 'object');

  for (const source of sources) {
    const likeCount = optionalNumberFromFields(source, ['likeCount', 'likesCount', 'likeCnt', 'likesCnt']);
    if (likeCount !== undefined) return likeCount;
  }

  for (const source of sources) {
    for (const key of ['likes', 'likeInfo', 'likesInfo']) {
      const likeInfo = source[key];
      const likeCount = optionalNumberFromFields(likeInfo, ['totalCount', 'count', 'total']);
      if (likeCount !== undefined) return likeCount;
    }
  }

  return undefined;
}

function lookupLikeCount(detailLikeCounts, reviewId) {
  if (!reviewId || !detailLikeCounts || typeof detailLikeCounts.get !== 'function') return undefined;
  return detailLikeCounts.get(reviewId);
}

function stringValueOrNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function withOptionalLikeCount(item, source) {
  const likeCount = optionalNumberFromFields(source, ['likeCount', 'likesCount']);
  if (likeCount === undefined) return item;
  return { ...item, likeCount };
}

function comparableLikeCount(item) {
  return typeof item.likeCount === 'number' ? item.likeCount : -1;
}

module.exports = {
  buildSignalPanel
};
