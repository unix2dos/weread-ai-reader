const DEFAULT_LLM_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_LLM_MODEL = 'gpt-4.1-nano';

const {
  buildRequestBody,
  parseReadingJudgement,
  toLegacyJudgement
} = require('./readingStrategy');

const MAX_REPAIR_ATTEMPTS = 1;

function createLlmClient({
  apiKey,
  apiBase = DEFAULT_LLM_API_BASE,
  model = DEFAULT_LLM_MODEL,
  fallbackModels = [],
  fetchImpl = fetch
}) {
  const modelOrder = buildModelOrder(model, fallbackModels);

  return {
    async *streamShortJudgement({ snapshot, signalPanel, promptVersion }) {
      if (!apiKey) {
        throw new Error('LLM_API_KEY is not configured');
      }

      const failures = [];
      for (const candidateModel of modelOrder) {
        try {
          const requestBody = buildRequestBody({
            snapshot,
            signalPanel,
            promptVersion,
            model: candidateModel
          });
          const raw = await requestChatCompletion({
            apiBase,
            apiKey,
            fetchImpl,
            requestBody
          });
          const readingJudgement = await parseOrRepairReadingJudgement({
            apiBase,
            apiKey,
            fetchImpl,
            model: candidateModel,
            requestBody,
            raw
          });
          if (readingJudgement.readingAdvice) {
            yield { type: 'delta', field: 'readingAdvice', text: readingJudgement.readingAdvice };
          }
          yield {
            type: 'complete',
            readingJudgement,
            judgement: toLegacyJudgement(readingJudgement)
          };
          return;
        } catch (err) {
          failures.push({ model: candidateModel, error: err });
        }
      }

      throw buildModelFallbackError(failures);
    },

    buildRequestDebug({ snapshot, signalPanel, promptVersion }) {
      return {
        method: 'POST',
        url: `${trimTrailingSlash(apiBase)}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer [hidden]'
        },
        body: buildRequestBody({ snapshot, signalPanel, promptVersion, model: modelOrder[0] }),
        fallbackModels: modelOrder.slice(1),
        note: modelOrder.length > 1
          ? `Authorization 使用服务器上的 LLM_API_KEY；调试输出故意隐藏。LLM 失败时会按同一 API Base 内的模型顺序重试：${modelOrder.join(' -> ')}。`
          : 'Authorization 使用服务器上的 LLM_API_KEY；调试输出故意隐藏。'
      };
    }
  };
}

function buildModelOrder(model, fallbackModels) {
  const seen = new Set();
  const models = [model, ...normalizeModelList(fallbackModels)];
  const order = [];
  for (const candidate of models) {
    const normalized = typeof candidate === 'string' ? candidate.trim() : '';
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    order.push(normalized);
  }
  return order;
}

function normalizeModelList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',');
  return [];
}

function buildModelFallbackError(failures) {
  if (failures.length === 1) return failures[0].error;

  const message = failures
    .map(({ model, error }) => `${model}: ${error.message}`)
    .join(' | ');
  const err = new Error(`All configured LLM models failed: ${message}`);
  err.failures = failures.map(({ model, error }) => ({
    model,
    message: error.message
  }));
  return err;
}

async function parseOrRepairReadingJudgement({
  apiBase,
  apiKey,
  fetchImpl,
  model,
  requestBody,
  raw
}) {
  let lastRaw = raw;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      return parseReadingJudgement(lastRaw);
    } catch (err) {
      lastError = err;
      if (attempt >= MAX_REPAIR_ATTEMPTS) break;
      lastRaw = await requestChatCompletion({
        apiBase,
        apiKey,
        fetchImpl,
        requestBody: buildRepairRequestBody({
          model,
          raw: lastRaw,
          error: err
        })
      });
    }
  }

  throw lastError;
}

async function requestChatCompletion({
  apiBase,
  apiKey,
  fetchImpl,
  requestBody
}) {
  const resp = await fetchImpl(`${trimTrailingSlash(apiBase)}/chat/completions`, {
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
  }
  return raw;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildRepairRequestBody({
  model,
  raw,
  error
}) {
  return {
    model,
    stream: true,
    temperature: 0,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          '你是 JSON 修复器，只修复微信读书阅读判断 JSON。',
          '保留原判断含义，不要改写为 Markdown，不要添加解释文字。',
          '必须补齐所有必填字段，尤其是 readerPerspective；如果评论信号不足，readerPerspective 写“暂无足够公开评论信号，暂以正文和划线信号判断”。',
          'questionsForAuthor 只保留问题，不要给答案。',
          '按二八原则修复：nextMustKnow 最多 3 条，reasons 最多 2 条，keyPassages 最多 3 条，questionsForAuthor 最多 2 个。',
          'readingAdvice 必须是一句明确阅读动作，60字内。',
          '必须只输出完整 JSON 对象。'
        ].join('\n')
      },
      {
        role: 'user',
        content: JSON.stringify({
          parseError: error.message,
          requiredFields: [
            'recommendation',
            'masteryScore.overall',
            'masteryScore.informationDensity',
            'masteryScore.structuralImportance',
            'masteryScore.skipRisk',
            'nextMustKnow',
            'reasons',
            'keyPassages',
            'questionsForAuthor',
            'readerPerspective',
            'readingAdvice'
          ],
          originalModelOutput: raw,
          originalTaskHint: '只根据 originalModelOutput 修复字段；如果 readerPerspective 缺失且无法从原输出推断，使用系统提示里的保守兜底句。'
        })
      }
    ]
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
  buildModelOrder,
  buildRepairRequestBody,
  createLlmClient,
  parseOrRepairReadingJudgement,
  requestChatCompletion,
  readOpenAiContentDeltas
};
