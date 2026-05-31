const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const contentJs = fs.readFileSync(path.join(repoRoot, 'extension/content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(repoRoot, 'extension/styles/content.css'), 'utf8');
const backgroundJs = fs.readFileSync(path.join(repoRoot, 'extension/background.js'), 'utf8');
const optionsJs = fs.readFileSync(path.join(repoRoot, 'extension/options.js'), 'utf8');
const popupJs = fs.readFileSync(path.join(repoRoot, 'extension/popup.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(repoRoot, 'extension/options.html'), 'utf8');
const summaryHtmlPath = path.join(repoRoot, 'extension/summary.html');
const summaryJsPath = path.join(repoRoot, 'extension/summary.js');
const summaryCssPath = path.join(repoRoot, 'extension/styles/summary.css');
const summaryHtml = fs.existsSync(summaryHtmlPath) ? fs.readFileSync(summaryHtmlPath, 'utf8') : '';
const summaryJs = fs.existsSync(summaryJsPath) ? fs.readFileSync(summaryJsPath, 'utf8') : '';
const summaryCss = fs.existsSync(summaryCssPath) ? fs.readFileSync(summaryCssPath, 'utf8') : '';
const manifestJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'extension/manifest.json'), 'utf8'));

test('content script runs headlessly without visible page UI', () => {
  assert.doesNotMatch(contentJs, /<button class="wap-collapsed-title" type="button"/);
  assert.doesNotMatch(contentJs, /<button class="wap-btn wap-analyze"/);
  assert.doesNotMatch(contentJs, /panel\.id = 'weread-ai-panel'/);
  assert.doesNotMatch(contentJs, /document\.body\.appendChild\(panel\)/);
  assert.doesNotMatch(contentJs, /<div class="wap-body">/);
  assert.doesNotMatch(contentJs, /<div class="wap-judgement"><\/div>/);
  assert.doesNotMatch(contentJs, /<div class="wap-signal-panel"><\/div>/);
  assert.doesNotMatch(contentJs, /wap-/);
  assert.doesNotMatch(contentCss, /#weread-ai-panel/);
  assert.match(contentJs, /function installRuntimeMessageHandlers\(\)/);
  assert.match(contentJs, /REQUEST_CURRENT_CHAPTER_JUDGEMENT/);
});

test('background owns the independent summary window lifecycle', () => {
  assert.match(backgroundJs, /SUMMARY_WINDOW_BOUNDS_STORAGE_KEY = 'wereadAiSummaryWindowBounds'/);
  assert.match(backgroundJs, /SUMMARY_STATE_STORAGE_KEY = 'wereadAiSummaryState'/);
  assert.match(backgroundJs, /OPEN_SUMMARY_WINDOW/);
  assert.match(backgroundJs, /SAVE_SUMMARY_WINDOW_BOUNDS/);
  assert.match(backgroundJs, /UPDATE_SUMMARY_STATE/);
  assert.match(backgroundJs, /GET_SUMMARY_STATE/);
  assert.match(backgroundJs, /REQUEST_CURRENT_CHAPTER_JUDGEMENT/);
  assert.match(backgroundJs, /CLEAR_SUMMARY_STATE/);
  assert.match(backgroundJs, /chrome\.windows\.create\(\{[\s\S]*type:\s*'popup'[\s\S]*summary\.html/s);
  assert.match(backgroundJs, /chrome\.windows\.update\(summaryWindowId, \{ focused: true \}\)/);
  assert.match(backgroundJs, /chrome\.tabs\.sendMessage\(tab\.id, \{ type: 'REQUEST_CURRENT_CHAPTER_JUDGEMENT' \}\)/);
  assert.match(backgroundJs, /function updateActionBadge\(summaryState\)/);
  assert.match(backgroundJs, /function clearSummaryState\(\)/);
  assert.match(backgroundJs, /chrome\.action\.setBadgeText\(\{ text:/);
});

test('summary window renders reading judgement, reading signals, and debug separately', () => {
  assert.match(summaryHtml, /id="summary-status"/);
  assert.match(summaryHtml, /id="summary-analyze"/);
  assert.match(summaryHtml, /id="summary-judgement"/);
  assert.match(summaryHtml, /id="summary-evidence"/);
  assert.match(summaryHtml, /<script src="summary\.js"><\/script>/);
  assert.match(summaryHtml, /styles\/summary\.css/);
  assert.match(summaryJs, /chrome\.runtime\.sendMessage\(\{ type: 'GET_SUMMARY_STATE' \}/);
  assert.match(summaryJs, /SUMMARY_STATE_UPDATED/);
  assert.match(summaryJs, /function renderJudgement\(state\)/);
  assert.match(summaryJs, /最需要掌握/);
  assert.match(summaryJs, /追问问题/);
  assert.match(summaryJs, /<details class="summary-signals" open>/);
  assert.match(summaryJs, /<summary>阅读信号<\/summary>/);
  assert.match(summaryJs, /<details class="summary-debug-panel">/);
  assert.match(summaryJs, /<summary>调试<\/summary>/);
  assert.doesNotMatch(summaryJs, /证据与调试/);
  assert.match(summaryJs, /SAVE_SUMMARY_WINDOW_BOUNDS/);
  assert.match(summaryJs, /REQUEST_CURRENT_CHAPTER_JUDGEMENT/);
  assert.match(summaryCss, /\.summary-shell/);
  assert.match(summaryCss, /\.summary-score/);
  assert.match(summaryCss, /\.summary-signals/);
  assert.match(summaryCss, /\.summary-debug-panel/);
});

test('extension toolbar popup is the control console', () => {
  const popupHtml = fs.readFileSync(path.join(repoRoot, 'extension/popup.html'), 'utf8');
  assert.match(popupHtml, /id="popup-status"/);
  assert.match(popupHtml, /id="popup-context"/);
  assert.match(popupHtml, /id="analyze-chapter"/);
  assert.match(popupHtml, /id="open-summary"/);
  assert.match(popupJs, /chrome\.runtime\.sendMessage\(\{ type: 'GET_SUMMARY_STATE' \}/);
  assert.match(popupJs, /SUMMARY_STATE_UPDATED/);
  assert.match(popupJs, /type:\s*'OPEN_SUMMARY_WINDOW'/);
  assert.match(popupJs, /type:\s*'REQUEST_CURRENT_CHAPTER_JUDGEMENT'/);
  assert.match(popupJs, /type:\s*'CLEAR_SUMMARY_STATE'/);
  assert.match(popupJs, /function renderSummaryState\(summaryState\)/);
  assert.match(popupJs, /function requestCurrentChapterJudgement\(\)/);
  assert.doesNotMatch(popupJs, /chrome\.storage\.local\.remove\(\[SUMMARY_STATE_STORAGE_KEY/);
});

test('summary judgement keeps agent analysis fields together', () => {
  const renderJudgementSource = summaryJs.match(/function renderJudgement\(state\) \{([\s\S]*?)\n  function renderEvidence/);
  assert.ok(renderJudgementSource, 'renderJudgement source should be inspectable');
  const primarySummary = renderJudgementSource[1];

  assert.match(primarySummary, /renderList\('最需要掌握', judgement\.nextMustKnow, 3\)/);
  assert.match(primarySummary, /renderList\('追问问题', judgement\.questionsForAuthor, 2\)/);
  assert.match(primarySummary, /renderSummaryAction\(judgement\.readingAdvice\)/);
  assert.match(primarySummary, /renderTextSection\('读者视角', judgement\.readerPerspective\)/);
  assert.match(primarySummary, /renderList\('理由', judgement\.reasons, 2\)/);
  assert.match(primarySummary, /renderList\('重点段落', judgement\.keyPassages, 3\)/);
});

test('content script opens the summary window and publishes state updates', () => {
  assert.match(contentJs, /function openSummaryWindow\(\)/);
  assert.match(contentJs, /type:\s*'OPEN_SUMMARY_WINDOW'/);
  assert.match(contentJs, /function publishSummaryState\(patch\)/);
  assert.match(contentJs, /type:\s*'UPDATE_SUMMARY_STATE'/);
  assert.match(contentJs, /publishSummaryState\(\{[\s\S]*signalPanel:/);
  assert.match(contentJs, /publishSummaryState\(\{[\s\S]*readingJudgement:/);
  assert.match(contentJs, /publishSummaryState\(\{[\s\S]*streamText:/);
});

test('content complete event keeps structured judgement payload intact', () => {
  const completeBranch = contentJs.match(/} else if \(message\.event === 'complete'\) \{([\s\S]*?)\n\s*\} else if \(message\.event === 'error'\)/);
  assert.ok(completeBranch);
  assert.match(completeBranch[1], /renderJudgement\(message\.data\)/);
  assert.doesNotMatch(completeBranch[1], /renderJudgement\(normalizeReadingJudgement\(message\.data\)\)/);
  assert.match(contentJs, /const judgement = data\?\.readingJudgement \|\| data\?\.judgement \|\| data \|\| \{\};/);
});

test('summary judgement renders questions for author without answer wording', () => {
  assert.match(summaryJs, /renderList\('追问问题', judgement\.questionsForAuthor/);
  assert.doesNotMatch(contentJs, /<div class="wap-analysis-title">(?:作者回答|模拟作者|答案)<\/div>/);
  assert.doesNotMatch(summaryJs, /<div class="summary-section-title">(?:作者回答|模拟作者|答案)<\/div>/);
});

test('summary judgement does not render empty text sections', () => {
  assert.match(summaryJs, /function renderTextSection\(title, text\)/);
  assert.match(summaryJs, /renderTextSection\('读者视角', judgement\.readerPerspective\)/);
  assert.match(summaryJs, /function renderSummaryAction\(text\)/);
  assert.match(summaryJs, /renderSummaryAction\(judgement\.readingAdvice\)/);
  assert.doesNotMatch(summaryJs, /renderTextSection\('阅读建议', judgement\.readingAdvice\)/);
  assert.doesNotMatch(summaryJs, /<div class="summary-section-title">读者视角<\/div>\s*<div class="summary-analysis-content">\$\{escapeHtml\(judgement\.readerPerspective \|\| ''\)\}<\/div>/);
});

test('reading signals and book reviews are separate foldable frames', () => {
  const renderSignalsSource = summaryJs.match(/function renderReadingSignals\(state\) \{([\s\S]*?)\n  function renderBookReviewPanel/);
  assert.ok(renderSignalsSource, 'renderReadingSignals source should be inspectable');
  const signalsSource = renderSignalsSource[1];

  assert.match(summaryJs, /function renderBookReviewPanel\(state\)/);
  assert.match(summaryJs, /<details class="summary-signals" open>/);
  assert.match(summaryJs, /<summary>阅读信号<\/summary>/);
  assert.match(summaryJs, /renderHighlightEvidence\(bestBookmarks, bookmarkReviews\)/);
  assert.doesNotMatch(signalsSource, /renderBookReviews\(bookReviews\)/);
  assert.match(summaryJs, /<details class="summary-book-review-panel">/);
  assert.doesNotMatch(summaryJs, /<details class="summary-book-review-panel" open>/);
  assert.match(summaryJs, /<summary>整本书评价背景<\/summary>/);
  assert.match(summaryJs, /items\.map\(\(item\) => `<li>\$\{escapeHtml\(item\.content \|\| ''\)\}<\/li>`\)/);
  assert.match(summaryCss, /\.summary-book-review-panel/);
  assert.doesNotMatch(summaryJs, /summary-nested-evidence summary-book-reviews/);
  assert.doesNotMatch(summaryJs, /items\.slice\(0, 3\)\.map\(\(item\) => `<li>\$\{escapeHtml\(truncate\(item\.content, 120\)\)\}<\/li>`\)/);
});

test('debug panel contains only request summary and complete request', () => {
  const renderDebugSource = summaryJs.match(/function renderDebugPanel\(state\) \{([\s\S]*?)\n  function normalizeSummaryState/);
  assert.ok(renderDebugSource, 'renderDebugPanel source should be inspectable');
  const debugSource = renderDebugSource[1];

  assert.match(debugSource, /<summary>调试<\/summary>/);
  assert.match(summaryJs, /renderDebugBlock\('请求摘要（省略正文）'/);
  assert.match(summaryJs, /renderDebugBlock\('完整请求（LLM messages，密钥隐藏）'/);
  assert.match(summaryJs, /只展示结构、计数、hash 和截断预览/);
  assert.match(summaryJs, /服务器实际构造的 OpenAI 兼容请求/);
  assert.doesNotMatch(debugSource, /renderCaptureMeta/);
  assert.doesNotMatch(debugSource, /renderWarnings/);
  assert.doesNotMatch(debugSource, /renderTextSection\('读者视角'/);
  assert.doesNotMatch(debugSource, /renderList\('理由'/);
  assert.doesNotMatch(debugSource, /renderList\('重点段落'/);
  assert.doesNotMatch(debugSource, /renderHighlightEvidence/);
  assert.doesNotMatch(debugSource, /renderBookReviews/);
});

test('legacy judgement fallback is visibly marked as incomplete', () => {
  assert.match(summaryJs, /schemaWarning:/);
  assert.match(summaryJs, /服务端返回旧格式，只能显示阅读结论/);
  assert.match(summaryJs, /renderSchemaWarning\(judgement\.schemaWarning\)/);
});

test('debug fallback no longer rebuilds a divergent prompt', () => {
  assert.doesNotMatch(contentJs, /function buildAgentRequestFallback/);
  assert.doesNotMatch(contentJs, /server-generated-url-unavailable/);
});

test('debug request summary uses reading strategy prompt version', () => {
  assert.doesNotMatch(contentJs, /short-judgement-v1/);
  assert.match(contentJs, /reading-strategy-v2/);
});

test('debug unavailable agent request omits stale agent body location', () => {
  assert.match(contentJs, /const hasServerAgentRequest = Boolean\(uploadResponse\.agentRequest\)/);
  assert.match(contentJs, /summarizeUploadBody\(snapshot, hasServerAgentRequest\)/);
  assert.match(contentJs, /summarizeAgentInput\(agentInput, hasServerAgentRequest\)/);
  assert.match(contentJs, /\[\$\{placeholderLength\} chars; exact text omitted from debug summary\]/);
});

test('highlight evidence renders comments under the matching highlight range', () => {
  assert.match(summaryJs, /function renderHighlightEvidence\(bestBookmarks, bookmarkReviews\)/);
  assert.match(summaryJs, /buildReviewsByRange\(bookmarkReviews\)/);
  assert.match(summaryJs, /reviewsByRange\.get\(item\.range\)/);
});

test('highlight comments render like counts from sorted comment objects', () => {
  assert.match(summaryJs, /function renderHighlightComment\(comment\)/);
  assert.match(summaryJs, /getCommentContent\(comment\)/);
  assert.match(summaryJs, /getCommentLikeCount\(comment\)/);
  assert.match(summaryJs, /hasCommentLikeCount\(comment\)/);
  assert.match(summaryJs, /\$\{likeCount\}赞/);
  assert.match(summaryCss, /\.summary-comment-like/);
});

test('same-chapter capture growth does not automatically rerun judgement', () => {
  assert.match(contentJs, /function updateSameChapterCaptureStatus\(/);
  assert.match(contentJs, /same_chapter_capture_updated/);
});

test('upload and judgement progress status keeps the chapter title visible', () => {
  assert.match(contentJs, /function formatChapterProgress\(chapterTitle, message\)/);
  assert.match(contentJs, /formatChapterProgress\(snapshot\.chapterTitle, '正在发送阅读快照\.\.\.'\)/);
  assert.match(contentJs, /formatChapterProgress\(snapshot\.chapterTitle, `已发送 \$\{formatCaptureLength\(snapshot\.chapterText\.length, snapshot\)\}，正在生成阅读判断\.\.\.`\)/);
  assert.match(contentJs, /updateJudgementLoading\(formatChapterProgress\(currentChapterTitle, '正在生成阅读判断\.\.\.'\)\)/);
});

test('page UI no longer exposes panel opacity, pin, or analyze controls', () => {
  assert.doesNotMatch(contentJs, /PANEL_PREFS_STORAGE_KEY = 'wereadAiPanelPrefs'/);
  assert.doesNotMatch(contentJs, /class="wap-btn wap-opacity/);
  assert.doesNotMatch(contentJs, /class="wap-btn wap-pin/);
  assert.doesNotMatch(contentJs, /class="wap-btn wap-analyze/);
});

test('option q opens the summary window without rerunning judgement', () => {
  assert.match(contentJs, /function installKeyboardShortcuts\(\)/);
  assert.match(contentJs, /event\.altKey && event\.code === 'KeyQ'/);
  assert.match(contentJs, /window\.addEventListener\('keydown', handleShortcut, true\)/);
  assert.match(contentJs, /openSummaryWindow\(\)/);
  assert.doesNotMatch(contentJs, /event\.key\.toLowerCase\(\) === 'q'/);
});

test('extension defaults use the less common local agent port', () => {
  for (const source of [contentJs, backgroundJs, optionsJs, popupJs]) {
    assert.match(source, /http:\/\/127\.0\.0\.1:19763/);
  }
});

test('manifest declares extension icons and action icons', () => {
  for (const size of ['16', '32', '48', '128']) {
    assert.equal(manifestJson.icons[size], `icons/icon${size}.png`);
    assert.equal(manifestJson.action.default_icon[size], `icons/icon${size}.png`);
  }
});

test('options page can reveal and hide the client token', () => {
  assert.match(optionsHtml, /id="client-token-toggle"/);
  assert.match(optionsJs, /clientTokenInput\.type = showingToken \? 'text' : 'password'/);
  assert.match(optionsJs, /clientTokenToggle\.setAttribute\('aria-label', showingToken \? '隐藏 clientToken' : '显示 clientToken'\)/);
});
