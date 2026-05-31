const WEREAD_API_BASE = 'https://i.weread.qq.com';
const WEREAD_SKILL_VERSION = '1.0.3';

let wereadApiKey = '';
let llmConfig = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o-mini',
  apiBase: 'https://api.openai.com/v1'
};

const analysisCache = new Map();

chrome.storage.local.get(['wereadApiKey', 'llmConfig'], (result) => {
  if (result.wereadApiKey) wereadApiKey = result.wereadApiKey;
  if (result.llmConfig) llmConfig = { ...llmConfig, ...result.llmConfig };
  console.log('[WeRead AI BG] 配置已加载');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.wereadApiKey) wereadApiKey = changes.wereadApiKey.newValue;
  if (changes.llmConfig) llmConfig = { ...llmConfig, ...changes.llmConfig.newValue };
  console.log('[WeRead AI BG] 配置已更新');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHAPTER_CHANGED') {
    handleChapterChanged(message.data, sendResponse);
    return true;
  }
  if (message.type === 'REQUEST_DEEP_ANALYSIS') {
    handleDeepAnalysis(message.data, sendResponse);
    return true;
  }
});

async function handleChapterChanged(data, sendResponse) {
  console.log('[WeRead AI BG] 章节变更:', data.chapterTitle);

  try {
    const quickAnalysis = await generateQuickAnalysis(data);
    sendResponse({ quickAnalysis });
  } catch (err) {
    console.error('[WeRead AI BG] 轻量分析失败:', err);
    sendResponse({ quickAnalysis: '<div class="wap-error">轻量分析失败</div>' });
  }
}

async function handleDeepAnalysis(data, sendResponse) {
  console.log('[WeRead AI BG] 深度分析请求:', data.chapterTitle);

  const cacheKey = `${data.bookId}:${data.chapterTitle}`;
  if (analysisCache.has(cacheKey)) {
    console.log('[WeRead AI BG] 缓存命中');
    sendResponse({ analysis: analysisCache.get(cacheKey) });
    return;
  }

  try {
    const chapterData = await getChapterData(data.bookId, data.chapterTitle);
    const analysis = await callLLMForDeepAnalysis(chapterData);
    analysisCache.set(cacheKey, analysis);
    sendResponse({ analysis });
  } catch (err) {
    console.error('[WeRead AI BG] 深度分析失败:', err);
    sendResponse({ analysis: `<div class="wap-error">深度分析失败: ${err.message}</div>` });
  }
}

async function generateQuickAnalysis(data) {
  if (!wereadApiKey) {
    return '<div class="wap-hint">请在设置中配置 WeRead API Key</div>';
  }

  try {
    const [bestBookmarks, underlines] = await Promise.all([
      fetchBestBookmarks(data.bookId),
      fetchUnderlines(data.bookId, data.chapterTitle)
    ]);

    let html = '<div class="wap-section">';
    html += `<div class="wap-section-title">📊 章节概览</div>`;
    html += `<div class="wap-meta">字数: ${data.charCount.toLocaleString()}</div>`;

    if (bestBookmarks.length > 0) {
      html += `<div class="wap-section-title">🔥 热门划线 (${bestBookmarks.length})</div>`;
      html += '<ul class="wap-highlights">';
      for (const bm of bestBookmarks.slice(0, 5)) {
        html += `<li><span class="wap-hl-text">${escapeHtml(bm.markText.slice(0, 80))}</span>`;
        html += `<span class="wap-hl-count">${bm.totalCount}人划线</span></li>`;
      }
      html += '</ul>';
    }

    if (underlines.length > 0) {
      const totalUnderlines = underlines.reduce((sum, u) => sum + u.count, 0);
      html += `<div class="wap-meta">本章共 ${totalUnderlines} 人次划线</div>`;
    }

    html += '</div>';
    return html;
  } catch (err) {
    console.error('[WeRead AI BG] 轻量分析出错:', err);
    return `<div class="wap-hint">轻量分析暂不可用</div>`;
  }
}

