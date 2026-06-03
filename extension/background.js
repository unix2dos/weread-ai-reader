const DEFAULT_AGENT_CONFIG = {
  serverUrl: 'http://127.0.0.1:19763',
  clientToken: 'dev-token'
};
const OLD_DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';
const SUMMARY_WINDOW_BOUNDS_STORAGE_KEY = 'wereadAiSummaryWindowBounds';
const SUMMARY_STATE_STORAGE_KEY = 'wereadAiSummaryState';
const DEFAULT_SUMMARY_WINDOW_BOUNDS = Object.freeze({
  width: 420,
  height: 760
});

let summaryWindowId = null;
let latestSummaryState = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['agentConfig'], (result) => {
    const agentConfig = normalizeAgentConfig(result.agentConfig);
    if (!result.agentConfig || agentConfig.serverUrl !== result.agentConfig.serverUrl) {
      chrome.storage.local.set({ agentConfig });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_AGENT_CONFIG') {
    getAgentConfig().then((agentConfig) => {
      sendResponse({ agentConfig });
    });
    return true;
  }

  if (message.type === 'UPLOAD_READING_SNAPSHOT') {
    uploadReadingSnapshot(message.data).then(
      (body) => sendResponse({ ok: true, body }),
      (err) => sendResponse({ ok: false, error: { message: err.message } })
    );
    return true;
  }

  if (message.type === 'OPEN_SUMMARY_WINDOW') {
    openSummaryWindow().then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: { message: err.message } })
    );
    return true;
  }

  if (message.type === 'SAVE_SUMMARY_WINDOW_BOUNDS') {
    saveSummaryWindowBounds(message.bounds).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: { message: err.message } })
    );
    return true;
  }

  if (message.type === 'UPDATE_SUMMARY_STATE') {
    updateSummaryState(message.patch || {}).then(
      (summaryState) => sendResponse({ ok: true, summaryState }),
      (err) => sendResponse({ ok: false, error: { message: err.message } })
    );
    return true;
  }

  if (message.type === 'GET_SUMMARY_STATE') {
    getSummaryState().then(
      (summaryState) => sendResponse({ ok: true, summaryState }),
      (err) => sendResponse({ ok: false, error: { message: err.message } })
    );
    return true;
  }

  if (message.type === 'CLEAR_SUMMARY_STATE') {
    clearSummaryState().then(
      (summaryState) => sendResponse({ ok: true, summaryState }),
      (err) => sendResponse({ ok: false, error: { message: err.message } })
    );
    return true;
  }

  if (message.type === 'REQUEST_CURRENT_CHAPTER_JUDGEMENT') {
    requestCurrentChapterJudgement().then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: { message: err.message } })
    );
    return true;
  }

  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === summaryWindowId) {
    summaryWindowId = null;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'judgement-stream') return;

  const abortController = new AbortController();
  port.onDisconnect.addListener(() => {
    abortController.abort();
  });

  port.onMessage.addListener((message) => {
    if (message.type !== 'START_JUDGEMENT_STREAM') return;
    streamJudgement(message.snapshotId, port, abortController.signal).catch((err) => {
      port.postMessage({
        type: 'sse',
        event: 'error',
        data: { code: 'judgement_stream_failed', message: err.message }
      });
    });
  });
});

function getAgentConfig() {
  return chrome.storage.local.get(['agentConfig']).then((result) => normalizeAgentConfig(result.agentConfig));
}

function normalizeAgentConfig(agentConfig) {
  const normalized = {
    ...DEFAULT_AGENT_CONFIG,
    ...(agentConfig || {})
  };
  if (normalized.serverUrl === OLD_DEFAULT_SERVER_URL) {
    normalized.serverUrl = DEFAULT_AGENT_CONFIG.serverUrl;
  }
  return normalized;
}

async function openSummaryWindow() {
  if (summaryWindowId !== null) {
    try {
      const existingWindow = await chrome.windows.update(summaryWindowId, { focused: true });
      if (existingWindow) return existingWindow;
    } catch {
      summaryWindowId = null;
    }
  }

  const bounds = await getSummaryWindowBounds();
  const createdWindow = await chrome.windows.create({
    type: 'popup',
    url: chrome.runtime.getURL('summary.html'),
    width: bounds.width,
    height: bounds.height,
    ...(Number.isFinite(bounds.left) ? { left: bounds.left } : {}),
    ...(Number.isFinite(bounds.top) ? { top: bounds.top } : {})
  });
  summaryWindowId = createdWindow.id;
  return createdWindow;
}

async function getSummaryWindowBounds() {
  const result = await chrome.storage.local.get([SUMMARY_WINDOW_BOUNDS_STORAGE_KEY]);
  return normalizeSummaryWindowBounds(result[SUMMARY_WINDOW_BOUNDS_STORAGE_KEY]);
}

async function saveSummaryWindowBounds(bounds) {
  await chrome.storage.local.set({
    [SUMMARY_WINDOW_BOUNDS_STORAGE_KEY]: normalizeSummaryWindowBounds(bounds)
  });
}

