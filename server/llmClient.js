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
  const capture = buildCaptureInput(snapshot, signalPanel);

  return [
    {
      role: 'system',
      content: [
        '你是微信读书实时跟读助手，只做本章阅读价值判断。',
        '你会同时看到章节正文采集覆盖率和官方 WeRead Skill 信号。',
        '如果 capture.coverage.status 不是 full，应明确这是阶段性建议，不得声称已经读完整章正文。',
        '低覆盖率时，更多依赖热门划线、划线评论和书评来判断本章阅读价值；正文证据只能引用已采集片段。',
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
          expectedWordCount: capture.expectedWordCount,
          capture,
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

function buildCaptureInput(snapshot, signalPanel) {
  const expectedWordCount = numberOrNull(signalPanel.chapter.wordCount);
  const capturedTextLength = snapshot.chapterText.length;
  const coverageRatio = expectedWordCount ? capturedTextLength / expectedWordCount : null;
  const coveragePercent = coverageRatio === null ? null : Math.min(100, Math.round(coverageRatio * 100));
  const status = classifyCoverage(snapshot.captureMode, coverageRatio);

  return {
    mode: snapshot.captureMode || 'active-visible',
    stats: snapshot.captureStats || {},
    capturedTextLength,
    expectedWordCount,
    coverageRatio: coverageRatio === null ? null : Number(coverageRatio.toFixed(3)),
    coveragePercent,
    status,
    coverage: {
      status,
      ratio: coverageRatio === null ? null : Number(coverageRatio.toFixed(3)),
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

function classifyCoverage(mode, ratio) {
  if (mode === 'server-skill') return 'full';
  if (ratio !== null && ratio >= 0.9) return 'full';
  if (ratio !== null && ratio >= 0.6) return 'substantial';
  return 'partial';
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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
