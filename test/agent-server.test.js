const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { Readable } = require('node:stream');
const test = require('node:test');

const { createApp } = require('../server/createApp');
const { createLlmClient } = require('../server/llmClient');

function createSnapshot(overrides = {}) {
  return {
    clientToken: 'dev-token',
    requestId: 'req-1',
    bookId: 'book-1',
    bookTitle: '测试书',
    chapterUid: null,
    chapterTitle: '第一章',
    url: 'https://weread.qq.com/web/reader/book-1',
    chapterText: '这一章讨论了如何判断一章是否值得精读。',
    contentHash: 'hash-1',
    capturedAt: '2026-05-31T12:00:00.000Z',
    source: '#preRenderContent',
    ...overrides
  };
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function createStubWeReadClient(calls) {
  return {
    async call(apiName, params) {
      calls.push({ apiName, params });
      if (apiName === '/book/chapterinfo') {
        return {
          chapters: [
            { chapterUid: 101, title: '第一章', wordCount: 3200, chapterIdx: 1 }
          ]
        };
      }
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
      if (apiName === '/book/bestbookmarks') {
        return {
          items: [
            { range: '1-20', markText: '值得精读的关键段落', totalCount: 12, chapterUid: 101 }
          ]
        };
      }
      if (apiName === '/book/readreviews') {
        return {
          reviews: [
            {
              range: '1-20',
              totalCount: 2,
              pageReviews: [
                { review: { content: '这段是本章核心。' } },
                { review: { content: '这里和全书主题呼应。' } }
              ]
            }
          ]
        };
      }
      if (apiName === '/review/list') {
        return {
          reviews: [
            { review: { review: { content: '整本书评价不错。', likeCount: 4 } } }
          ]
        };
      }
      throw new Error(`Unexpected API: ${apiName}`);
    }
  };
}

function createOpenAiSseBody(contentDeltas) {
  return Readable.from([
    ...contentDeltas.map((content) => Buffer.from(`data: ${JSON.stringify({
      choices: [{ delta: { content } }]
    })}\n\n`)),
    Buffer.from('data: [DONE]\n\n')
  ]);
}

test('rejects snapshots with an invalid client token', async () => {
  const app = createApp({
    config: { clientToken: 'dev-token' },
    wereadClient: createStubWeReadClient([]),
    llmClient: { streamShortJudgement: async function* () {} },
    logger: { info() {}, warn() {}, error() {} }
  });

  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/reading-snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createSnapshot({ clientToken: 'bad-token' }))
    });

    assert.equal(resp.status, 401);
    assert.deepEqual(await resp.json(), {
      error: { code: 'invalid_client_token', message: 'Invalid client token' }
    });
  });
});

test('returns snapshot id and structured signal panel for a valid reading snapshot', async () => {
  const calls = [];
  const app = createApp({
    config: { clientToken: 'dev-token' },
    wereadClient: createStubWeReadClient(calls),
    llmClient: createLlmClient({
      apiKey: 'test-key',
      apiBase: 'https://llm.example/v1',
      model: 'deepseek-v4-flash',
      fetchImpl: async () => {
        throw new Error('fetch should not be called while storing a snapshot');
      }
    }),
    logger: { info() {}, warn() {}, error() {} }
  });

  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/reading-snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createSnapshot())
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();

    assert.match(body.snapshotId, /^snap_/);
    assert.equal(body.cache.hit, false);
    assert.equal(body.signalPanel.chapter.chapterUid, 101);
    assert.equal(body.signalPanel.chapter.wordCount, 3200);
    assert.equal(body.agentRequest.url, 'https://llm.example/v1/chat/completions');
    assert.equal(body.agentRequest.headers.Authorization, 'Bearer [hidden]');
    assert.equal(body.agentRequest.body.model, 'deepseek-v4-flash');
    const requestContent = JSON.parse(body.agentRequest.body.messages[1].content);
    assert.equal(requestContent.promptVersion, 'reading-strategy-v2');
    assert.equal(requestContent.outputShape.recommendation, 'deep_read | quick_read | skip_read');
    assert.equal(requestContent.outputShape.masteryScore.overall, '0-100 掌握价值分');
    assert.equal(requestContent.outputShape.questionsForAuthor[0], '带着阅读的问题，不要给答案');
    assert.match(body.agentRequest.body.messages[1].content, /这一章讨论了如何判断一章是否值得精读/);
    assert.doesNotMatch(JSON.stringify(body.agentRequest), /test-key|dev-token/);
    assert.equal(body.signalPanel.bestBookmarks[0].markText, '值得精读的关键段落');
    assert.deepEqual(body.signalPanel.bookmarkReviews[0].comments, [
      '这段是本章核心。',
      '这里和全书主题呼应。'
    ]);
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
    assert.equal(calls.find((call) => call.apiName === '/book/bestbookmarks').params.chapterUid, 101);
  });
});

