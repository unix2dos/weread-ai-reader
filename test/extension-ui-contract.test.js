const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const contentJs = fs.readFileSync(path.join(repoRoot, 'extension/content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(repoRoot, 'extension/styles/content.css'), 'utf8');

test('panel puts reading judgement before signal evidence', () => {
  const judgementIndex = contentJs.indexOf('<div class="wap-judgement"></div>');
  const signalIndex = contentJs.indexOf('<div class="wap-signal-panel"></div>');

  assert.notEqual(judgementIndex, -1);
  assert.notEqual(signalIndex, -1);
  assert.ok(judgementIndex < signalIndex);
});

test('collapsed panel hides secondary actions to avoid squeezed controls', () => {
  assert.match(contentCss, /#weread-ai-panel\.collapsed\s+\.wap-analyze\s*\{[^}]*display:\s*none/s);
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
