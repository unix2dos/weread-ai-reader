// ==UserScript==
// @name         WeRead AI Reader - 验证脚本
// @namespace    weread-ai-reader
// @version      0.1.0
// @description  验证微信读书网页版章节全文获取可行性
// @match        https://weread.qq.com/web/reader/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  let currentChapterTitle = '';
  let currentChapterText = '';
  let extractionCount = 0;
  let isExtracting = false;

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'weread-ai-verify-panel';
    panel.innerHTML = `
      <div class="wap-header">
        <span>🔍 WeRead AI 验证</span>
        <button class="wap-toggle" title="最小化">—</button>
      </div>
      <div class="wap-body">
        <div class="wap-status">等待章节加载...</div>
        <div class="wap-info"></div>
        <div class="wap-preview"></div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #weread-ai-verify-panel {
        position: fixed;
        top: 80px;
        right: 20px;
        width: 380px;
        max-height: 500px;
        background: #fff;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        overflow: hidden;
        transition: all 0.2s ease;
      }
      #weread-ai-verify-panel.collapsed .wap-body { display: none; }
      #weread-ai-verify-panel.collapsed { width: 200px; }
      .wap-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: #f8f9fa;
        border-bottom: 1px solid #e0e0e0;
        font-weight: 600;
        cursor: move;
        user-select: none;
      }
      .wap-toggle {
        background: none;
        border: none;
        font-size: 16px;
        cursor: pointer;
        color: #666;
        padding: 0 4px;
      }
      .wap-body { padding: 12px 14px; }
      .wap-status {
        padding: 6px 10px;
        border-radius: 6px;
        margin-bottom: 8px;
        font-weight: 500;
      }
      .wap-status.waiting { background: #fff3cd; color: #856404; }
      .wap-status.success { background: #d4edda; color: #155724; }
      .wap-status.error { background: #f8d7da; color: #721c24; }
      .wap-info {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 4px 12px;
        margin-bottom: 8px;
        font-size: 12px;
      }
      .wap-info dt { color: #888; }
      .wap-info dd { color: #333; font-weight: 500; margin: 0; }
      .wap-preview {
        max-height: 200px;
        overflow-y: auto;
        padding: 8px 10px;
        background: #f8f9fa;
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.6;
        color: #555;
        white-space: pre-wrap;
        word-break: break-all;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    panel.querySelector('.wap-toggle').addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      const btn = panel.querySelector('.wap-toggle');
      btn.textContent = panel.classList.contains('collapsed') ? '+' : '—';
    });

    const debugBtn = document.createElement('button');
    debugBtn.className = 'wap-btn';
    debugBtn.textContent = '🔍';
    debugBtn.title = '诊断 DOM';
    debugBtn.addEventListener('click', () => {
      const debugInfo = showDebugInfo();
      updatePanel({ type: 'waiting', text: '🔍 DOM 诊断' }, { '诊断': '见控制台' }, debugInfo);
    });
    panel.querySelector('.wap-header').insertBefore(debugBtn, panel.querySelector('.wap-toggle'));

    makeDraggable(panel, panel.querySelector('.wap-header'));

    return panel;
  }

  function makeDraggable(el, handle) {
    let isDragging = false, startX, startY, origX, origY;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('wap-toggle')) return;
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

  function updatePanel(status, info, preview) {
    const panel = document.getElementById('weread-ai-verify-panel');
    if (!panel) return;

    const statusEl = panel.querySelector('.wap-status');
    const infoEl = panel.querySelector('.wap-info');
    const previewEl = panel.querySelector('.wap-preview');

    statusEl.className = 'wap-status ' + status.type;
    statusEl.textContent = status.text;

    if (info) {
      infoEl.innerHTML = Object.entries(info)
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
        .join('');
    }

    if (preview !== undefined) {
      previewEl.textContent = preview;
    }
  }

  function showDebugInfo() {
    const debug = [];

    const preRender = document.querySelector('#preRenderContent');
    debug.push(`#preRenderContent: ${preRender ? '存在' : '不存在'}`);
    if (preRender) {
      debug.push(`  innerHTML length: ${preRender.innerHTML?.length}`);
      debug.push(`  textContent length: ${preRender.textContent?.length}`);
      debug.push(`  style.display: ${preRender.style?.display}`);
    }

    const preContainer = document.querySelector('.preRenderContainer');
    debug.push(`.preRenderContainer: ${preContainer ? '存在' : '不存在'}`);
    if (preContainer) {
      debug.push(`  style: ${preContainer.getAttribute('style')}`);
    }

    const readerContent = document.querySelector('.readerChapterContent');
    debug.push(`.readerChapterContent: ${readerContent ? '存在' : '不存在'}`);
    if (readerContent) {
      debug.push(`  textContent length: ${readerContent.textContent?.length}`);
    }

    const vueEl = document.querySelector('div.readerContent.routerView');
    debug.push(`Vue element: ${vueEl ? '存在' : '不存在'}`);
    if (vueEl) {
      debug.push(`  __vue__: ${vueEl.__vue__ ? '存在' : '不存在'}`);
      if (vueEl.__vue__) {
        const vue = vueEl.__vue__;
        const contentProps = Object.keys(vue).filter(k =>
          k.includes('Content') || k.includes('chapter')
        );
        debug.push(`  Vue content props: ${contentProps.join(', ')}`);
        contentProps.forEach(prop => {
          const val = vue[prop];
          debug.push(`    ${prop}: ${typeof val} ${val?.length !== undefined ? `(length=${val.length})` : ''}`);
        });
      }
    }

    const { chapter: chapterTitle } = getBookAndChapterTitles();
    debug.push(`章节标题: "${chapterTitle}"`);

    console.log('[WeRead AI] DOM 诊断:\n' + debug.join('\n'));
    return debug.join('\n');
  }

  function extractChapterContent() {
    console.log('[WeRead AI] 尝试提取章节内容...');

    const preRender = document.querySelector('#preRenderContent');
    if (preRender) {
      const html = preRender.innerHTML || '';
      const text = cleanText(stripHtml(html));
      console.log('[WeRead AI] #preRenderContent:', {
        htmlLen: html.length,
        textLen: text.length,
        preview: text.slice(0, 200)
      });
      if (text.length > 10) {
        return { source: '#preRenderContent', html, text };
      }
    }

    const readerContent = document.querySelector('.readerChapterContent');
    if (readerContent) {
      const html = readerContent.innerHTML || '';
      const rawText = readerContent.innerText?.trim() || '';
      const text = cleanText(rawText || stripHtml(html));
      console.log('[WeRead AI] .readerChapterContent:', {
        htmlLen: html.length,
        rawTextLen: rawText.length,
        cleanedLen: text.length,
        preview: text.slice(0, 300)
      });
      if (text.length > 10) {
        return { source: '.readerChapterContent', html, text };
      }
    }

    const vueEl = document.querySelector('div.readerContent.routerView');
    if (vueEl && vueEl.__vue__) {
      const vue = vueEl.__vue__;
      console.log('[WeRead AI] Vue 属性:', Object.keys(vue).filter(k => k.includes('Content')));
      const html = vue.chapterContentHtml || vue.chapterContentForEPub || '';
      if (html.length > 0) {
        const text = cleanText(stripHtml(html));
        return { source: 'vue.__vue__', html, text };
      }
    }

    console.log('[WeRead AI] ✗ 所有提取方式均失败');
    return null;
  }

  function cleanText(text) {
    if (!text) return '';
    
    const lines = text.split(/\n/);
    const cleaned = lines.filter(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (/^\.[a-zA-Z0-9_-]+\s*\{/.test(trimmed)) return false;
      if (/^\.[a-zA-Z0-9_-]+\s*\./.test(trimmed)) return false;
      if (/font-family|background-image|text-align|line-height|margin-bottom|text-indent/.test(trimmed)) return false;
      if (/^https?:\/\//.test(trimmed)) return false;
      if (/^\d+\s*px/.test(trimmed)) return false;
      if (trimmed.length < 5 && !/[\u4e00-\u9fff]/.test(trimmed)) return false;
      return true;
    });
    
    return cleaned.join('\n').trim();
  }

  function extractWithRetry(maxRetries = 10, delay = 300) {
    return new Promise((resolve) => {
      let attempts = 0;
      function tryExtract() {
        attempts++;
        const result = extractChapterContent();
        if (result && result.text.length > 10) {
          console.log(`[WeRead AI] 第 ${attempts} 次尝试成功`);
          resolve(result);
        } else if (attempts < maxRetries) {
          console.log(`[WeRead AI] 第 ${attempts} 次尝试失败，${delay}ms 后重试...`);
          setTimeout(tryExtract, delay);
        } else {
          console.log('[WeRead AI] 重试次数用尽');
          resolve(null);
        }
      }
      tryExtract();
    });
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const scripts = div.querySelectorAll('script, style');
    scripts.forEach(el => el.remove());
    return div.textContent.trim();
  }

  function validateContent(text) {
    const checks = [];
    
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    checks.push(`包含中文字符: ${hasChinese ? '是' : '否'}`);
    
    const paraCount = text.split(/\n/).filter(p => p.trim().length > 10).length;
    checks.push(`有效段落数: ${paraCount}`);
    
    const avgParaLen = text.length / Math.max(paraCount, 1);
    checks.push(`平均段落长度: ${Math.round(avgParaLen)}字`);
    
    const hasPunctuation = /[。，！？；：]/.test(text);
    checks.push(`包含中文标点: ${hasPunctuation ? '是' : '否'}`);
    
    const cssPattern = /\.[a-zA-Z-_]+\{|font-family|background-image|text-align/;
    const hasCss = cssPattern.test(text);
    checks.push(`包含CSS代码: ${hasCss ? '是 (异常)' : '否'}`);
    
    const looksValid = hasChinese && hasPunctuation && !hasCss && paraCount > 2;
    checks.push(`综合判断: ${looksValid ? '正常文本' : '可能异常'}`);
    
    return { looksValid, checks, paraCount };
  }

  function getBookAndChapterTitles() {
    const vueEl = document.querySelector('div.readerContent.routerView');
    if (vueEl && vueEl.__vue__) {
      const vue = vueEl.__vue__;
      if (vue.bookInfo && vue.currentChapter) {
        return {
          book: vue.bookInfo.title?.trim() || '(未获取到书名)',
          chapter: vue.currentChapter.title?.trim() || '(未获取到标题)'
        };
      }
    }

    const linkEl = document.querySelector('.readerTopBar_title_link');
    const chapterEl = document.querySelector('.readerTopBar_title_chapter');
    
    if (linkEl && chapterEl) {
      const book = linkEl.textContent.trim();
      const chapter = chapterEl.textContent.trim();
      if (book !== chapter) {
        return { book, chapter };
      }
    }

    if (linkEl) {
      const text = linkEl.textContent.trim();
      return { book: text, chapter: text };
    }

    return { book: '(未获取到书名)', chapter: '(未获取到标题)' };
  }

  async function handleNewChapter() {
    if (isExtracting) {
      console.log('[WeRead AI] 已有提取任务进行中，跳过');
      return;
    }
    isExtracting = true;
    console.log('[WeRead AI] handleNewChapter 被调用');

    try {
      const result = await extractWithRetry(10, 300);
      if (!result) {
        console.warn('[WeRead AI] 提取失败，更新面板显示错误');
        const debugInfo = showDebugInfo();
        updatePanel(
          { type: 'error', text: '❌ 提取失败（点 🔍 看诊断）' },
          { '来源': '无' },
          debugInfo
        );
        return;
      }

    extractionCount++;
    const { book, chapter: title } = getBookAndChapterTitles();
    const charCount = result.text.length;
    const paraCount = (result.text.match(/\n/g) || []).length + 1;

    console.log('[WeRead AI] 提取结果:', {
      book,
      title,
      source: result.source,
      charCount,
      paraCount
    });
    console.log('[WeRead AI] ====== 提取内容前1000字 ======');
    console.log(result.text.slice(0, 1000));
    console.log('[WeRead AI] ====== 内容结束 ======');

    if (title === currentChapterTitle && result.text === currentChapterText) {
      console.log('[WeRead AI] 重复章节，跳过');
      return;
    }

    currentChapterTitle = title;
    currentChapterText = result.text;

    const validation = validateContent(result.text);
    console.log('[WeRead AI] 内容验证:', validation.checks.join(' | '));

    const statusType = validation.looksValid ? 'success' : 'waiting';
    const statusText = validation.looksValid 
      ? `✅ 第 ${extractionCount} 次成功提取` 
      : `⚠️ 第 ${extractionCount} 次提取（内容可能异常）`;

    console.log('[WeRead AI] 新章节检测，更新面板');
    updatePanel(
      { type: statusType, text: statusText },
      {
        '书名': book,
        '章节': title,
        '来源': result.source,
        '字数': charCount.toLocaleString(),
        '段落': validation.paraCount,
        '验证': validation.looksValid ? '通过' : '需检查',
        '时间': new Date().toLocaleTimeString(),
      },
      result.text.slice(0, 500) + (result.text.length > 500 ? '\n\n... (已截断)' : '')
    );

    console.log(`[WeRead AI] 章节提取成功 #${extractionCount}:`, {
      book, title, source: result.source, charCount, paraCount
    });
    } finally {
      isExtracting = false;
    }
  }

  function startObserving() {
    console.log('[WeRead AI] 启动 MutationObserver...');

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length === 0) continue;

        console.log('[WeRead AI] MutationObserver 触发:', {
          type: mutation.type,
          addedNodes: mutation.addedNodes.length,
          target: mutation.target.tagName + (mutation.target.className ? '.' + mutation.target.className.split(' ')[0] : '')
        });

        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const preRender = node.querySelector?.('.preRenderContainer:not([style])')
            || (node.classList?.contains('preRenderContainer') ? node : null);

          if (preRender) {
            console.log('[WeRead AI] 检测到 preRenderContainer，1.5s 后提取（等 Vue 渲染）');
            setTimeout(handleNewChapter, 1500);
            return;
          }

          if (node.classList?.contains('readerChapterContent')
            || node.querySelector?.('.readerChapterContent')) {
            console.log('[WeRead AI] 检测到 readerChapterContent，1s 后提取');
            setTimeout(handleNewChapter, 1000);
            return;
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    console.log('[WeRead AI] ✓ MutationObserver 已启动，监听 document.documentElement');
  }

  function startPolling() {
    console.log('[WeRead AI] 启动轮询兜底机制（2秒间隔）...');
    let lastTitle = '';
    let pollCount = 0;
    setInterval(() => {
      pollCount++;
      const { chapter: title } = getBookAndChapterTitles();
      if (pollCount % 10 === 0) {
        console.log(`[WeRead AI] 轮询 #${pollCount}: 当前标题="${title}"`);
      }
      if (title && title !== lastTitle && title !== '(未获取到标题)') {
        console.log(`[WeRead AI] 轮询检测到新章节: "${lastTitle}" → "${title}"`);
        lastTitle = title;
        handleNewChapter();
      }
    }, 2000);
  }

  function init() {
    console.log('[WeRead AI] ========================================');
    console.log('[WeRead AI] WeRead AI Reader 验证脚本启动');
    console.log('[WeRead AI] ========================================');
    console.log('[WeRead AI] URL:', location.href);
    console.log('[WeRead AI] document.readyState:', document.readyState);

    if (!location.href.includes('weread.qq.com/web/reader/')) {
      console.log('[WeRead AI] 非阅读器页面，跳过');
      return;
    }

    createPanel();
    console.log('[WeRead AI] ✓ 验证面板已创建');

    updatePanel(
      { type: 'waiting', text: '⏳ 等待章节加载...' },
      { '页面': location.href.split('/').pop() },
      '请打开一本书并翻页，观察是否能提取章节内容。'
    );

    setTimeout(() => {
      console.log('[WeRead AI] 延迟 1.5s 后启动监听...');
      startObserving();
      startPolling();
      console.log('[WeRead AI] 立即尝试一次提取（处理已加载的章节）');
      handleNewChapter();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    console.log('[WeRead AI] DOM 未就绪，等待 DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', init);
  } else {
    console.log('[WeRead AI] DOM 已就绪，直接初始化');
    init();
  }
})();