test('llmClient streams reading advice deltas and completes with reading strategy judgement', async () => {
  const modelContent = JSON.stringify({
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
  });
  const client = createLlmClient({
    apiKey: 'test-key',
    apiBase: 'https://llm.example/v1',
    model: 'deepseek-v4-flash',
    fetchImpl: async () => ({
      ok: true,
      body: createOpenAiSseBody([
        modelContent.slice(0, 40),
        modelContent.slice(40, 120),
        modelContent.slice(120)
      ])
    })
  });

  const events = [];
  for await (const event of client.streamShortJudgement({
    snapshot: createSnapshot(),
    signalPanel: {
      chapter: { chapterUid: 101, wordCount: 3200 },
      bestBookmarks: [],
      bookmarkReviews: [],
      bookReviews: [],
      debug: { resolvedBookId: 'book-1' }
    },
    promptVersion: 'reading-strategy-v2'
  })) {
    events.push(event);
  }

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    type: 'delta',
    field: 'readingAdvice',
    text: '先精读定义段。'
  });
  assert.notEqual(events[0].text, modelContent);
  assert.doesNotMatch(events[0].text, /"recommendation"/);
  assert.equal(events[1].type, 'complete');
  assert.equal(events[1].readingJudgement.recommendation, 'deep_read');
  assert.equal(events[1].judgement.conclusion, 'worth_deep_read');
});

test('llmClient rejects invalid streamed JSON without yielding a validated advice delta', async () => {
  const client = createLlmClient({
    apiKey: 'test-key',
    apiBase: 'https://llm.example/v1',
    model: 'deepseek-v4-flash',
    fetchImpl: async () => ({
      ok: true,
      body: createOpenAiSseBody(['{"recommendation":"deep_read"', ' invalid'])
    })
  });

  const events = [];
  await assert.rejects(async () => {
    for await (const event of client.streamShortJudgement({
      snapshot: createSnapshot(),
      signalPanel: {
        chapter: { chapterUid: 101, wordCount: 3200 },
        bestBookmarks: [],
        bookmarkReviews: [],
        bookReviews: [],
        debug: { resolvedBookId: 'book-1' }
      },
      promptVersion: 'reading-strategy-v2'
    })) {
      events.push(event);
    }
  }, /Invalid reading judgement JSON/);

  assert.deepEqual(events, []);
});

