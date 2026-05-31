(function () {
  'use strict';

  let currentChapterTitle = '';
  let currentChapterText = '';
  let extractionCount = 0;
  let isExtracting = false;
  let currentSnapshotId = '';
  let judgementPort = null;

  function log(level, message, data) {
    const prefix = '[WeRead AI]';
    if (data !== undefined) {
      console[level](`${prefix} ${message}`, data);
    } else {
      console[level](`${prefix} ${message}`);
    }
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'weread-ai-panel';
    panel.innerHTML = `
      <div class="wap-header">
        <span class="wap-title">WeRead AI</span>
        <div class="wap-controls">
          <button class="wap-btn wap-analyze" title="重新生成短判断">重新判断</button>
          <button class="wap-btn wap-toggle" title="最小化">-</button>
        </div>
      </div>
      <div class="wap-body">
        <div class="wap-status">等待章节加载...</div>
        <div class="wap-signal-panel"></div>
        <div class="wap-judgement"></div>
        <details class="wap-debug">
          <summary>调试</summary>
          <pre class="wap-debug-content">暂无请求</pre>
        </details>
      </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('.wap-toggle').addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });

    panel.querySelector('.wap-analyze').addEventListener('click', () => {
      if (currentSnapshotId) {
        startJudgementStream(currentSnapshotId);
      }
    });

    makeDraggable(panel, panel.querySelector('.wap-header'));
    log('log', '面板已创建');
  }

  function makeDraggable(el, handle) {
    let isDragging = false, startX, startY, origX, origY;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.wap-btn')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      el.style.left = (origX + e.clientX - startX) + 'px';
      el.style.top = (origY + e.clientY - startY) + 'px';
      el.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });
  }

  function updateStatus(type, text) {
    const statusEl = document.querySelector('#weread-ai-panel .wap-status');
    if (!statusEl) return;
    statusEl.className = `wap-status ${type}`;
    statusEl.textContent = text;
  }

  function updateSignalPanel(signalPanel) {
    const el = document.querySelector('#weread-ai-panel .wap-signal-panel');
    if (!el) return;

    const bestBookmarks = signalPanel.bestBookmarks || [];
    const bookmarkReviews = signalPanel.bookmarkReviews || [];
    const bookReviews = signalPanel.bookReviews || [];
    const warnings = signalPanel.debug?.warnings || [];

    el.innerHTML = `
      <div class="wap-section">
        <div class="wap-section-title">信号面板</div>
        <div class="wap-meta">章节: ${escapeHtml(signalPanel.chapter?.title || '')}</div>
        <div class="wap-meta">热门划线: ${bestBookmarks.length} 条 · 划线评论: ${countComments(bookmarkReviews)} 条 · 书评: ${bookReviews.length} 条</div>
        ${renderWarnings(warnings)}
        ${renderBestBookmarks(bestBookmarks)}
        ${renderBookmarkReviews(bookmarkReviews)}
        ${renderBookReviews(bookReviews)}
      </div>
    `;
  }

  function renderBestBookmarks(items) {
    if (items.length === 0) return '<div class="wap-hint">暂无本章热门划线</div>';
    return `
      <div class="wap-section-title">热门划线</div>
      <ul class="wap-highlights">
        ${items.slice(0, 5).map((item) => `
          <li>
            <span class="wap-hl-text">${escapeHtml(item.markText)}</span>
            <span class="wap-hl-count">${Number(item.totalCount || 0)}人</span>
          </li>
        `).join('')}
      </ul>
    `;
  }

  function renderBookmarkReviews(items) {
    const rows = items
      .filter((item) => item.comments && item.comments.length > 0)
      .slice(0, 3);
    if (rows.length === 0) return '';
    return `
      <div class="wap-section-title">划线评论</div>
      ${rows.map((item) => `
        <div class="wap-review-block">
          <div class="wap-meta">range ${escapeHtml(item.range)} · ${Number(item.totalCount || 0)} 条</div>
          <ul class="wap-comments">
            ${item.comments.slice(0, 3).map((comment) => `<li>${escapeHtml(comment)}</li>`).join('')}
          </ul>
        </div>
      `).join('')}
    `;
  }

  function renderBookReviews(items) {
    if (items.length === 0) return '';
    return `
      <div class="wap-section-title">整本书评价背景</div>
      <ul class="wap-comments">
        ${items.slice(0, 3).map((item) => `<li>${escapeHtml(truncate(item.content, 120))}</li>`).join('')}
      </ul>
    `;
  }

  function renderWarnings(warnings) {
    if (!warnings.length) return '';
    return `<div class="wap-warning">${warnings.map(escapeHtml).join('<br>')}</div>`;
  }

  function updateJudgementLoading(text) {
    const el = document.querySelector('#weread-ai-panel .wap-judgement');
    if (!el) return;
    el.innerHTML = `<div class="wap-loading">${escapeHtml(text)}</div>`;
  }

  function appendJudgementDelta(text) {
    const el = document.querySelector('#weread-ai-panel .wap-judgement');
    if (!el) return;
    let streamEl = el.querySelector('.wap-judgement-stream');
    if (!streamEl) {
      el.innerHTML = `
        <div class="wap-section">
          <div class="wap-section-title">短判断</div>
          <div class="wap-judgement-stream"></div>
        </div>
      `;
      streamEl = el.querySelector('.wap-judgement-stream');
    }
    streamEl.textContent += text;
  }

  function renderJudgement(judgement) {
    const el = document.querySelector('#weread-ai-panel .wap-judgement');
    if (!el) return;
    el.innerHTML = `
      <div class="wap-section wap-judgement-card">
        <div class="wap-section-title">短判断</div>
        <div class="wap-verdict">${escapeHtml(labelConclusion(judgement.conclusion))}</div>
        ${renderList('理由', judgement.reasons)}
        ${renderList('重点段落', judgement.keyPassages)}
        <div class="wap-analysis-section">
          <div class="wap-analysis-title">读者视角</div>
          <div class="wap-analysis-content">${escapeHtml(judgement.readerPerspective || '')}</div>
        </div>
        <div class="wap-analysis-section">
          <div class="wap-analysis-title">阅读动作</div>
          <div class="wap-analysis-content">${escapeHtml(judgement.readingAction || '')}</div>
        </div>
      </div>
    `;
  }

  function renderList(title, items) {
    if (!items || items.length === 0) return '';
    return `
      <div class="wap-analysis-section">
        <div class="wap-analysis-title">${escapeHtml(title)}</div>
        <ul class="wap-comments">
          ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  function updateDebug(summary) {
    const el = document.querySelector('#weread-ai-panel .wap-debug-content');
    if (!el) return;
    el.textContent = JSON.stringify(summary, null, 2);
  }

  function extractChapterContent() {
    log('log', '尝试提取章节内容...');

    const preRender = document.querySelector('#preRenderContent');
    if (preRender) {
      const html = preRender.innerHTML || '';
      const text = cleanText(stripHtml(html));
      log('log', '#preRenderContent', { htmlLen: html.length, textLen: text.length });
      if (text.length > 0) {
        return { source: '#preRenderContent', html, text };
      }
    }

    const readerContent = document.querySelector('.readerChapterContent');
    if (readerContent) {
      const html = readerContent.innerHTML || '';
      const text = cleanText(readerContent.innerText?.trim() || stripHtml(html));
      log('log', '.readerChapterContent', { htmlLen: html.length, textLen: text.length });
      if (text.length > 0) {
        return { source: '.readerChapterContent', html, text };
      }
    }

    const vue = getVue();
    if (vue) {
      const html = vue.chapterContentHtml || vue.chapterContentForEPub || '';
      if (html.length > 0) {
        return { source: 'vue.__vue__', html, text: cleanText(stripHtml(html)) };
      }
    }

    log('warn', '所有提取方式均失败');
    return null;
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('script, style').forEach((el) => el.remove());
    return div.textContent.trim();
  }

  function cleanText(text) {
    if (!text) return '';
    return text.split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/font-family|background-image|text-align|line-height|^\.[a-zA-Z0-9_-]+\s*\{/.test(line))
      .join('\n')
      .trim();
  }

  function extractWithRetry(maxRetries = 10, delay = 300) {
    return new Promise((resolve) => {
      let attempts = 0;
      function tryExtract() {
        attempts++;
        const result = extractChapterContent();
        if (result && result.text.length > 10) {
          log('log', `第 ${attempts} 次尝试成功`);
          resolve(result);
        } else if (attempts < maxRetries) {
          setTimeout(tryExtract, delay);
        } else {
          resolve(null);
        }
      }
      tryExtract();
    });
  }

  function getVue() {
    const vueEl = document.querySelector('div.readerContent.routerView');
    return vueEl && vueEl.__vue__ ? vueEl.__vue__ : null;
  }

  function getBookAndChapter() {
    const vue = getVue();
    if (vue && vue.bookInfo && vue.currentChapter) {
      return {
        bookTitle: vue.bookInfo.title?.trim() || '(未获取到书名)',
        chapterTitle: vue.currentChapter.title?.trim() || '(未获取到标题)',
        chapterUid: Number(vue.currentChapter.chapterUid || vue.currentChapter.uid) || null
      };
    }

    const bookEl = document.querySelector('.readerTopBar_title_link');
    const chapterEl = document.querySelector('.readerTopBar_title_chapter');
    return {
      bookTitle: bookEl ? bookEl.textContent.trim() : '(未获取到书名)',
      chapterTitle: chapterEl ? chapterEl.textContent.trim() : '(未获取到标题)',
      chapterUid: null
    };
  }

  function getBookId() {
    const match = location.pathname.match(/\/web\/reader\/([^/?#]+)/);
    return match ? match[1] : '';
  }

  async function handleNewChapter() {
    if (isExtracting) {
      log('log', '已有提取任务进行中，跳过');
      return;
    }
    isExtracting = true;

    try {
      const result = await extractWithRetry(10, 300);
      if (!result) {
        updateStatus('error', '提取失败');
        return;
      }

      const { bookTitle, chapterTitle, chapterUid } = getBookAndChapter();
      if (chapterTitle === currentChapterTitle && result.text === currentChapterText) {
        log('log', '重复章节，跳过');
        return;
      }

      currentChapterTitle = chapterTitle;
      currentChapterText = result.text;
      extractionCount++;

      const validation = validateContent(result.text);
      updateStatus(validation.looksValid ? 'success' : 'waiting', `${chapterTitle} · ${result.text.length.toLocaleString()} 字`);

      const snapshot = await buildReadingSnapshot({
        bookId: getBookId(),
        bookTitle,
        chapterUid,
        chapterTitle,
        chapterText: result.text,
        source: result.source
      });

      updateDebug(buildClientDebug(snapshot));
      await uploadSnapshot(snapshot);
      log('log', `章节处理完成 #${extractionCount}`);
    } catch (err) {
      log('error', '章节处理失败', err);
      updateStatus('error', `Agent 请求失败: ${err.message}`);
    } finally {
      isExtracting = false;
    }
  }

  async function buildReadingSnapshot({ bookId, bookTitle, chapterUid, chapterTitle, chapterText, source }) {
    const agentConfig = await getAgentConfig();
    const contentHash = await sha256(chapterText);
    return {
      requestId: crypto.randomUUID(),
      bookId,
      bookTitle,
      chapterUid,
      chapterTitle,
      url: location.href,
      chapterText,
      contentHash,
      capturedAt: new Date().toISOString(),
      source,
      agentServerUrl: normalizeServerUrl(agentConfig.serverUrl)
    };
  }

  async function uploadSnapshot(snapshot) {
    updateStatus('waiting', '正在发送阅读快照...');

    const response = await chrome.runtime.sendMessage({
      type: 'UPLOAD_READING_SNAPSHOT',
      data: stripLocalOnlyFields(snapshot)
    });

    if (!response?.ok) {
      throw new Error(response?.error?.message || '上传阅读快照失败');
    }

    const body = response.body;
    currentSnapshotId = body.snapshotId;
    updateSignalPanel(body.signalPanel);
    updateDebug({
      ...buildClientDebug(snapshot),
      snapshotId: body.snapshotId,
      cache: body.cache,
      skillCalls: body.signalPanel?.debug?.skillCalls || [],
      warnings: body.signalPanel?.debug?.warnings || []
    });
    startJudgementStream(body.snapshotId);
  }

  function startJudgementStream(snapshotId) {
    if (judgementPort) {
      judgementPort.disconnect();
      judgementPort = null;
    }

    updateJudgementLoading('正在生成短判断...');
    judgementPort = chrome.runtime.connect({ name: 'judgement-stream' });
    judgementPort.onMessage.addListener((message) => {
      if (message.type !== 'sse') return;
      if (message.event === 'start') {
        updateJudgementLoading('短判断流已连接...');
      } else if (message.event === 'delta') {
        appendJudgementDelta(message.data.text || '');
      } else if (message.event === 'complete') {
        renderJudgement(message.data.judgement || {});
        judgementPort.disconnect();
        judgementPort = null;
      } else if (message.event === 'error') {
        const data = message.data || {};
        updateJudgementLoading(`短判断失败: ${data.message || '未知错误'}`);
        log('error', 'SSE 连接错误', data);
        judgementPort.disconnect();
        judgementPort = null;
      }
    });
    judgementPort.postMessage({ type: 'START_JUDGEMENT_STREAM', snapshotId });
  }

  function getAgentConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_AGENT_CONFIG' }, (response) => {
        if (chrome.runtime.lastError || !response?.agentConfig) {
          resolve({ serverUrl: 'http://127.0.0.1:8787', clientToken: 'dev-token' });
          return;
        }
        resolve(response.agentConfig);
      });
    });
  }

  function stripLocalOnlyFields(snapshot) {
    const { agentServerUrl, ...body } = snapshot;
    return body;
  }

  function validateContent(text) {
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    const paraCount = text.split(/\n/).filter((p) => p.trim().length > 10).length;
    const hasPunctuation = /[。，！？；：]/.test(text);
    const hasCss = /\.[a-zA-Z-_]+\{|font-family|background-image|text-align/.test(text);
    return { looksValid: hasChinese && hasPunctuation && !hasCss && paraCount > 2, paraCount, hasCss };
  }

  function startObserving() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const preRender = node.querySelector?.('.preRenderContainer:not([style])')
            || (node.classList?.contains('preRenderContainer') ? node : null);
          if (preRender || node.classList?.contains('readerChapterContent') || node.querySelector?.('.readerChapterContent')) {
            setTimeout(handleNewChapter, 300);
            return;
          }
        }
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function startPolling() {
    let lastTitle = '';
    setInterval(() => {
      const { chapterTitle } = getBookAndChapter();
      if (chapterTitle && chapterTitle !== lastTitle && chapterTitle !== '(未获取到标题)') {
        lastTitle = chapterTitle;
        handleNewChapter();
      }
    }, 2000);
  }

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function buildClientDebug(snapshot) {
    return {
      requestId: snapshot.requestId,
      bookId: snapshot.bookId,
      bookTitle: snapshot.bookTitle,
      chapterUid: snapshot.chapterUid,
      chapterTitle: snapshot.chapterTitle,
      url: snapshot.url,
      source: snapshot.source,
      contentHash: snapshot.contentHash,
      chapterTextLength: snapshot.chapterText.length,
      preview: previewText(snapshot.chapterText),
      capturedAt: snapshot.capturedAt,
      agentServerUrl: snapshot.agentServerUrl
    };
  }

  function previewText(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 160) return normalized;
    return `${normalized.slice(0, 80)} ... ${normalized.slice(-80)}`;
  }

  function countComments(items) {
    return items.reduce((sum, item) => sum + (item.comments ? item.comments.length : 0), 0);
  }

  function labelConclusion(value) {
    if (value === 'worth_deep_read') return '值得精读';
    if (value === 'skip_read') return '可跳读';
    return '可快读';
  }

  function normalizeServerUrl(value) {
    return String(value || 'http://127.0.0.1:8787').replace(/\/+$/, '');
  }

  function truncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text || '';
    return `${text.slice(0, maxLength)}...`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
  }

  function init() {
    if (!location.href.includes('weread.qq.com/web/reader/')) return;
    createPanel();
    setTimeout(() => {
      startObserving();
      startPolling();
      handleNewChapter();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
