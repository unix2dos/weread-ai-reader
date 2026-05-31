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
const manifestJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'extension/manifest.json'), 'utf8'));

test('panel puts reading judgement before signal evidence', () => {
  const judgementIndex = contentJs.indexOf('<div class="wap-judgement"></div>');
  const signalIndex = contentJs.indexOf('<div class="wap-signal-panel"></div>');

  assert.notEqual(judgementIndex, -1);
  assert.notEqual(signalIndex, -1);
  assert.ok(judgementIndex < signalIndex);
});

test('collapsed panel hides secondary actions to avoid squeezed controls', () => {
  assert.match(contentCss, /#weread-ai-panel\.collapsed\s+\.wap-analyze\s*\{[^}]*display:\s*none/s);
  assert.match(contentJs, /<button class="wap-collapsed-title" type="button"/);
  assert.match(contentCss, /#weread-ai-panel\.collapsed\s*\{[^}]*width:\s*58px/s);
});

test('collapsed AI entry can expand the panel by click', () => {
  assert.match(contentJs, /function installPanelToggle\(panel\)/);
  assert.match(contentJs, /panel\.querySelector\('\.wap-collapsed-title'\)/);
  assert.match(contentJs, /collapsedTitle\.addEventListener\('click', \(\) => \{/);
  assert.match(contentJs, /panel\.dataset\.dragJustEnded === 'true'/);
  assert.match(contentJs, /expandPanel\(panel\)/);
});

test('collapsed AI entry remains draggable without triggering control button guard', () => {
  assert.match(contentJs, /if \(e\.target\.closest\('\.wap-controls button'\)\) return;/);
  assert.match(contentJs, /el\.dataset\.dragJustEnded = 'true'/);
});

test('highlight evidence renders comments under the matching highlight range', () => {
  assert.match(contentJs, /function renderHighlightEvidence\(bestBookmarks, bookmarkReviews\)/);
  assert.match(contentJs, /buildReviewsByRange\(bookmarkReviews\)/);
  assert.match(contentJs, /reviewsByRange\.get\(item\.range\)/);
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

test('chapter judgement action uses a refresh icon and current-chapter wording', () => {
  assert.match(contentJs, /<span class="wap-refresh-icon" aria-hidden="true">↻<\/span>/);
  assert.match(contentJs, /<span>本章判断<\/span>/);
  assert.doesNotMatch(contentJs, />重新判断</);
});

test('option q toggles the panel without rerunning judgement', () => {
  assert.match(contentJs, /function installKeyboardShortcuts\(panel\)/);
  assert.match(contentJs, /event\.altKey && event\.code === 'KeyQ'/);
  assert.match(contentJs, /window\.addEventListener\('keydown', handleShortcut, true\)/);
  assert.match(contentJs, /togglePanel\(panel\)/);
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