test('includes passive capture metadata in the Agent request', async () => {
  const app = createApp({
    config: { clientToken: 'dev-token' },
    wereadClient: createStubWeReadClient([]),
    llmClient: createLlmClient({
      apiKey: 'test-key',
      apiBase: 'https://llm.example/v1',
      model: 'deepseek-v4-flash',
      fetchImpl: async () => {
        throw new Error('fetch should not be called while storing a snapshot');
      }
    }),
    logger: { info() {}, warn() {}, error() {} }
  });

  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/reading-snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createSnapshot({
        captureMode: 'passive-accumulated',
        captureStats: {
          visibleTextLength: 800,
          accumulatedTextLength: 1600,
          segmentCount: 2,
          uniqueLineCount: 8,
          addedLineCount: 3,
          startedAt: '2026-05-31T12:00:00.000Z',
          updatedAt: '2026-05-31T12:05:00.000Z'
        }
      }))
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    const userContent = JSON.parse(body.agentRequest.body.messages[1].content);
    assert.match(body.agentRequest.body.messages[0].content, /只基于当前章节正文快照、采集覆盖率/);
    assert.equal(userContent.chapter.capture.mode, 'passive-accumulated');
    assert.equal(userContent.chapter.capture.stats.segmentCount, 2);
    assert.equal(userContent.chapter.capture.status, 'partial');
    assert.equal(userContent.chapter.capture.coverage.status, 'partial');
    assert.equal(userContent.chapter.capture.coverage.percent, 1);
    assert.equal(userContent.chapter.capture.coveragePercent, 1);
    assert.equal(userContent.chapter.capture.instruction, 'Treat the chapter text as partial. Make a stage-aware judgement and do not imply the full chapter body was read.');
    assert.equal(userContent.chapter.expectedWordCount, 3200);
    assert.equal(userContent.chapter.capture.expectedWordCount, 3200);
  });
});

test('resolves long reader ids to official book ids before fetching skill signals', async () => {
  const calls = [];
  const wereadClient = {
    async call(apiName, params) {
      calls.push({ apiName, params });
      if (apiName === '/book/chapterinfo' && params.bookId === 'reader-long-id') {
        return { chapters: [] };
      }
      if (apiName === '/store/search') {
        assert.equal(params.keyword, '测试书');
        return {
          results: [
            { books: [{ bookInfo: { bookId: '3300060202', title: '测试书' } }] }
          ]
        };
      }
      if (apiName === '/book/chapterinfo' && params.bookId === '3300060202') {
        return { chapters: [{ chapterUid: 101, title: '第一章' }] };
      }
      if (apiName === '/book/info') return { bookId: params.bookId, title: '测试书' };
      if (apiName === '/book/getprogress') {
        return { bookId: params.bookId, book: { progress: 25 }, timestamp: 1780200000 };
      }
      if (apiName === '/book/bestbookmarks') return { items: [] };
      if (apiName === '/review/list') return { reviews: [] };
      throw new Error(`Unexpected API: ${apiName}`);
    }
  };
  const app = createApp({
    config: { clientToken: 'dev-token' },
    wereadClient,
    llmClient: { streamShortJudgement: async function* () {} },
    logger: { info() {}, warn() {}, error() {} }
  });

  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/reading-snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createSnapshot({ bookId: 'reader-long-id' }))
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.signalPanel.debug.rawBookId, 'reader-long-id');
    assert.equal(body.signalPanel.debug.resolvedBookId, '3300060202');
    assert.deepEqual(body.signalPanel.debug.resolution, {
      from: 'reader-long-id',
      to: '3300060202',
      method: 'title_search'
    });
    assert.doesNotMatch(body.signalPanel.debug.warnings.join('\n'), /已通过书名/);
    assert.equal(calls.find((call) => call.apiName === '/book/bestbookmarks').params.bookId, '3300060202');
    assert.deepEqual(calls.map((call) => call.apiName), [
      '/book/chapterinfo',
      '/store/search',
      '/book/chapterinfo',
      '/book/info',
      '/book/getprogress',
      '/book/bestbookmarks',
      '/review/list'
    ]);
  });
});

