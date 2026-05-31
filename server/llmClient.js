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

      const requestBody = buildRequestBody(snapshot, signalPanel, promptVersion, model);
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
        yield { type: 'delta', field: 'reason', text: content };
      }

      yield {
        type: 'complete',
        judgement: parseJudgement(raw)
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
        body: buildRequestBody(snapshot, signalPanel, promptVersion, model),
        note: 'Authorization 使用服务器上的 LLM_API_KEY；调试输出故意隐藏。'
      };
    }
  };
}

function buildRequestBody(snapshot, signalPanel, promptVersion, model) {
  return {
    model,
    stream: true,
    temperature: 0.2,
    messages: buildMessages(snapshot, signalPanel, promptVersion)
  };
}

function buildMessages(snapshot, signalPanel, promptVersion) {
  return [
    {
      role: 'system',
      content: [
        '你是微信读书实时跟读助手，只做本章阅读价值判断。',
        '必须输出 JSON，不要输出 Markdown。',
        'JSON 字段：conclusion, reasons, keyPassages, readerPerspective, readingAction。',
        'conclusion 只能是 worth_deep_read、quick_read 或 skip_read。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        promptVersion,
        task: '结合官方 WeRead Skill 信号和章节正文快照，判断当前章节是否值得精读。',
        chapter: {
          bookId: signalPanel.debug?.resolvedBookId || snapshot.bookId,
          rawBookId: snapshot.bookId,
          bookTitle: snapshot.bookTitle,
          chapterUid: signalPanel.chapter.chapterUid,
          chapterTitle: snapshot.chapterTitle,
          expectedWordCount: signalPanel.chapter.wordCount || null,
          capture: {
            mode: snapshot.captureMode || 'active-visible',
            stats: snapshot.captureStats || {},
            note: 'passive-accumulated means the text was accumulated only from pages the user naturally rendered; it may still be partial.'
          },
          chapterText: snapshot.chapterText
        },
        signals: {
          bookReviews: signalPanel.bookReviews,
          bestBookmarks: signalPanel.bestBookmarks,
          bookmarkReviews: signalPanel.bookmarkReviews
        },
        outputShape: {
          conclusion: 'worth_deep_read | quick_read | skip_read',
          reasons: ['2-3 条证据'],
          keyPassages: ['3-5 条热门划线或正文片段'],
          readerPerspective: '评论中的共识、争议、误读或补充',
          readingAction: '接下来精读哪部分、带着什么问题读'
        }
      })
    }
  ];
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

function parseJudgement(raw) {
  const parsed = parseJsonObject(raw);
  return {
    conclusion: normalizeConclusion(parsed.conclusion),
    reasons: normalizeStringArray(parsed.reasons, 3),
    keyPassages: normalizeStringArray(parsed.keyPassages, 5),
    readerPerspective: String(parsed.readerPerspective || ''),
    readingAction: String(parsed.readingAction || '')
  };
}

function parseJsonObject(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function normalizeConclusion(value) {
  if (['worth_deep_read', 'quick_read', 'skip_read'].includes(value)) {
    return value;
  }
  return 'quick_read';
}

function normalizeStringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim()).slice(0, limit);
}

module.exports = {
  createLlmClient,
  buildRequestBody,
  buildMessages,
  parseJudgement
};