async function fetchBestBookmarks(bookId) {
  const resp = await wereadApiPost('/book/bestbookmarks', { bookId, chapterUid: 0 });
  return resp.items || [];
}

async function fetchUnderlines(bookId, chapterTitle) {
  try {
    const chaptersResp = await wereadApiPost('/book/chapterinfo', { bookId });
    const chapters = chaptersResp.chapters || [];
    const chapter = chapters.find(c => c.title === chapterTitle);
    if (!chapter) return [];

    const resp = await wereadApiPost('/book/underlines', {
      bookId,
      chapterUid: chapter.chapterUid
    });
    return resp.underlines || [];
  } catch {
    return [];
  }
}

async function getChapterData(bookId, chapterTitle) {
  const [bestBookmarks, chapterInfo] = await Promise.all([
    fetchBestBookmarks(bookId),
    wereadApiPost('/book/chapterinfo', { bookId }).catch(() => ({ chapters: [] }))
  ]);

  return { bookId, chapterTitle, bestBookmarks, chapterInfo };
}

async function callLLMForDeepAnalysis(chapterData) {
  if (!llmConfig.apiKey) {
    return '<div class="wap-error">请在设置中配置 LLM API Key</div>';
  }

  const prompt = buildAnalysisPrompt(chapterData);

  const resp = await fetch(`${llmConfig.apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${llmConfig.apiKey}`
    },
    body: JSON.stringify({
      model: llmConfig.model,
      messages: [
        { role: 'system', content: '你是一个专业的阅读助手，帮助用户分析书籍章节内容。请用中文回答。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1500
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`LLM API 错误: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  const content = data.choices[0].message.content;

  return formatAnalysisResult(content);
}

function buildAnalysisPrompt(chapterData) {
  let prompt = `请分析以下书籍章节的内容。\n\n`;
  prompt += `章节标题: ${chapterData.chapterTitle}\n\n`;

  if (chapterData.bestBookmarks.length > 0) {
    prompt += `以下是该章节的热门划线（其他读者认为重要的段落）:\n`;
    for (const bm of chapterData.bestBookmarks.slice(0, 10)) {
      prompt += `- "${bm.markText}" (${bm.totalCount}人划线)\n`;
    }
    prompt += '\n';
  }

  prompt += `请提供以下分析:\n`;
  prompt += `1. **章节摘要**: 用 2-3 句话概括本章核心内容\n`;
  prompt += `2. **核心观点**: 列出 3-5 个最重要的观点或概念\n`;
  prompt += `3. **深度阅读评分**: 1-10 分，说明是否值得精读，理由是什么\n`;
  prompt += `4. **阅读建议**: 这章适合快速浏览还是深度阅读？为什么？\n`;

  return prompt;
}

function formatAnalysisResult(markdown) {
  let html = '<div class="wap-analysis">';
  const sections = markdown.split(/\n(?=\d+\.\s+\*\*)/);

  for (const section of sections) {
    const match = section.match(/(\d+)\.\s+\*\*(.+?)\*\*[:：]?\s*([\s\S]*)/);
    if (match) {
      const [, , title, content] = match;
      html += `<div class="wap-analysis-section">`;
      html += `<div class="wap-analysis-title">${escapeHtml(title)}</div>`;
      html += `<div class="wap-analysis-content">${escapeHtml(content.trim())}</div>`;
      html += `</div>`;
    }
  }

  html += '</div>';
  return html;
}

async function wereadApiPost(apiName, params) {
  const resp = await fetch(`${WEREAD_API_BASE}/api/agent/gateway`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${wereadApiKey}`
    },
    body: JSON.stringify({
      api_name: apiName,
      skill_version: WEREAD_SKILL_VERSION,
      ...params
    })
  });

  if (!resp.ok) {
    throw new Error(`WeRead API 错误: ${resp.status}`);
  }

  const data = await resp.json();
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeRead API: ${data.errmsg || '未知错误'}`);
  }

  return data;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