test('fetches personal signals when explicitly enabled', async () => {
  const calls = [];
  const app = createApp({
    config: { clientToken: 'dev-token', enablePersonalSignals: true },
    wereadClient: {
      async call(apiName, params) {
        calls.push({ apiName, params });
        if (apiName === '/book/chapterinfo') {
          return {
            chapters: [
              { chapterUid: 101, title: '第一章', wordCount: 3200, chapterIdx: 1 }
            ]
          };
        }
        if (apiName === '/book/info') return { bookId: params.bookId, title: '测试书' };
        if (apiName === '/book/getprogress') return { bookId: params.bookId, book: { progress: 25 } };
        if (apiName === '/book/bestbookmarks') {
          return {
            items: [
              { range: '1-20', markText: '公开热门划线', totalCount: 2, chapterUid: 101 }
            ]
          };
        }
        if (apiName === '/book/readreviews') return { reviews: [] };
        if (apiName === '/review/list') return { reviews: [] };
        if (apiName === '/book/bookmarklist') {
          return {
            bookmarks: [
              { chapterUid: 101, range: '3-8', markText: '我的书签', createTime: 1780200010 }
            ]
          };
        }
        if (apiName === '/review/list/mine') {
          assert.deepEqual(params, { bookid: 'book-1', count: 20 });
          return {
            reviews: [
              { review: { content: '我的短评', likeCount: 0, chapterUid: 101 } }
            ]
          };
        }
        if (apiName === '/book/underlines') {
          assert.deepEqual(params, { bookId: 'book-1', chapterUid: 101, synckey: 0 });
          return {
            items: [
              { chapterUid: 101, range: '9-18', markText: '我的划线', colorStyle: 2 }
            ]
          };
        }
        throw new Error(`Unexpected API: ${apiName}`);
      }
    },
    llmClient: { streamShortJudgement: async function* () {} },
    logger: { info() {}, warn() {}, error() {} }
  });

  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/reading-snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createSnapshot())
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.signalPanel.personalSignals.enabled, true);
    assert.equal(body.signalPanel.personalSignals.bookmarks[0].markText, '我的书签');
    assert.equal(body.signalPanel.personalSignals.reviews[0].content, '我的短评');
    assert.equal(body.signalPanel.personalSignals.underlines[0].markText, '我的划线');
    assert.deepEqual(calls.map((call) => call.apiName), [
      '/book/chapterinfo',
      '/book/info',
      '/book/getprogress',
      '/book/bestbookmarks',
      '/book/readreviews',
      '/review/list',
      '/book/bookmarklist',
      '/review/list/mine',
      '/book/underlines'
    ]);
  });
});

test('keeps snapshot upload successful when personal signal calls fail', async () => {
  const app = createApp({
    config: { clientToken: 'dev-token', enablePersonalSignals: true },
    wereadClient: {
      async call(apiName, params) {
        if (apiName === '/book/chapterinfo') {
          return {
            chapters: [
              { chapterUid: 101, title: '第一章', wordCount: 3200, chapterIdx: 1 }
            ]
          };
        }
        if (apiName === '/book/info') return { bookId: params.bookId, title: '测试书' };
        if (apiName === '/book/getprogress') return { bookId: params.bookId, book: { progress: 25 } };
        if (apiName === '/book/bestbookmarks') return { items: [] };
        if (apiName === '/review/list') return { reviews: [] };
        if (apiName === '/book/bookmarklist') throw new Error('bookmarklist unavailable');
        if (apiName === '/review/list/mine') throw new Error('mine reviews unavailable');
        if (apiName === '/book/underlines') throw new Error('underlines unavailable');
        throw new Error(`Unexpected API: ${apiName}`);
      }
    },
    llmClient: { streamShortJudgement: async function* () {} },
    logger: { info() {}, warn() {}, error() {} }
  });

  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/reading-snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createSnapshot())
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.deepEqual(body.signalPanel.personalSignals, {
      enabled: true,
      bookmarks: [],
      reviews: [],
      underlines: []
    });
    assert.match(body.signalPanel.debug.warnings.join('\n'), /个人书签获取失败: bookmarklist unavailable/);
    assert.match(body.signalPanel.debug.warnings.join('\n'), /个人评论获取失败: mine reviews unavailable/);
    assert.match(body.signalPanel.debug.warnings.join('\n'), /个人划线获取失败: underlines unavailable/);
  });
});

