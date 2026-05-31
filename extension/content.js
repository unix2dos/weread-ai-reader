(function () {
  'use strict';

  let currentChapterTitle = '';
  let currentChapterKey = '';
  let currentChapterText = '';
  let extractionCount = 0;
  let isExtracting = false;
  let currentSnapshotId = '';
  let judgementPort = null;
  let canvasTextItems = [];
  let lastCanvasSummary = null;
  let lastFullRequestText = '';
  let lastSignalPanel = null;
  let chapterCapture = null;
  let lastCaptureMode = 'active-visible';
  let lastCaptureStats = {};
  let lastExpectedChapterWordCount = 0;

  const MAX_CANVAS_TEXT_ITEMS = 12000;
  const CANVAS_BATCH_EVENT = '__wereadAiCanvasTextBatch';
  const CANVAS_REQUEST_EVENT = '__wereadAiRequestCanvasText';

  function log(level, message, data) {
    const prefix = '[WeRead AI]';
    if (data !== undefined) {
      console[level](`${prefix} ${message} ${safeJson(data)}`);
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
          <button class="wap-btn wap-analyze" title="重新生成阅读判断">重新判断</button>
          <button class="wap-btn wap-toggle" title="最小化">-</button>
        </div>
      </div>
      <div class="wap-body">
        <div class="wap-status">等待章节加载...</div>
        <div class="wap-judgement"></div>
        <div class="wap-signal-panel"></div>
        <details class="wap-debug">
          <summary>调试</summary>
          <div class="wap-debug-actions">
            <button class="wap-debug-copy" type="button" disabled>复制完整请求</button>
            <span class="wap-debug-copy-status"></span>
          </div>
          <div class="wap-debug-label">摘要</div>
          <pre class="wap-debug-content">暂无请求</pre>
          <details class="wap-full-request">
            <summary>完整请求</summary>
            <pre class="wap-full-request-content">暂无完整请求</pre>
          </details>
        </details>
      </div>
    `;

    document.body.appendChild(panel);

    const toggleButton = panel.querySelector('.wap-toggle');
    toggleButton.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      toggleButton.textContent = collapsed ? '+' : '-';
      toggleButton.title = collapsed ? '展开' : '最小化';
    });

    panel.querySelector('.wap-analyze').addEventListener('click', () => {
      currentSnapshotId = '';
      currentChapterTitle = '';
      currentChapterKey = '';
      currentChapterText = '';
      handleNewChapter({ force: true });
    });

    panel.querySelector('.wap-debug-copy').addEventListener('click', copyFullRequest);

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
    lastExpectedChapterWordCount = Number(signalPanel.chapter?.wordCount || 0) || 0;

    el.innerHTML = `
      <div class="wap-section">
        <div class="wap-section-title">信号面板</div>
        <div class="wap-meta">章节: ${escapeHtml(signalPanel.chapter?.title || '')}</div>
        <div class="wap-meta">热门划线: ${bestBookmarks.length} 条 · 划线评论: ${countComments(bookmarkReviews)} 条 · 书评: ${bookReviews.length} 条</div>
        ${renderCaptureMeta(signalPanel.chapter)}
        ${renderAdviceScopeMeta(signalPanel.chapter)}
        ${renderWarnings(warnings)}
        ${renderHighlightEvidence(bestBookmarks, bookmarkReviews)}
        ${renderBookReviews(bookReviews)}
      </div>
    `;
  }

  function renderHighlightEvidence(bestBookmarks, bookmarkReviews) {
    if (bestBookmarks.length === 0) return '<div class="wap-hint">暂无本章热门划线</div>';
    const reviewsByRange = buildReviewsByRange(bookmarkReviews);
    return `
      <div class="wap-section-title">热门划线</div>
      <ul class="wap-highlights">
        ${bestBookmarks.slice(0, 5).map((item) => {
          const review = reviewsByRange.get(item.range);
          return `
          <li class="wap-highlight-item">
            <div class="wap-highlight-row">
              <span class="wap-hl-text">${escapeHtml(item.markText)}</span>
              <span class="wap-hl-count">${Number(item.totalCount || 0)}人</span>
            </div>
            ${renderHighlightComments(review)}
          </li>
        `;
        }).join('')}
      </ul>
    `;
  }

  function buildReviewsByRange(bookmarkReviews) {
    return new Map((bookmarkReviews || [])
      .filter((item) => item.range)
      .map((item) => [item.range, item]));
  }

  function renderHighlightComments(review) {
    if (!review || !review.comments || review.comments.length === 0) {
      return '<div class="wap-hl-no-comments">暂无划线评论</div>';
    }
    return `
      <div class="wap-highlight-comments">
        <div class="wap-meta">评论 ${Number(review.totalCount || review.comments.length)} 条</div>
        <ul class="wap-comments">
          ${review.comments.slice(0, 3).map((comment) => `<li>${escapeHtml(comment)}</li>`).join('')}
        </ul>
      </div>
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

  function renderCaptureMeta(chapter) {
    const capturedLength = currentChapterText.length;
    if (!capturedLength) return '';

    const wordCount = Number(chapter?.wordCount || 0);
    const coverage = wordCount ? ` · 约 ${Math.min(100, Math.round((capturedLength / wordCount) * 100))}%` : '';
    const officialCount = wordCount ? ` / 官方 ${wordCount.toLocaleString()} 字` : '';
    return `<div class="wap-meta">正文采集: ${escapeHtml(labelCaptureMode(lastCaptureMode))} · ${capturedLength.toLocaleString()} 字${officialCount}${coverage}</div>`;
  }

  function renderAdviceScopeMeta(chapter) {
    const text = buildAdviceScopeText(Number(chapter?.wordCount || 0), currentChapterText.length, lastCaptureMode);
    return text ? `<div class="wap-meta">建议范围: ${escapeHtml(text)}</div>` : '';
  }

  function updateJudgementLoading(text) {
    const el = document.querySelector('#weread-ai-panel .wap-judgement');
    if (!el) return;
    el.innerHTML = `
      <div class="wap-section wap-judgement-card">
        <div class="wap-section-title">阅读判断</div>
        <div class="wap-loading">${escapeHtml(text)}</div>
      </div>
    `;
  }

  function appendJudgementDelta(text) {
    const el = document.querySelector('#weread-ai-panel .wap-judgement');
    if (!el) return;
    let streamEl = el.querySelector('.wap-judgement-stream');
    if (!streamEl) {
      el.innerHTML = `
        <div class="wap-section wap-judgement-card">
          <div class="wap-section-title">阅读判断</div>
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
    const adviceScope = buildAdviceScopeText(lastExpectedChapterWordCount, currentChapterText.length, lastCaptureMode) || '实时建议';
    el.innerHTML = `
      <div class="wap-section wap-judgement-card">
        <div class="wap-judgement-heading">
          <div class="wap-section-title">阅读判断</div>
          <span class="wap-scope-badge">${escapeHtml(adviceScope)}</span>
        </div>
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

  function updateFullRequestDebug(fullRequest) {
    const contentEl = document.querySelector('#weread-ai-panel .wap-full-request-content');
    const copyButton = document.querySelector('#weread-ai-panel .wap-debug-copy');
    const statusEl = document.querySelector('#weread-ai-panel .wap-debug-copy-status');

    if (!fullRequest) {
      lastFullRequestText = '';
      if (contentEl) contentEl.textContent = '暂无完整请求';
      if (copyButton) copyButton.disabled = true;
      if (statusEl) statusEl.textContent = '';
      return;
    }

    lastFullRequestText = JSON.stringify(fullRequest, null, 2);
    if (contentEl) contentEl.textContent = lastFullRequestText;
    if (copyButton) copyButton.disabled = false;
    if (statusEl) statusEl.textContent = '';
  }

  async function copyFullRequest() {
    const statusEl = document.querySelector('#weread-ai-panel .wap-debug-copy-status');
    if (!lastFullRequestText) {
      if (statusEl) statusEl.textContent = '暂无内容';
      return;
    }

    try {
      await writeClipboard(lastFullRequestText);
      if (statusEl) statusEl.textContent = '已复制';
    } catch (err) {
      log('warn', '复制完整请求失败', { message: err.message });
      if (statusEl) statusEl.textContent = '复制失败';
    }
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    if (!ok) throw new Error('execCommand copy failed');
  }

  function extractChapterContent() {
    log('log', '尝试提取章节内容...');

    const canvasText = extractCanvasCapturedText();
    if (canvasText) {
      log('log', 'canvas captured text', {
        itemCount: canvasTextItems.length,
        textLen: canvasText.text.length,
        lineCount: canvasText.lineCount
      });
      return canvasText;
    }

    const preRender = document.querySelector('#preRenderContent');
    if (preRender) {
      const html = preRender.innerHTML || '';
      const text = cleanText(stripHtml(html));
      const result = buildValidatedTextResult('#preRenderContent', html, text);
      if (result) return result;
    }

    const readerContent = document.querySelector('.readerChapterContent');
    if (readerContent) {
      const html = readerContent.innerHTML || '';
      const text = cleanText(readerContent.innerText?.trim() || stripHtml(html));
      const result = buildValidatedTextResult('.readerChapterContent', html, text);
      if (result) return result;
    }

    const vue = getVue();
    if (vue) {
      const html = vue.chapterContentHtml || vue.chapterContentForEPub || '';
      if (html.length > 0) {
        const result = buildValidatedTextResult('vue.__vue__', html, cleanText(stripHtml(html)));
        if (result) return result;
      }
    }

    log('warn', '所有提取方式均失败');
    return null;
  }

  function installCanvasTextBridge() {
    document.addEventListener(CANVAS_BATCH_EVENT, (event) => {
      try {
        const payload = JSON.parse(event.detail || '{}');
        if (!Array.isArray(payload.items)) return;
        canvasTextItems = payload.items.slice(-MAX_CANVAS_TEXT_ITEMS);
        log('log', 'canvas text batch received', {
          itemCount: canvasTextItems.length,
          total: payload.total,
          emittedAt: payload.emittedAt
        });
      } catch (err) {
        log('warn', 'canvas text batch parse failed', err);
      }
    });
  }

  function requestCanvasTextDump() {
    document.dispatchEvent(new CustomEvent(CANVAS_REQUEST_EVENT));
  }

  function extractCanvasCapturedText() {
    const lines = buildCanvasLines(canvasTextItems);
    const text = lines.join('\n').trim();
    lastCanvasSummary = summarizeCanvasCapture(lines, text);
    if (!looksLikeChapterText(text)) return null;
    return {
      source: 'canvas.fillText',
      html: '',
      text,
      lineCount: lines.length
    };
  }

  function buildCanvasLines(items) {
    const ordered = (items || [])
      .map(normalizeCanvasItem)
      .filter((item) => item && isLikelyCanvasToken(item.text))
      .sort((a, b) => a.seq - b.seq);

    const rawLines = [];
    let current = null;
    for (const item of ordered) {
      if (!current || shouldStartCanvasLine(current, item)) {
        pushCanvasLine(rawLines, current);
        current = {
          text: item.text,
          y: item.y,
          lastX: item.x,
          seq: item.seq
        };
      } else {
        current.text = mergeCanvasText(current.text, item.text);
        current.lastX = item.x;
      }
    }
    pushCanvasLine(rawLines, current);

    const seen = new Set();
    return rawLines
      .map((line) => cleanReaderLine(line))
      .filter((line) => line && isLikelyReaderText(line))
      .filter((line) => {
        const key = line.replace(/\s+/g, '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function normalizeCanvasItem(item) {
    const text = cleanReaderLine(item?.text || '');
    if (!text) return null;
    return {
      seq: Number(item.seq) || 0,
      text,
      x: (Number(item.x) || 0) + (Number(item.tx) || 0),
      y: (Number(item.y) || 0) + (Number(item.ty) || 0)
    };
  }

  function shouldStartCanvasLine(current, item) {
    if (Math.abs(current.y - item.y) > 3) return true;
    if (item.x < current.lastX - 20) return true;
    if (current.text.length > 220) return true;
    return false;
  }

  function pushCanvasLine(lines, line) {
    if (!line) return;
    const text = cleanReaderLine(line.text);
    if (text) lines.push(text);
  }

  function mergeCanvasText(left, right) {
    if (!left) return right;
    if (!right) return left;
    if (/[\w)]$/.test(left) && /^[\w(]/.test(right)) return `${left} ${right}`;
    return `${left}${right}`;
  }

  function cleanReaderLine(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u200b-\u200f\ufeff]/g, '')
      .trim();
  }

  function isLikelyReaderText(text) {
    if (!text || text.length < 2) return false;
    if (!/[\u4e00-\u9fff]/.test(text)) return false;
    if (/font-family|background-image|readerChapterContent|wr_whiteTheme|border-bottom|rgb\(/.test(text)) return false;
    if (/^(微信读书书城|首页|我的书架|上一页|下一页|点击添加书签|播放|暂停|目录|推荐|一般|不行)$/.test(text)) return false;
    if (/^(已读到|共\d+条笔记|时长\d+分钟|微信读书推荐值|阅读\d)/.test(text)) return false;
    return true;
  }

  function isLikelyCanvasToken(text) {
    if (!text) return false;
    if (/font-family|background-image|readerChapterContent|wr_whiteTheme|border-bottom|rgb\(/.test(text)) return false;
    return /[\u4e00-\u9fffA-Za-z0-9。，、；：？！“”‘’《》（）()—…]/.test(text);
  }

  function looksLikeChapterText(text) {
    const validation = validateContent(text);
    return text.length >= 120 && validation.looksValid;
  }

  function buildValidatedTextResult(source, html, text) {
    const validation = validateContent(text);
    const summary = {
      htmlLen: html.length,
      textLen: text.length,
      validation,
      preview: previewText(text)
    };
    if (looksLikeChapterText(text)) {
      log('log', `${source} accepted`, summary);
      return { source, html, text };
    }
    log('warn', `${source} rejected`, summary);
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
        requestCanvasTextDump();
        setTimeout(() => {
          const result = extractChapterContent();
          if (result && result.text.length > 10) {
            log('log', `第 ${attempts} 次尝试成功`, {
              source: result.source,
              textLen: result.text.length,
              canvas: lastCanvasSummary
            });
            resolve(result);
          } else if (attempts < maxRetries) {
            setTimeout(tryExtract, delay);
          } else {
            resolve(null);
          }
        }, 80);
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
    const chapterEl = document.querySelector('.readerTopBar_title_chapter')
      || document.querySelector('.renderTargetPageInfo_header_chapterTitle')
      || document.querySelector('.readerCatalog_list_item_current .readerCatalog_list_item_title_text');
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

  function updatePassiveChapterCapture({ bookId, bookTitle, chapterUid, chapterTitle, visibleText }) {
    const key = buildChapterCaptureKey({ bookId, chapterUid, chapterTitle });
    const now = new Date().toISOString();
    if (!chapterCapture || chapterCapture.key !== key) {
      chapterCapture = {
        key,
        bookId,
        bookTitle,
        chapterUid,
        chapterTitle,
        lines: [],
        lineKeys: new Set(),
        segmentCount: 0,
        lastVisibleKey: '',
        startedAt: now,
        updatedAt: now
      };
    }

    chapterCapture.updatedAt = now;

    const visibleKey = fingerprintLine(visibleText);
    const isNewVisibleSegment = visibleKey && visibleKey !== chapterCapture.lastVisibleKey;
    if (isNewVisibleSegment) {
      chapterCapture.segmentCount += 1;
      chapterCapture.lastVisibleKey = visibleKey;
    }

    const visibleLines = splitChapterLines(visibleText);
    let addedLineCount = 0;
    if (isNewVisibleSegment) {
      for (const line of visibleLines) {
        const key = fingerprintLine(line);
        if (!key || chapterCapture.lineKeys.has(key)) continue;
        chapterCapture.lineKeys.add(key);
        chapterCapture.lines.push(line);
        addedLineCount += 1;
      }
    }

    const text = chapterCapture.lines.join('\n').trim() || visibleText;
    const mode = chapterCapture.segmentCount > 1 || text.length > visibleText.length
      ? 'passive-accumulated'
      : 'active-visible';
    const stats = {
      visibleTextLength: visibleText.length,
      accumulatedTextLength: text.length,
      segmentCount: chapterCapture.segmentCount,
      uniqueLineCount: chapterCapture.lines.length,
      addedLineCount,
      startedAt: chapterCapture.startedAt,
      updatedAt: chapterCapture.updatedAt
    };

    log('log', 'chapter capture updated', { mode, ...stats });
    return { mode, stats, text };
  }

  function buildChapterCaptureKey({ bookId, chapterUid, chapterTitle }) {
    return [bookId || '', chapterUid || chapterTitle || ''].join(':');
  }

  function splitChapterLines(text) {
    return String(text || '')
      .split(/\n+/)
      .map(cleanReaderLine)
      .filter((line) => line && isLikelyReaderText(line));
  }

  function fingerprintLine(line) {
    return cleanReaderLine(line).replace(/\s+/g, '');
  }

  async function handleNewChapter(options = {}) {
    if (isExtracting) {
      log('log', '已有提取任务进行中，跳过');
      return;
    }
    isExtracting = true;

    try {
      const result = await extractWithRetry(10, 300);
      if (!result) {
        updateStatus('error', '提取失败');
        updateDebug({
          error: 'extraction_failed',
          canvas: lastCanvasSummary,
          bodyPreview: previewText(cleanText(document.body.innerText || ''))
        });
        updateFullRequestDebug(null);
        return;
      }

      const { bookTitle, chapterTitle, chapterUid } = getBookAndChapter();
      const bookId = getBookId();
      const capture = updatePassiveChapterCapture({
        bookId,
        bookTitle,
        chapterUid,
        chapterTitle,
        visibleText: result.text
      });
      const chapterText = capture.text;
      const chapterKey = buildChapterCaptureKey({ bookId, chapterUid, chapterTitle });

      if (!options.force && chapterKey === currentChapterKey && chapterText === currentChapterText) {
        log('log', '重复章节，跳过');
        return;
      }

      if (!options.force && chapterKey === currentChapterKey) {
        currentChapterText = chapterText;
        lastCaptureMode = capture.mode;
        lastCaptureStats = capture.stats;
        updateSameChapterCaptureStatus({ chapterTitle, capture });
        if (lastSignalPanel) {
          updateSignalPanel(lastSignalPanel);
        }
        return;
      }

      currentChapterTitle = chapterTitle;
      currentChapterKey = chapterKey;
      currentChapterText = chapterText;
      lastCaptureMode = capture.mode;
      lastCaptureStats = capture.stats;
      extractionCount++;

      const validation = validateContent(chapterText);
      updateStatus(validation.looksValid ? 'success' : 'waiting', `${chapterTitle} · ${formatCaptureLength(chapterText.length, capture)}`);

      const snapshot = await buildReadingSnapshot({
        bookId,
        bookTitle,
        chapterUid,
        chapterTitle,
        chapterText,
        source: result.source,
        captureMode: capture.mode,
        captureStats: capture.stats
      });

      updateDebug(buildClientDebug(snapshot));
      updateFullRequestDebug(null);
      await uploadSnapshot(snapshot);
      log('log', `章节处理完成 #${extractionCount}`);
    } catch (err) {
      log('error', '章节处理失败', err);
      updateStatus('error', `Agent 请求失败: ${err.message}`);
    } finally {
      isExtracting = false;
    }
  }

  async function buildReadingSnapshot({ bookId, bookTitle, chapterUid, chapterTitle, chapterText, source, captureMode, captureStats }) {
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
      captureMode,
      captureStats,
      agentServerUrl: normalizeServerUrl(agentConfig.serverUrl)
    };
  }

  function updateSameChapterCaptureStatus({ chapterTitle, capture }) {
    log('log', 'same_chapter_capture_updated', {
      chapterTitle,
      mode: capture.mode,
      textLength: capture.text.length,
      stats: capture.stats
    });
    updateStatus('success', `${chapterTitle} · ${formatCaptureLength(capture.text.length, capture)} · 采集已更新，可手动重新判断`);
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
    lastSignalPanel = body.signalPanel;
    updateSignalPanel(body.signalPanel);
    updateStatus('success', `已发送 ${formatCaptureLength(snapshot.chapterText.length, snapshot)}，正在生成阅读判断...`);
    updateFullRequestDebug(buildFullRequestDebug(snapshot, body));
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

    updateJudgementLoading('正在生成阅读判断...');
    judgementPort = chrome.runtime.connect({ name: 'judgement-stream' });
    judgementPort.onMessage.addListener((message) => {
      if (message.type !== 'sse') return;
      if (message.event === 'start') {
        updateJudgementLoading('阅读判断流已连接...');
      } else if (message.event === 'delta') {
        appendJudgementDelta(message.data.text || '');
      } else if (message.event === 'complete') {
        renderJudgement(message.data.judgement || {});
        updateStatus('success', `${currentChapterTitle} · ${formatCaptureLength(currentChapterText.length, { mode: lastCaptureMode, stats: lastCaptureStats })} · 判断完成`);
        judgementPort.disconnect();
        judgementPort = null;
      } else if (message.event === 'error') {
        const data = message.data || {};
        updateJudgementLoading(`阅读判断失败: ${data.message || '未知错误'}`);
        updateStatus('error', `阅读判断失败: ${data.message || '未知错误'}`);
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
      agentServerUrl: snapshot.agentServerUrl,
      captureMode: snapshot.captureMode,
      captureStats: snapshot.captureStats,
      canvas: lastCanvasSummary
    };
  }

  function buildFullRequestDebug(snapshot, uploadResponse) {
    const signalPanel = uploadResponse.signalPanel || {};
    const resolvedBookId = signalPanel.debug?.resolvedBookId || snapshot.bookId;
    const promptVersion = 'short-judgement-v1';
    const agentInput = buildAgentInputDebug(snapshot, signalPanel, promptVersion, resolvedBookId);

    return {
      schema: 'weread-ai-agent-request-debug-v1',
      generatedAt: new Date().toISOString(),
      notes: [
        'agentRequest 是服务器实际发给 LLM/Agent 的完整请求，Authorization 已隐藏。',
        '浏览器发送给服务器时已经把 canvas 字符组织成 chapterText 字符串，不会逐字发送。',
        'browserUploadSummary 和 extractionDebug 只保留摘要，避免同一份正文在调试块里重复出现。'
      ],
      browserUploadSummary: {
        method: 'POST',
        url: `${snapshot.agentServerUrl}/api/reading-snapshots`,
        body: summarizeUploadBody(snapshot),
        note: 'background.js 会在发送时追加 clientToken；此处故意不显示 token。'
      },
      judgementStreamRequest: {
        method: 'GET',
        url: `${snapshot.agentServerUrl}/api/reading-snapshots/${uploadResponse.snapshotId}/judgement/stream?clientToken=[hidden]`,
        note: 'SSE 请求的 clientToken 故意隐藏。'
      },
      agentRequest: uploadResponse.agentRequest || buildAgentRequestFallback(agentInput),
      agentInputSummary: summarizeAgentInput(agentInput),
      responseMeta: {
        snapshotId: uploadResponse.snapshotId,
        cache: uploadResponse.cache,
        skillCalls: signalPanel.debug?.skillCalls || [],
        warnings: signalPanel.debug?.warnings || [],
        rawBookId: signalPanel.debug?.rawBookId || snapshot.bookId,
        resolvedBookId,
        agentRequestSource: uploadResponse.agentRequest ? 'server' : 'client-fallback'
      },
      extractionDebug: {
        source: snapshot.source,
        captureMode: snapshot.captureMode,
        captureStats: snapshot.captureStats,
        contentHash: snapshot.contentHash,
        chapterTextLength: snapshot.chapterText.length,
        chapterTextPreview: previewText(snapshot.chapterText),
        canvas: summarizeCanvasDebug(lastCanvasSummary)
      }
    };
  }

  function summarizeUploadBody(snapshot) {
    const body = stripLocalOnlyFields(snapshot);
    return {
      ...body,
      chapterText: `[${snapshot.chapterText.length} chars; exact text is inside agentRequest.body.messages[1].content]`,
      chapterTextLength: snapshot.chapterText.length,
      chapterTextPreview: previewText(snapshot.chapterText)
    };
  }

  function summarizeAgentInput(agentInput) {
    return {
      promptVersion: agentInput.promptVersion,
      task: agentInput.task,
      chapter: {
        ...agentInput.chapter,
        chapterText: `[${agentInput.chapter.chapterText.length} chars; exact text is inside agentRequest.body.messages[1].content]`,
        chapterTextLength: agentInput.chapter.chapterText.length,
        chapterTextPreview: previewText(agentInput.chapter.chapterText)
      },
      signalCounts: {
        bookReviews: agentInput.signals.bookReviews.length,
        bestBookmarks: agentInput.signals.bestBookmarks.length,
        bookmarkReviews: agentInput.signals.bookmarkReviews.length
      },
      outputShape: agentInput.outputShape
    };
  }

  function summarizeCanvasDebug(summary) {
    if (!summary) return null;
    return {
      itemCount: summary.itemCount,
      candidateLineCount: summary.candidateLineCount,
      candidateTextLength: summary.candidateTextLength,
      candidatePreview: summary.candidatePreview
    };
  }

  function buildAgentInputDebug(snapshot, signalPanel, promptVersion, resolvedBookId) {
    return {
      promptVersion,
      task: '结合官方 WeRead Skill 信号和章节正文快照，判断当前章节是否值得精读。',
      chapter: {
        bookId: resolvedBookId,
        rawBookId: snapshot.bookId,
        bookTitle: snapshot.bookTitle,
        chapterUid: signalPanel.chapter?.chapterUid || snapshot.chapterUid,
        chapterTitle: snapshot.chapterTitle,
        expectedWordCount: signalPanel.chapter?.wordCount || null,
        capture: buildCaptureDebug(snapshot, signalPanel),
        chapterText: snapshot.chapterText
      },
      signals: {
        bookReviews: signalPanel.bookReviews || [],
        bestBookmarks: signalPanel.bestBookmarks || [],
        bookmarkReviews: signalPanel.bookmarkReviews || []
      },
      outputShape: {
        conclusion: 'worth_deep_read | quick_read | skip_read',
        reasons: ['2-3 条证据'],
        keyPassages: ['3-5 条热门划线或正文片段'],
        readerPerspective: '评论中的共识、争议、误读或补充',
        readingAction: '接下来精读哪部分、带着什么问题读'
      }
    };
  }

  function buildCaptureDebug(snapshot, signalPanel) {
    const expectedWordCount = Number(signalPanel.chapter?.wordCount || 0) || null;
    const capturedTextLength = snapshot.chapterText.length;
    const coverageRatio = expectedWordCount ? capturedTextLength / expectedWordCount : null;
    const coveragePercent = coverageRatio === null ? null : Math.min(100, Math.round(coverageRatio * 100));
    const status = classifyCaptureCoverage(snapshot.captureMode, coverageRatio);

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
      note: 'passive-accumulated 表示只累计用户自然渲染过的页面内容；可能仍然不是完整章节。',
      instruction: status === 'full'
        ? '可近似视为完整章节正文。'
        : '必须视为部分正文，只能给阶段性判断，不得暗示已读完整章正文。'
    };
  }

  function classifyCaptureCoverage(mode, ratio) {
    if (mode === 'server-skill') return 'full';
    if (ratio !== null && ratio >= 0.9) return 'full';
    if (ratio !== null && ratio >= 0.6) return 'substantial';
    return 'partial';
  }

  function buildAgentRequestFallback(agentInput) {
    return {
      method: 'POST',
      url: '[server-generated-url-unavailable]',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer [hidden]'
      },
      body: {
        stream: true,
        temperature: 0.2,
        messages: [
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
            content: JSON.stringify(agentInput)
          }
        ]
      },
      note: '服务器未返回精确 LLM 请求时的前端兜底调试体。'
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

  function labelCaptureMode(value) {
    if (value === 'passive-accumulated') return '被动累计';
    if (value === 'server-skill') return '服务器正文';
    if (value === 'background-clone') return '后台副本';
    return '当前可见';
  }

  function buildAdviceScopeText(expectedWordCount, capturedLength, mode) {
    if (!capturedLength) return '';
    const ratio = expectedWordCount ? capturedLength / expectedWordCount : null;
    const status = classifyCaptureCoverage(mode, ratio);
    if (status === 'full') return '章节级建议';
    if (status === 'substantial') return `阶段性建议，正文覆盖约 ${Math.round(ratio * 100)}%`;
    if (ratio !== null) return `阶段性建议，正文覆盖约 ${Math.round(ratio * 100)}%`;
    return '阶段性建议，正文覆盖率未知';
  }

  function formatCaptureLength(length, capture) {
    const mode = capture?.captureMode || capture?.mode || lastCaptureMode;
    const stats = capture?.captureStats || capture?.stats || lastCaptureStats;
    const segmentSuffix = Number(stats?.segmentCount || 0) > 1 ? ` · ${Number(stats.segmentCount)} 段` : '';
    return `${length.toLocaleString()} 字 · ${labelCaptureMode(mode)}${segmentSuffix}`;
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

  function summarizeCanvasCapture(lines, text) {
    return {
      itemCount: canvasTextItems.length,
      candidateLineCount: lines.length,
      candidateTextLength: text.length,
      candidatePreview: previewText(text),
      sampleItems: canvasTextItems.slice(0, 20).map(summarizeCanvasItem),
      tailItems: canvasTextItems.slice(-20).map(summarizeCanvasItem)
    };
  }

  function summarizeCanvasItem(item) {
    return {
      seq: item.seq,
      text: item.text,
      x: item.x,
      y: item.y,
      tx: item.tx,
      ty: item.ty
    };
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function init() {
    if (!location.href.includes('weread.qq.com/web/reader/')) return;
    installCanvasTextBridge();
    createPanel();
    setTimeout(() => {
      requestCanvasTextDump();
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
