# Independent Summary Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the complete WeRead AI reading judgement display from the WeRead page overlay into an independent AI summary window, then remove all visible page-level AI controls so the reading page stays clean.

**Architecture:** The WeRead content script remains the headless collector and judgement trigger. The background service worker owns summary-window lifecycle, persisted bounds, latest summary state, current-chapter requests, and action-badge status. The toolbar popup is a transient control console. The independent summary window renders reading judgement and receives live updates through runtime messages.

**Tech Stack:** Chrome Extension Manifest V3, content scripts, background service worker, `chrome.windows`, `chrome.storage.local`, plain HTML/CSS/JavaScript, Node built-in tests.

---

## File Structure

- Modify `extension/manifest.json`: include `summary.html` as an extension page referenced by background window creation.
- Modify `extension/background.js`: handle `OPEN_SUMMARY_WINDOW`, `UPDATE_SUMMARY_STATE`, `GET_SUMMARY_STATE`, `SAVE_SUMMARY_WINDOW_BOUNDS`, `REQUEST_CURRENT_CHAPTER_JUDGEMENT`, and action-badge status.
- Modify `extension/content.js`: remove visible in-page UI, publish summary state to background, map `Option+Q` to opening/focusing the summary window, and accept background current-chapter judgement requests.
- Modify `extension/styles/content.css`: keep content-script styling empty because the page UI is headless.
- Create `extension/summary.html`: independent summary-window document.
- Create `extension/summary.js`: render latest reading state, listen for updates, and persist window bounds.
- Create `extension/styles/summary.css`: layout for the independent summary window.
- Modify `extension/popup.html` and `extension/popup.js`: make the toolbar popup the control console.
- Modify `test/extension-ui-contract.test.js`: lock the window lifecycle, headless content script, popup controls, summary rendering, badge status, and keyboard shortcut contracts.
- Add `docs/adr/0005-independent-summary-window-for-reading-companion.md`: record the display-surface decision.

## Tasks

### Task 1: Contract Tests

- [x] Add tests that assert `background.js` creates a popup window from `summary.html`, stores `wereadAiSummaryWindowBounds`, and saves latest summary state.
- [x] Add tests that assert `content.js` sends `OPEN_SUMMARY_WINDOW` on `Option+Q` and publishes `UPDATE_SUMMARY_STATE` after upload, stream progress, completion, and errors.
- [x] Add tests that assert `summary.html`, `summary.js`, and `styles/summary.css` exist and render judgement, compact value fields, and collapsible evidence.
- [x] Run `node --test test/extension-ui-contract.test.js` and confirm these tests fail before implementation.

### Task 2: Background Window Lifecycle

- [x] Add background storage keys for summary state and window bounds.
- [x] Implement `openSummaryWindow()` with `chrome.windows.create({ type: 'popup', url: chrome.runtime.getURL('summary.html') })`.
- [x] Focus an existing summary window if it is still open; recreate it if focusing fails.
- [x] Save bounds from `SAVE_SUMMARY_WINDOW_BOUNDS`.
- [x] Update latest summary state from `UPDATE_SUMMARY_STATE` and forward `SUMMARY_STATE_UPDATED` to extension pages.

### Task 3: Summary Window UI

- [x] Create `summary.html` with status, judgement, reading-signal, and debug containers.
- [x] Create `summary.js` to request `GET_SUMMARY_STATE`, render empty/loading/complete/error states, and listen for `SUMMARY_STATE_UPDATED`.
- [x] Create `styles/summary.css` for a dense reading companion layout with foldable reading signals and debug.
- [x] Persist bounds from `beforeunload` and a low-frequency interval using `window.screenX`, `window.screenY`, `window.outerWidth`, and `window.outerHeight`.

### Task 4: Compact In-Page Entry

- [x] Replace the large in-page panel markup with a compact entry that contains `AI`, short status, and a current-chapter refresh button.
- [x] Keep passive chapter capture and snapshot upload behavior unchanged.
- [x] Change `Option+Q` and compact-entry click to send `OPEN_SUMMARY_WINDOW`.
- [x] Publish summary-state updates from upload response, stream start/delta/complete/error, debug updates, and same-chapter capture growth.

### Task 4b: Toolbar Popup Control Console

- [x] Remove the compact in-page entry after deciding the reading page should have no visible extension UI.
- [x] Add runtime messaging so the toolbar popup and summary window can request current-chapter judgement from the active WeRead reader tab.
- [x] Move the primary “本章判断” command to the toolbar popup and keep a secondary command in the summary window.
- [x] Add action-badge state for generating, complete, and failed status.
- [x] Keep `Option+Q` as an open/focus shortcut for the summary window.

### Task 5: Verification

- [x] Run `node --test test/extension-ui-contract.test.js`.
- [x] Run `npm test`.
- [x] Run `node --check` across server, scripts, tests, and extension JavaScript.
- [x] Run `git diff --check`.
- [x] Start or confirm the local server remains healthy with `curl http://127.0.0.1:19763/health`.

### Task 6: Value-Dense Summary

- [x] Add tests that assert the summary first screen contains recommendation, mastery score, at most 3 must-know items, at most 2 questions, one reading action, and Agent analysis fields.
- [x] Keep reader perspective, reasons, and key passages in the reading judgement because they are Agent analysis output.
- [x] Move WeRead raw signals into a default-open reading-signal frame and keep debug limited to request summary plus complete request.
- [x] Tighten the reading-strategy prompt and parser limits to reduce noisy output before it reaches the UI.
- [x] Reduce short-judgement output budget from 1200 to 900 tokens.
