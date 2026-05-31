const DEFAULT_LLM_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_LLM_MODEL = 'gpt-4.1-nano';

const {
  buildRequestBody,
  parseReadingJudgement,
  toLegacyJudgement
} = require('./readingStrategy');

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

      const requestBody = buildRequestBody({ snapshot, signalPanel, promptVersion, model });
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
        yield { type: 'delta', field: 'readingAdvice', text: content };
      }

      const readingJudgement = parseReadingJudgement(raw);
      yield {
        type: 'complete',
        readingJudgement,
        judgement: toLegacyJudgement(readingJudgement)
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
        body: buildRequestBody({ snapshot, signalPanel, promptVersion, model }),
        note: 'Authorization 使用服务器上的 LLM_API_KEY；调试输出故意隐藏。'
      };
    }
  };
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

module.exports = {
  createLlmClient,
  readOpenAiContentDeltas
};
