(function () {
  'use strict';

  const DEFAULT_STATE = Object.freeze({
    status: { type: 'waiting', text: '等待阅读现场...' },
    bookTitle: '',
    chapterTitle: '',
    capture: null,
    signalPanel: null,
    readingJudgement: null,
    streamText: '',
    debug: null,
    fullRequest: null,
    updatedAt: ''
  });

  let currentState = { ...DEFAULT_STATE };
  let boundsSaveTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    loadInitialState();
    document.querySelector('#summary-analyze')?.addEventListener('click', requestCurrentChapterJudgement);
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type !== 'SUMMARY_STATE_UPDATED') return;
      renderState(message.summaryState || DEFAULT_STATE);
    });

    window.addEventListener('beforeunload', saveWindowBounds);
    boundsSaveTimer = setInterval(saveWindowBounds, 5000);
  }

  async function loadInitialState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SUMMARY_STATE' });
      renderState(response?.summaryState || DEFAULT_STATE);
    } catch (err) {
      renderState({
        ...DEFAULT_STATE,
        status: { type: 'error', text: `读取摘要状态失败: ${err.message}` }
      });
    }
  }

  async function requestCurrentChapterJudgement() {
    const button = document.querySelector('#summary-analyze');
    if (button) button.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'REQUEST_CURRENT_CHAPTER_JUDGEMENT' });
      if (!response?.ok) throw new Error(response?.error?.message || '请求本章判断失败');
    } catch (err) {
      renderState({
        ...currentState,
        status: { type: 'error', text: err.message }
      });
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderState(state) {
    currentState = normalizeSummaryState(state);
    renderStatus(currentState);
    renderContext(currentState);
    renderJudgement(currentState);
    renderEvidence(currentState);
  }

  function renderStatus(state) {
    const statusEl = document.querySelector('#summary-status');
    if (!statusEl) return;
    const status = state.status || DEFAULT_STATE.status;
    statusEl.className = `summary-status ${escapeClassName(status.type || 'waiting')}`;
    statusEl.textContent = status.text || '等待';
  }

  function renderContext(state) {
    const contextEl = document.querySelector('#summary-context');
    if (!contextEl) return;
    const parts = [state.bookTitle, state.chapterTitle].filter(Boolean);
    contextEl.textContent = parts.length ? parts.join(' · ') : '等待阅读现场...';
  }

  function renderJudgement(state) {
    const el = document.querySelector('#summary-judgement');
    if (!el) return;

    if (!state.readingJudgement && state.streamText) {
      el.innerHTML = `
        <div class="summary-card">
          <div class="summary-section-title">阅读判断</div>
          <pre class="summary-stream">${escapeHtml(state.streamText)}</pre>
        </div>
      `;
      return;
    }

    if (!state.readingJudgement) {
      el.innerHTML = '<div class="summary-empty">还没有本章判断</div>';
      return;
    }

    const judgement = normalizeReadingJudgement(state.readingJudgement);
    el.innerHTML = `
      <div class="summary-card">
        <div class="summary-topline">
          <div>
            <div class="summary-section-title">阅读判断</div>
            <div class="summary-verdict">${escapeHtml(labelRecommendation(judgement.recommendation))}</div>
          </div>
          ${renderMasteryScore(judgement.masteryScore)}
        </div>
        ${renderSchemaWarning(judgement.schemaWarning)}
        ${renderList('最需要掌握', judgement.nextMustKnow, 3)}
        ${renderList('追问问题', judgement.questionsForAuthor, 2)}
        ${renderSummaryAction(judgement.readingAdvice)}
        ${renderTextSection('读者视角', judgement.readerPerspective)}
        ${renderList('理由', judgement.reasons, 2)}
        ${renderList('重点段落', judgement.keyPassages, 3)}
      </div>
    `;
  }

  function renderEvidence(state) {
    const el = document.querySelector('#summary-evidence');
    if (!el) return;

    el.innerHTML = `
      ${renderReadingSignals(state)}
      ${renderDebugPanel(state)}
    `;
  }

  function renderReadingSignals(state) {
    const signalPanel = state.signalPanel || {};
    const warnings = signalPanel.debug?.warnings || [];
    const bestBookmarks = signalPanel.bestBookmarks || signalPanel.publicSignals?.bestBookmarks || [];
    const bookmarkReviews = signalPanel.bookmarkReviews || signalPanel.publicSignals?.bookmarkReviews || [];
    const bookReviews = signalPanel.bookReviews || signalPanel.publicSignals?.bookReviews || [];

    return `
      <details class="summary-signals" open>
        <summary>阅读信号</summary>
        <div class="summary-signals-body">
          ${renderCaptureMeta(state, signalPanel)}
          ${renderWarnings(warnings)}
          ${renderHighlightEvidence(bestBookmarks, bookmarkReviews)}
          ${renderBookReviews(bookReviews)}
        </div>
      </details>
    `;
  }

  function renderDebugPanel(state) {
    const debug = state.debug || null;
    const fullRequest = state.fullRequest || null;
    if (!debug && !fullRequest) return '';

    return `
      <details class="summary-debug-panel">
        <summary>调试</summary>
        <div class="summary-debug-body">
          ${debug ? renderDebugBlock('请求摘要（省略正文）', debug, '只展示结构、计数、hash 和截断预览；正文被省略或只保留预览，用来快速检查采集和信号是否正确。') : ''}
          ${fullRequest ? renderDebugBlock('完整请求（LLM messages，密钥隐藏）', fullRequest, '服务器实际构造的 OpenAI 兼容请求；Authorization 已隐藏，但 messages 里可能包含本次发给 LLM 的正文和信号。') : ''}
        </div>
      </details>
    `;
  }

  function normalizeSummaryState(state) {
    return {
      ...DEFAULT_STATE,
      ...(state || {}),
      status: {
        ...DEFAULT_STATE.status,
        ...(state?.status || {})
      }
    };
  }

  function normalizeReadingJudgement(data) {
    const judgement = data?.readingJudgement || data?.judgement || data || {};
    return {
      recommendation: judgement.recommendation || fromLegacyConclusion(judgement.conclusion),
      masteryScore: judgement.masteryScore || null,
      nextMustKnow: judgement.nextMustKnow || [],
      reasons: judgement.reasons || [],
      keyPassages: judgement.keyPassages || [],
      questionsForAuthor: judgement.questionsForAuthor || [],
      readerPerspective: judgement.readerPerspective || '',
      readingAdvice: judgement.readingAdvice || judgement.readingAction || '',
      schemaWarning: judgement.schemaWarning || buildJudgementSchemaWarning(data, judgement)
    };
  }

  function buildJudgementSchemaWarning(data, judgement) {
    if (data?.schemaWarning) return data.schemaWarning;
    if (data?.readingJudgement) return '';
    if (data?.judgement) return '服务端返回旧格式，只能显示阅读结论；请重启本地服务后重新生成。';

    const missing = [];
    if (!hasNumericScore(judgement.masteryScore?.overall)) missing.push('掌握价值分');
    if (!judgement.nextMustKnow?.length) missing.push('最需要掌握');
    if (!judgement.questionsForAuthor?.length) missing.push('追问问题');
    if (!judgement.readingAdvice?.trim() && !judgement.readingAction?.trim()) missing.push('阅读建议');
    return missing.length ? `模型返回缺少结构化字段：${missing.join('、')}；请重新生成本章判断。` : '';
  }

  function renderSchemaWarning(message) {
    if (!message) return '';
    return `<div class="summary-warning">${escapeHtml(message)}</div>`;
  }

  function renderMasteryScore(masteryScore) {
    const score = masteryScore || {};
    if (!hasNumericScore(score.overall)) return '';

    return `
      <div class="summary-score">
        <span class="summary-score-label">掌握价值</span>
        <strong>${escapeHtml(normalizeDisplayScore(score.overall))}</strong>
      </div>
    `;
  }

  function renderList(title, items, limit = 5) {
    const values = (items || []).filter(Boolean).slice(0, limit);
    if (!values.length) return '';
    return `
      <section class="summary-section">
        <div class="summary-section-title">${escapeHtml(title)}</div>
        <ul class="summary-list">
          ${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </section>
    `;
  }

  function renderTextSection(title, text) {
    if (!text || !text.trim()) return '';
    return `
      <section class="summary-section">
        <div class="summary-section-title">${escapeHtml(title)}</div>
        <div class="summary-analysis-content">${escapeHtml(text)}</div>
      </section>
    `;
  }

  function renderSummaryAction(text) {
    if (!text || !text.trim()) return '';
    return `
      <section class="summary-action">
        <div class="summary-section-title">阅读动作</div>
        <div>${escapeHtml(text)}</div>
      </section>
    `;
  }

  function renderCaptureMeta(state, signalPanel) {
    const capture = state.capture || {};
    const chapter = signalPanel.chapter || {};
    const textLength = Number(capture.textLength || capture.capturedTextLength || 0);
    const expectedWordCount = Number(capture.expectedWordCount || chapter.wordCount || 0);
    const coverage = expectedWordCount && textLength
      ? ` · 覆盖约 ${Math.min(100, Math.round((textLength / expectedWordCount) * 100))}%`
      : '';
    const mode = capture.mode || capture.captureMode || '';
    const title = chapter.title || state.chapterTitle || '';

    if (!title && !textLength && !expectedWordCount) return '';
    return `
      <div class="summary-meta">
        ${title ? `章节: ${escapeHtml(title)}<br>` : ''}
        ${textLength ? `正文采集: ${textLength.toLocaleString()} 字${expectedWordCount ? ` / 官方 ${expectedWordCount.toLocaleString()} 字` : ''}${coverage}<br>` : ''}
        ${mode ? `采集方式: ${escapeHtml(labelCaptureMode(mode))}` : ''}
      </div>
    `;
  }

  function renderHighlightEvidence(bestBookmarks, bookmarkReviews) {
    if (!bestBookmarks.length) return '<div class="summary-hint">暂无本章热门划线</div>';
    const reviewsByRange = buildReviewsByRange(bookmarkReviews);
    return `
      <section class="summary-section">
        <div class="summary-section-title">热门划线</div>
        <ul class="summary-list summary-highlights">
          ${bestBookmarks.slice(0, 5).map((item) => {
            const review = reviewsByRange.get(item.range);
            return `
              <li>
                <div class="summary-highlight-row">
                  <span>${escapeHtml(item.markText)}</span>
                  <small>${Number(item.totalCount || 0)}人</small>
                </div>
                ${renderHighlightComments(review)}
              </li>
            `;
          }).join('')}
        </ul>
      </section>
    `;
  }

  function buildReviewsByRange(bookmarkReviews) {
    return new Map((bookmarkReviews || [])
      .filter((item) => item.range)
      .map((item) => [item.range, item]));
  }

  function renderHighlightComments(review) {
    if (!review?.comments?.length) return '';
    return `
      <ul class="summary-sublist">
        ${review.comments.slice(0, 3).map((comment) => `<li>${escapeHtml(comment)}</li>`).join('')}
      </ul>
    `;
  }

  function renderBookReviews(items) {
    if (!items.length) return '';
    return `
      <section class="summary-section summary-book-reviews">
        <div class="summary-section-title">整本书评价背景</div>
        <ul class="summary-list">
          ${items.map((item) => `<li>${escapeHtml(item.content || '')}</li>`).join('')}
        </ul>
      </section>
    `;
  }

  function renderWarnings(warnings) {
    if (!warnings.length) return '';
    return `<div class="summary-warning">${warnings.map(escapeHtml).join('<br>')}</div>`;
  }

  function renderDebugBlock(title, value, note = '') {
    return `
      <details class="summary-debug">
        <summary>${escapeHtml(title)}</summary>
        ${note ? `<div class="summary-debug-note">${escapeHtml(note)}</div>` : ''}
        <pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>
      </details>
    `;
  }

  function saveWindowBounds() {
    if (boundsSaveTimer === null && document.visibilityState === 'hidden') return;
    const bounds = {
      left: window.screenX,
      top: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight
    };
    chrome.runtime.sendMessage({ type: 'SAVE_SUMMARY_WINDOW_BOUNDS', bounds }).catch(() => {});
  }

  function fromLegacyConclusion(value) {
    if (value === 'worth_deep_read') return 'deep_read';
    if (value === 'skip_read') return 'skip_read';
    return 'quick_read';
  }

  function hasNumericScore(value) {
    if (value === null || value === undefined || value === '') return false;
    return Number.isFinite(Number(value));
  }

  function normalizeDisplayScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return String(Math.max(0, Math.min(100, Math.round(number))));
  }

  function labelRecommendation(value) {
    if (value === 'deep_read') return '值得精读';
    if (value === 'skip_read') return '可跳读';
    return '可快读';
  }

  function labelCaptureMode(value) {
    if (value === 'passive-accumulated') return '被动累计';
    if (value === 'server-skill') return '服务器正文';
    if (value === 'background-clone') return '后台副本';
    return '当前可见';
  }

  function escapeClassName(value) {
    return String(value || '').replace(/[^a-z0-9_-]/gi, '');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
  }
})();