test('keeps snapshot upload successful when book info signal fails', async () => {
  const app = createApp({
    config: { clientToken: 'dev-token' },
    wereadClient: {
      async call(apiName, params) {
        if (apiName === '/book/chapterinfo') {
          return {
            chapters: [
              { chapterUid: 101, title: '第一章', wordCount: 3200, chapterIdx: 1 }
            ]
          };
        }
        if (apiName === '/book/info') {
          throw new Error('book info unavailable');
        }
        if (apiName === '/book/getprogress') {
          return { bookId: params.bookId, book: { progress: 25 }, timestamp: 1780200000 };
        }
        if (apiName === '/book/bestbookmarks') return { items: [] };
        if (apiName === '/review/list') return { reviews: [] };
        throw new Error(`Unexpected API: ${apiName}`);
      }
    },
    llmClient: { streamShortJudgement: async function* () {} },
    logger: { info() {}, warn() {}, error() {} }
  });

  await withServer(app, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/api/reading-snapshots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createSnapshot())
    });

    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.deepEqual(body.signalPanel.bookContext.bookInfo, {});
    assert.equal(body.signalPanel.bookContext.readingProgress.progress, 25);
    assert.match(body.signalPanel.debug.warnings.join('\n'), /书籍信息获取失败: book info unavailable/);
  });
});

test('streams short judgement events for a stored snapshot', async () => {
  const app = createApp({
    config: { clientToken: 'dev-token' },
    wereadClient: createStubWeReadClient([]),
    llmClient: {
      async *streamShortJudgement() {
        yield { type: 'delta', field: 'readingAdvice', text: '先精读热门划线附近上下文。' };
        yield {
          type: 'complete',
          readingJudgement: {
            recommendation: 'deep_read',
            masteryScore: {
              overall: 78,
              informationDensity: 82,
              structuralImportance: 74,
              skipRisk: 12
            },
            nextMustKnow: ['理解核心论点'],
            reasons: ['热门划线集中在核心论点。'],
            keyPassages: ['值得精读的关键段落'],
            questionsForAuthor: ['这一段如何支撑全书主线？'],
            readerPerspective: '读者普遍认为这段重要。',
            readingAdvice: '先精读热门划线附近上下文。'
          },
          judgement: {
            conclusion: 'worth_deep_read',
            reasons: ['热门划线集中在核心论点。'],
            keyPassages: ['值得精读的关键段落'],
            readerPerspective: '读者普遍认为这段重要。',
            readingAction: '先精读热门划线附近上下文。'
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
    assert.equal(streamResp.headers.get('content-type'), 'text/event-stream; charset=utf-8');

    const text = await streamResp.text();
    assert.match(text, /event: start\ndata: \{"snapshotId":"snap_/);
    assert.match(text, /event: delta\ndata: \{"field":"readingAdvice","text":"先精读热门划线附近上下文。"\}/);
    assert.match(text, /event: complete\ndata: \{"readingJudgement":\{"recommendation":"deep_read"/);
    assert.match(text, /"judgement":\{"conclusion":"worth_deep_read"/);
  });
});

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
    const firstText = await first.text();
    const second = await fetch(`${baseUrl}/api/reading-snapshots/${snapshotId}/judgement/stream?clientToken=dev-token`);
    const secondText = await second.text();

    assert.equal(streamCount, 1);
    assert.match(firstText, /"readingJudgement":\{"recommendation":"quick_read"/);
    assert.match(firstText, /"judgement":\{"conclusion":"quick_read"/);
    assert.match(secondText, /"readingJudgement":\{"recommendation":"quick_read"/);
    assert.match(secondText, /"judgement":\{"conclusion":"quick_read"/);
  });
});
