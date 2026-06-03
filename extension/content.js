(function () {
  'use strict';

  let currentChapterTitle = '';
  let currentChapterKey = '';
  let currentChapterText = '';
  let extractionCount = 0;
  let isExtracting = false;
  let judgementPort = null;
  let canvasTextItems = [];
  let lastCanvasSummary = null;
  let lastSignalPanel = null;
  let chapterCapture = null;
  let lastCaptureMode = 'active-visible';
  let lastCaptureStats = {};
  let lastExpectedChapterWordCount = 0;
  let latestSummaryState = {
    status: { type: 'waiting', text: '等待章节加载...' },
    streamText: ''
  };

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

  function installRuntimeMessageHandlers() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type !== 'REQUEST_CURRENT_CHAPTER_JUDGEMENT') return false;
      requestCurrentChapterJudgement().then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, error: { message: err.message } })
      );
      return true;
    });
  }

  async function requestCurrentChapterJudgement() {
    currentChapterTitle = '';
    currentChapterKey = '';
    currentChapterText = '';
    await handleNewChapter({ force: true });
  }

  function installKeyboardShortcuts() {
    const handleShortcut = (event) => {
      if (!(event.altKey && event.code === 'KeyQ')) return;
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return;
      event.preventDefault();
      openSummaryWindow();
    };

    window.addEventListener('keydown', handleShortcut, true);
  }

  function openSummaryWindow() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({ type: 'OPEN_SUMMARY_WINDOW' }).catch((err) => {
      log('warn', '打开摘要窗口失败', { message: err.message });
    });
  }

  function publishSummaryState(patch) {
    latestSummaryState = {
      ...latestSummaryState,
      ...patch,
      status: {
        ...(latestSummaryState.status || {}),
        ...(patch.status || {})
      },
      updatedAt: new Date().toISOString()
    };

    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({
      type: 'UPDATE_SUMMARY_STATE',
      patch: latestSummaryState
    }).catch((err) => {
      log('warn', '同步摘要状态失败', { message: err.message });
    });
  }

  function updateStatus(type, text) {
    publishSummaryState({ status: { type, text } });
  }

  function formatChapterProgress(chapterTitle, message) {
    return `${chapterTitle || '当前章节'} · ${message}`;
  }

  function updateSignalPanel(signalPanel) {
    lastExpectedChapterWordCount = Number(signalPanel.chapter?.wordCount || 0) || 0;
    publishSummaryState({
      signalPanel:
        signalPanel
    });
  }

  function updateJudgementLoading(text) {
    publishSummaryState({
      status: { type: 'waiting', text },
      streamText: '',
      readingJudgement: null
    });
  }

  function appendJudgementDelta(text) {
    publishSummaryState({
      streamText:
        `${latestSummaryState.streamText || ''}${text}`
    });
  }

  function renderJudgement(judgement) {
    publishSummaryState({
      readingJudgement:
        normalizeReadingJudgement(judgement),
      streamText: ''
    });
  }

  function hasNumericScore(value) {
    if (value === null || value === undefined || value === '') return false;
    const number = Number(value);
    return Number.isFinite(number);
  }

  function updateDebug(summary) {
    publishSummaryState({ debug: summary });
  }

  function updateFullRequestDebug(fullRequest) {
    if (!fullRequest) {
      publishSummaryState({ fullRequest: null });
      return;
    }

    publishSummaryState({ fullRequest });
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
      publishSummaryState({
        bookTitle,
        chapterTitle,
        capture: buildSummaryCapture({
          chapterText,
          captureMode: capture.mode,
          captureStats: capture.stats
        }),
        signalPanel: null,
        readingJudgement: null,
        streamText: ''
      });

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

  function buildSummaryCapture(snapshot, signalPanel = null) {
    return {
      mode: snapshot.captureMode,
      stats: snapshot.captureStats || {},
      textLength: snapshot.chapterText.length,
      expectedWordCount: Number(signalPanel?.chapter?.wordCount || 0) || null
    };
  }

  function updateSameChapterCaptureStatus({ chapterTitle, capture }) {
    log('log', 'same_chapter_capture_updated', {
      chapterTitle,
      mode: capture.mode,
      textLength: capture.text.length,
      stats: capture.stats
    });
    updateStatus('success', `${chapterTitle} · ${formatCaptureLength(capture.text.length, capture)} · 采集已更新，可点本章判断`);
    publishSummaryState({
      chapterTitle,
      capture: {
        mode: capture.mode,
        stats: capture.stats,
        textLength: capture.text.length,
        expectedWordCount: lastExpectedChapterWordCount || null
      }
    });
  }

  async function uploadSnapshot(snapshot) {
    updateStatus('waiting', formatChapterProgress(snapshot.chapterTitle, '正在发送阅读快照...'));

    const response = await chrome.runtime.sendMessage({
      type: 'UPLOAD_READING_SNAPSHOT',
      data: stripLocalOnlyFields(snapshot)
    });

    if (!response?.ok) {
      throw new Error(response?.error?.message || '上传阅读快照失败');
    }

    const body = response.body;
    lastSignalPanel = body.signalPanel;
    publishSummaryState({
      bookTitle: snapshot.bookTitle,
      chapterTitle: snapshot.chapterTitle,
      snapshotId: body.snapshotId,
      cache: body.cache,
      capture: buildSummaryCapture(snapshot, body.signalPanel),
      signalPanel:
        body.signalPanel
    });
    updateSignalPanel(body.signalPanel);
    updateStatus('success', formatChapterProgress(snapshot.chapterTitle, `已发送 ${formatCaptureLength(snapshot.chapterText.length, snapshot)}，正在生成阅读判断...`));
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

    updateJudgementLoading(formatChapterProgress(currentChapterTitle, '正在生成阅读判断...'));
    judgementPort = chrome.runtime.connect({ name: 'judgement-stream' });
    judgementPort.onMessage.addListener((message) => {
      if (message.type !== 'sse') return;
      if (message.event === 'start') {
        updateJudgementLoading(formatChapterProgress(currentChapterTitle, '阅读判断流已连接...'));
      } else if (message.event === 'delta') {
        appendJudgementDelta(message.data.text || '');
      } else if (message.event === 'complete') {
        renderJudgement(message.data);
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

  function normalizeReadingJudgement(data) {
    const judgement = data?.readingJudgement || data?.judgement || data || {};
    return {
      recommendation: judgement.recommendation || fromLegacyConclusion(judgement.conclusion),
      masteryScore: judgement.masteryScore || null,
      nextMustKnow: judgement.nextMustKnow || [],
      reasons: judgement.reasons || [],
      evidenceSnippets: judgement.evidenceSnippets || judgement.keyPassages || [],
      questionsForAuthor: judgement.questionsForAuthor || [],
      readerPerspective: judgement.readerPerspective || '',
      readingAdvice: judgement.readingAdvice || judgement.readingAction || '',
      schemaWarning: buildJudgementSchemaWarning(data, judgement)
    };
  }

  function buildJudgementSchemaWarning(data, judgement) {
    if (!data?.readingJudgement) {
      return data?.judgement
        ? '服务端返回旧格式，只能显示阅读结论；请重启本地服务后重新生成。'
        : '未收到结构化阅读判断；请重新生成本章判断。';
    }

    const missing = [];
    if (!hasNumericScore(judgement.masteryScore?.overall)) missing.push('收获价值分');
    if (!judgement.nextMustKnow?.length) missing.push('能带走的收获');
    if (!judgement.reasons?.length) missing.push('理由');
    if (!(judgement.evidenceSnippets || judgement.keyPassages)?.length) missing.push('证据片段');
    if (!judgement.questionsForAuthor?.length) missing.push('带着读的问题');
    if (!judgement.readerPerspective?.trim()) missing.push('读者视角');
    if (!judgement.readingAdvice?.trim()) missing.push('阅读建议');
    return missing.length ? `模型返回缺少结构化字段：${missing.join('、')}；请重新生成本章判断。` : '';
  }

  function fromLegacyConclusion(value) {
    if (value === 'worth_deep_read') return 'deep_read';
    if (value === 'skip_read') return 'skip_read';
    return 'quick_read';
  }

  function getAgentConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_AGENT_CONFIG' }, (response) => {
        if (chrome.runtime.lastError || !response?.agentConfig) {
          resolve({ serverUrl: 'http://127.0.0.1:19763', clientToken: 'dev-token' });
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
    const promptVersion = 'reading-strategy-v3';
    const hasServerAgentRequest = Boolean(uploadResponse.agentRequest);
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
        body: summarizeUploadBody(snapshot, hasServerAgentRequest),
        note: 'background.js 会在发送时追加 clientToken；此处故意不显示 token。'
      },
      judgementStreamRequest: {
        method: 'GET',
        url: `${snapshot.agentServerUrl}/api/reading-snapshots/${uploadResponse.snapshotId}/judgement/stream?clientToken=[hidden]`,
        note: 'SSE 请求的 clientToken 故意隐藏。'
      },
      agentRequest: uploadResponse.agentRequest || {
        unavailable: true,
        note: '服务器未返回实际 LLM 请求；前端只展示 agentInputSummary，避免重建可能漂移的请求体。'
      },
      agentInputSummary: summarizeAgentInput(agentInput, hasServerAgentRequest),
      responseMeta: {
        snapshotId: uploadResponse.snapshotId,
        cache: uploadResponse.cache,
        skillCalls: signalPanel.debug?.skillCalls || [],
        warnings: signalPanel.debug?.warnings || [],
        rawBookId: signalPanel.debug?.rawBookId || snapshot.bookId,
        resolvedBookId,
        agentRequestSource: uploadResponse.agentRequest ? 'server' : 'unavailable-summary'
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

  function summarizeUploadBody(snapshot, hasServerAgentRequest) {
    const body = stripLocalOnlyFields(snapshot);
    return {
      ...body,
      chapterText: summarizeChapterText(snapshot.chapterText.length, hasServerAgentRequest),
      chapterTextLength: snapshot.chapterText.length,
      chapterTextPreview: previewText(snapshot.chapterText)
    };
  }

  function summarizeAgentInput(agentInput, hasServerAgentRequest) {
    const publicSignals = agentInput.signals.publicSignals || {};
    return {
      promptVersion: agentInput.promptVersion,
      task: agentInput.task,
      chapter: {
        ...agentInput.chapter,
        chapterText: summarizeChapterText(agentInput.chapter.chapterText.length, hasServerAgentRequest),
        chapterTextLength: agentInput.chapter.chapterText.length,
        chapterTextPreview: previewText(agentInput.chapter.chapterText)
      },
      signalCounts: {
        bookReviews: (publicSignals.bookReviews || []).length,
        bestBookmarks: (publicSignals.bestBookmarks || []).length,
        bookmarkReviews: (publicSignals.bookmarkReviews || []).length
      },
      outputShape: agentInput.outputShape
    };
  }

  function summarizeChapterText(placeholderLength, hasServerAgentRequest) {
    if (hasServerAgentRequest) {
      return `[${placeholderLength} chars; exact text is inside agentRequest.body.messages[1].content]`;
    }
    return `[${placeholderLength} chars; exact text omitted from debug summary]`;
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
      task: '判断当前章节读完能带走什么可靠收获，并给出精读、快读或跳读建议。',
      chapter: {
        bookId: resolvedBookId,
        rawBookId: snapshot.bookId,
        bookTitle: snapshot.bookTitle,
        chapterIdx: signalPanel.chapter?.chapterIdx,
        chapterUid: signalPanel.chapter?.chapterUid || snapshot.chapterUid,
        chapterTitle: snapshot.chapterTitle,
        expectedWordCount: signalPanel.chapter?.wordCount || null,
        capture: buildCaptureDebug(snapshot, signalPanel),
        chapterText: snapshot.chapterText
      },
      signals: {
        bookContext: signalPanel.bookContext || {},
        publicSignals: signalPanel.publicSignals || {
          bestBookmarks: signalPanel.bestBookmarks || [],
          bookmarkReviews: signalPanel.bookmarkReviews || [],
          bookReviews: signalPanel.bookReviews || []
        },
        personalSignals: signalPanel.personalSignals || {
          enabled: false,
          bookmarks: [],
          reviews: [],
          underlines: []
        }
      },
      scoreRubric: {
        masteryScoreOverall: '服务端按固定权重从三个收获价值子分派生，模型输出的 overall 会被忽略',
        weights: {
          takeawayValue: 0.45,
          understandingLeverage: 0.35,
          attentionROI: 0.2
        },
        thresholds: {
          mustDeepRead: '90-100 必须精读，本章是全书理解枢纽',
          deepRead: '80-89 值得精读，但必须说明具体价值来源',
          quickRead: '65-79 快读为主，只精读局部段落',
          skipRead: '0-64 可跳读或只扫结论'
        }
      },
      outputShape: {
        recommendation: 'must_deep_read | deep_read | quick_read | skip_read',
        masteryScore: {
          takeawayValue: '0-100 可带走收获分',
          understandingLeverage: '0-100 理解杠杆分',
          attentionROI: '0-100 投入回报分'
        },
        nextMustKnow: ['1-3 条读完本章能带走的概念、方法、判断框架、关键事实或可迁移理解'],
        reasons: ['1-2 条只基于当前章节与信号的判断依据'],
        evidenceSnippets: ['1-3 条可追溯证据片段'],
        questionsForAuthor: ['1-2 个带着读的问题，只给问题，不要给答案'],
        readerPerspective: '评论中的共识、争议、误读或补充',
        readingAdvice: '一句明确阅读动作，60字内，直接说明精读、快读或跳读怎么做'
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

  function previewText(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 160) return normalized;
    return `${normalized.slice(0, 80)} ... ${normalized.slice(-80)}`;
  }

  function labelCaptureMode(value) {
    if (value === 'passive-accumulated') return '被动累计';
    if (value === 'server-skill') return '服务器正文';
    if (value === 'background-clone') return '后台副本';
    return '当前可见';
  }

  function formatCaptureLength(length, capture) {
    const mode = capture?.captureMode || capture?.mode || lastCaptureMode;
    const stats = capture?.captureStats || capture?.stats || lastCaptureStats;
    const segmentSuffix = Number(stats?.segmentCount || 0) > 1 ? ` · ${Number(stats.segmentCount)} 段` : '';
    return `${length.toLocaleString()} 字 · ${labelCaptureMode(mode)}${segmentSuffix}`;
  }

  function normalizeServerUrl(value) {
    return String(value || 'http://127.0.0.1:19763').replace(/\/+$/, '');
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
    installRuntimeMessageHandlers();
    installKeyboardShortcuts();
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
