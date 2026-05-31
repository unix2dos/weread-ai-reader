const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
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
            { chapterUid: 101, title: '第一章' }
          ]
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
    assert.equal(body.agentRequest.url, 'https://llm.example/v1/chat/completions');
    assert.equal(body.agentRequest.headers.Authorization, 'Bearer [hidden]');
    assert.equal(body.agentRequest.body.model, 'deepseek-v4-flash');
    assert.match(body.agentRequest.body.messages[1].content, /这一章讨论了如何判断一章是否值得精读/);
    assert.doesNotMatch(JSON.stringify(body.agentRequest), /test-key|dev-token/);
    assert.equal(body.signalPanel.bestBookmarks[0].markText, '值得精读的关键段落');
    assert.deepEqual(body.signalPanel.bookmarkReviews[0].comments, [
      '这段是本章核心。',
      '这里和全书主题呼应。'
    ]);
    assert.deepEqual(body.signalPanel.debug.skillCalls, [
      '/book/chapterinfo',
      '/book/bestbookmarks',
      '/book/readreviews',
      '/review/list'
    ]);
    assert.equal(calls.find((call) => call.apiName === '/book/bestbookmarks').params.chapterUid, 101);
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
    assert.equal(calls.find((call) => call.apiName === '/book/bestbookmarks').params.bookId, '3300060202');
    assert.deepEqual(calls.map((call) => call.apiName), [
      '/book/chapterinfo',
      '/store/search',
      '/book/chapterinfo',
      '/book/bestbookmarks',
      '/review/list'
    ]);
  });
});

test('streams short judgement events for a stored snapshot', async () => {
  const app = createApp({
    config: { clientToken: 'dev-token' },
    wereadClient: createStubWeReadClient([]),
    llmClient: {
      async *streamShortJudgement() {
        yield { type: 'delta', field: 'reason', text: '热门划线集中在核心论点。' };
        yield {
          type: 'complete',
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
    assert.match(text, /event: delta\ndata: \{"field":"reason","text":"热门划线集中在核心论点。"\}/);
    assert.match(text, /event: complete\ndata: \{"judgement":\{"conclusion":"worth_deep_read"/);
  });
});
