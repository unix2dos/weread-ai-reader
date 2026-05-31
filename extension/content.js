(function () {
  'use strict';

  let currentChapterTitle = '';
  let currentChapterText = '';
  let extractionCount = 0;
  let isExtracting = false;

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
          <button class="wap-btn wap-analyze" title="深度分析">🧠 分析</button>
          <button class="wap-btn wap-toggle" title="最小化">—</button>
        </div>
      </div>
      <div class="wap-body">
        <div class="wap-status">等待章节加载...</div>
        <div class="wap-quick-analysis"></div>
        <div class="wap-deep-analysis"></div>
      </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('.wap-toggle').addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });

    panel.querySelector('.wap-analyze').addEventListener('click', () => {
      triggerDeepAnalysis();
    });

    makeDraggable(panel, panel.querySelector('.wap-header'));

    log('log', '✓ 面板已创建');
    return panel;
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
    const panel = document.getElementById('weread-ai-panel');
    if (!panel) return;
    const statusEl = panel.querySelector('.wap-status');
    statusEl.className = 'wap-status ' + type;
    statusEl.textContent = text;
  }

  function updateQuickAnalysis(html) {
    const panel = document.getElementById('weread-ai-panel');
    if (!panel) return;
    panel.querySelector('.wap-quick-analysis').innerHTML = html;
  }

  function updateDeepAnalysis(html) {
    const panel = document.getElementById('weread-ai-panel');
    if (!panel) return;
    panel.querySelector('.wap-deep-analysis').innerHTML = html;
  }

  function extractChapterContent() {
    log('log', '尝试提取章节内容...');

    const preRender = document.querySelector('#preRenderContent');
    if (preRender) {
      const html = preRender.innerHTML || '';
      const text = stripHtml(html);
      log('log', '#preRenderContent', { htmlLen: html.length, textLen: text.length });
      if (text.length > 0) {
        return { source: '#preRenderContent', html, text };
      }
    }

    const readerContent = document.querySelector('.readerChapterContent');
    if (readerContent) {
      const html = readerContent.innerHTML || '';
      const text = readerContent.textContent?.trim() || stripHtml(html);
      log('log', '.readerChapterContent', { htmlLen: html.length, textLen: text.length });
      if (text.length > 0) {
        return { source: '.readerChapterContent', html, text };
      }
    }

    const vueEl = document.querySelector('div.readerContent.routerView');
    if (vueEl && vueEl.__vue__) {
      const vue = vueEl.__vue__;
      log('log', 'Vue 属性', Object.keys(vue).filter(k => k.includes('Content')));
      const html = vue.chapterContentHtml || vue.chapterContentForEPub || '';
      if (html.length > 0) {
        return { source: 'vue.__vue__', html, text: stripHtml(html) };
      }
    }

    log('warn', '✗ 所有提取方式均失败');
    return null;
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const scripts = div.querySelectorAll('script, style');
    scripts.forEach(el => el.remove());
    return div.textContent.trim();
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
          log('log', `第 ${attempts} 次尝试失败，${delay}ms 后重试...`);
          setTimeout(tryExtract, delay);
        } else {
          log('warn', '重试次数用尽');
          resolve(null);
        }
      }
      tryExtract();
    });
  }

  function getChapterTitle() {
    const selectors = [
      'span.readerTopBar_title_chapter',
      '.readerTopBar_title_chapter',
      '.readerChapterContent h1',
      '.readerChapterContent h2',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    return '(未获取到标题)';
  }

  function getBookTitle() {
    const el = document.querySelector('.readerTopBar_title_link');
    return el ? el.textContent.trim() : '(未获取到书名)';
  }

  function getBookId() {
    const match = location.pathname.match(/\/web\/reader\/([a-f0-9]+)/);
    return match ? match[1] : null;
  }

  async function handleNewChapter() {
    if (isExtracting) {
      log('log', '已有提取任务进行中，跳过');
      return;
    }
    isExtracting = true;

    try {
      log('log', 'handleNewChapter 被调用');

      const result = await extractWithRetry(10, 300);
      if (!result) {
        updateStatus('error', '❌ 提取失败');
        return;
      }

      extractionCount++;
      const title = getChapterTitle();
      const book = getBookTitle();
      const bookId = getBookId();
      const charCount = result.text.length;
      const paraCount = (result.text.match(/\n/g) || []).length + 1;

      log('log', '提取结果:', { book, title, source: result.source, charCount, paraCount });

      if (title === currentChapterTitle && result.text === currentChapterText) {
        log('log', '重复章节，跳过');
        return;
      }

      currentChapterTitle = title;
      currentChapterText = result.text;

      const validation = validateContent(result.text);
      const statusType = validation.looksValid ? 'success' : 'waiting';
      const statusText = validation.looksValid 
        ? `✅ ${title}` 
        : `⚠️ ${title} (内容异常)`;
      
      updateStatus(statusType, statusText);

      chrome.runtime.sendMessage({
        type: 'CHAPTER_CHANGED',
        data: {
          bookId,
          bookTitle: book,
          chapterTitle: title,
          chapterText: result.text,
          charCount,
          looksValid: validation.looksValid
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          log('error', '发送消息失败:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.quickAnalysis) {
          updateQuickAnalysis(response.quickAnalysis);
        }
      });

      updateDeepAnalysis('');
      log('log', `章节提取成功 #${extractionCount}`);
    } finally {
      isExtracting = false;
    }
  }

  function validateContent(text) {
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    const paraCount = text.split(/\n/).filter(p => p.trim().length > 10).length;
    const avgParaLen = text.length / Math.max(paraCount, 1);
    const hasPunctuation = /[。，！？；：]/.test(text);
    const cssPattern = /\.[a-zA-Z-_]+\{|font-family|background-image|text-align/;
    const hasCss = cssPattern.test(text);
    const looksValid = hasChinese && hasPunctuation && !hasCss && paraCount > 2;
    
    return { looksValid, paraCount, avgParaLen, hasCss };
  }

  function triggerDeepAnalysis() {
    log('log', '触发深度分析');

    const bookId = getBookId();
    const title = getChapterTitle();

    updateDeepAnalysis('<div class="wap-loading">🧠 正在分析...</div>');

    chrome.runtime.sendMessage({
      type: 'REQUEST_DEEP_ANALYSIS',
      data: { bookId, chapterTitle: title }
    }, (response) => {
      if (chrome.runtime.lastError) {
        log('error', '请求深度分析失败:', chrome.runtime.lastError.message);
        updateDeepAnalysis('<div class="wap-error">分析失败</div>');
        return;
      }
      if (response && response.analysis) {
        updateDeepAnalysis(response.analysis);
      }
    });
  }

  function startObserving() {
    log('log', '启动 MutationObserver...');

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length === 0) continue;

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const preRender = node.querySelector?.('.preRenderContainer:not([style])')
            || (node.classList?.contains('preRenderContainer') ? node : null);

          if (preRender) {
            log('log', '检测到 preRenderContainer');
            setTimeout(handleNewChapter, 300);
            return;
          }

          if (node.classList?.contains('readerChapterContent')
            || node.querySelector?.('.readerChapterContent')) {
            log('log', '检测到 readerChapterContent');
            setTimeout(handleNewChapter, 300);
            return;
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    log('log', '✓ MutationObserver 已启动');
  }

  function startPolling() {
    log('log', '启动轮询兜底（2秒间隔）');
    let lastTitle = '';
    setInterval(() => {
      const title = getChapterTitle();
      if (title && title !== lastTitle && title !== '(未获取到标题)') {
        log('log', `轮询检测到新章节: "${lastTitle}" → "${title}"`);
        lastTitle = title;
        handleNewChapter();
      }
    }, 2000);
  }

  function init() {
    log('log', '========================================');
    log('log', 'WeRead AI Reader 启动');
    log('log', '========================================');
    log('log', 'URL:', location.href);

    if (!location.href.includes('weread.qq.com/web/reader/')) {
      log('log', '非阅读器页面，跳过');
      return;
    }

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