function normalizeSummaryWindowBounds(bounds) {
  const normalized = {
    ...DEFAULT_SUMMARY_WINDOW_BOUNDS,
    ...(bounds || {})
  };

  const width = clampInteger(normalized.width, 360, 900, DEFAULT_SUMMARY_WINDOW_BOUNDS.width);
  const height = clampInteger(normalized.height, 480, 1200, DEFAULT_SUMMARY_WINDOW_BOUNDS.height);
  const left = optionalInteger(normalized.left);
  const top = optionalInteger(normalized.top);

  return {
    width,
    height,
    ...(left !== null ? { left } : {}),
    ...(top !== null ? { top } : {})
  };
}

async function updateSummaryState(patch) {
  const current = await getSummaryState();
  latestSummaryState = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [SUMMARY_STATE_STORAGE_KEY]: latestSummaryState });
  updateActionBadge(latestSummaryState);
  Promise.resolve(chrome.runtime.sendMessage({
    type: 'SUMMARY_STATE_UPDATED',
    summaryState: latestSummaryState
  })).catch(() => {});
  return latestSummaryState;
}

async function getSummaryState() {
  if (latestSummaryState) return latestSummaryState;
  const result = await chrome.storage.local.get([SUMMARY_STATE_STORAGE_KEY]);
  latestSummaryState = normalizeSummaryState(result[SUMMARY_STATE_STORAGE_KEY]);
  updateActionBadge(latestSummaryState);
  return latestSummaryState;
}

async function clearSummaryState() {
  latestSummaryState = normalizeSummaryState(null);
  await chrome.storage.local.remove([SUMMARY_STATE_STORAGE_KEY, 'lastSignalPanel']);
  updateActionBadge(latestSummaryState);
  Promise.resolve(chrome.runtime.sendMessage({
    type: 'SUMMARY_STATE_UPDATED',
    summaryState: latestSummaryState
  })).catch(() => {});
  return latestSummaryState;
}

function normalizeSummaryState(state) {
  return {
    status: { type: 'waiting', text: '等待阅读现场...' },
    bookTitle: '',
    chapterTitle: '',
    capture: null,
    signalPanel: null,
    readingJudgement: null,
    streamText: '',
    debug: null,
    fullRequest: null,
    updatedAt: '',
    ...(state || {})
  };
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function optionalInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number);
}

async function requestCurrentChapterJudgement() {
  const tab = await findReaderTab();
  if (!tab?.id) {
    throw new Error('未找到打开的微信读书阅读页');
  }
  await chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_CURRENT_CHAPTER_JUDGEMENT' });
}

async function findReaderTab() {
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeReaderTab = activeTabs.find((tab) => isReaderTab(tab));
  if (activeReaderTab) return activeReaderTab;

  const readerTabs = await chrome.tabs.query({ url: 'https://weread.qq.com/web/reader/*' });
  return readerTabs[0] || null;
}

function isReaderTab(tab) {
  return typeof tab?.url === 'string' && tab.url.includes('weread.qq.com/web/reader/');
}

function updateActionBadge(summaryState) {
  if (!chrome.action?.setBadgeText) return;
  const text = badgeTextForSummaryState(summaryState);
  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor?.({ color: badgeColorForSummaryState(summaryState) });
}

function badgeTextForSummaryState(summaryState) {
  const status = summaryState?.status || {};
  const text = status.text || '';
  if (status.type === 'error' || text.includes('失败') || text.includes('错误')) return '!';
  if (text.includes('正在发送') || text.includes('正在生成')) return '…';
  if (text.includes('判断完成')) return 'OK';
  return '';
}

function badgeColorForSummaryState(summaryState) {
  const badgeText = badgeTextForSummaryState(summaryState);
  if (badgeText === '!') return '#b42318';
  if (badgeText === 'OK') return '#1f7a4d';
  return '#1769aa';
}

async function uploadReadingSnapshot(snapshot) {
  const agentConfig = await getAgentConfig();
  const serverUrl = normalizeServerUrl(agentConfig.serverUrl);
  const body = {
    ...snapshot,
    clientToken: agentConfig.clientToken
  };

  const resp = await fetch(`${serverUrl}/api/reading-snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error?.message || `HTTP ${resp.status}`);
  }
  return data;
}

async function streamJudgement(snapshotId, port, signal) {
  const agentConfig = await getAgentConfig();
  const serverUrl = normalizeServerUrl(agentConfig.serverUrl);
  const url = `${serverUrl}/api/reading-snapshots/${encodeURIComponent(snapshotId)}/judgement/stream?clientToken=${encodeURIComponent(agentConfig.clientToken)}`;
  const resp = await fetch(url, { signal });

  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      message = body.error?.message || message;
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }

  await readSse(resp.body, (event, data) => {
    port.postMessage({ type: 'sse', event, data });
  });
}

async function readSse(body, emit) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const rawEvent of events) {
      const parsed = parseSseEvent(rawEvent);
      if (parsed) emit(parsed.event, parsed.data);
    }
  }

  if (buffer.trim()) {
    const parsed = parseSseEvent(buffer);
    if (parsed) emit(parsed.event, parsed.data);
  }
}

function parseSseEvent(rawEvent) {
  const lines = rawEvent.split('\n');
  let event = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) return null;

  return {
    event,
    data: JSON.parse(dataLines.join('\n'))
  };
}

function normalizeServerUrl(value) {
  return String(value || DEFAULT_AGENT_CONFIG.serverUrl).replace(/\/+$/, '');
}
