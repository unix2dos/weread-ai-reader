const DEFAULT_AGENT_CONFIG = {
  serverUrl: 'http://127.0.0.1:19763',
  clientToken: 'dev-token'
};
const OLD_DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';

const DEFAULT_SUMMARY_STATE = Object.freeze({
  status: { type: 'waiting', text: '等待阅读现场...' },
  bookTitle: '',
  chapterTitle: ''
});

let statusEl;
let contextEl;
let analyzeChapterBtn;
let openSummaryBtn;
let openSettingsBtn;
let clearCacheBtn;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  statusEl = document.getElementById('popup-status');
  contextEl = document.getElementById('popup-context');
  analyzeChapterBtn = document.getElementById('analyze-chapter');
  openSummaryBtn = document.getElementById('open-summary');
  openSettingsBtn = document.getElementById('open-settings');
  clearCacheBtn = document.getElementById('clear-cache');

  analyzeChapterBtn.addEventListener('click', requestCurrentChapterJudgement);
  openSummaryBtn.addEventListener('click', openSummaryWindow);
  openSettingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  clearCacheBtn.addEventListener('click', clearCache);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'SUMMARY_STATE_UPDATED') return;
    renderSummaryState(message.summaryState || DEFAULT_SUMMARY_STATE);
  });

  await renderConfiguredState();
  await loadSummaryState();
}

async function renderConfiguredState() {
  const result = await chrome.storage.local.get(['agentConfig']);
  const agentConfig = normalizeAgentConfig(result.agentConfig);
  if (!agentConfig.serverUrl || !agentConfig.clientToken) {
    renderStatus({ type: 'warning', text: '请先配置 Agent 服务器' });
  }
}

async function loadSummaryState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SUMMARY_STATE' });
    renderSummaryState(response?.summaryState || DEFAULT_SUMMARY_STATE);
  } catch (err) {
    renderStatus({ type: 'error', text: `读取状态失败: ${err.message}` });
  }
}

function renderSummaryState(summaryState) {
  const state = {
    ...DEFAULT_SUMMARY_STATE,
    ...(summaryState || {}),
    status: {
      ...DEFAULT_SUMMARY_STATE.status,
      ...(summaryState?.status || {})
    }
  };

  const context = [state.bookTitle, state.chapterTitle].filter(Boolean).join(' · ');
  contextEl.textContent = context || '等待阅读现场...';
  renderStatus(state.status);
}

function renderStatus(status) {
  statusEl.className = `status ${status.type || 'waiting'}`;
  statusEl.textContent = status.text || '等待';
}

async function requestCurrentChapterJudgement() {
  analyzeChapterBtn.disabled = true;
  renderStatus({ type: 'waiting', text: '正在请求本章判断...' });
  try {
    const response = await chrome.runtime.sendMessage({ type: 'REQUEST_CURRENT_CHAPTER_JUDGEMENT' });
    if (!response?.ok) throw new Error(response?.error?.message || '请求本章判断失败');
    renderStatus({ type: 'waiting', text: '已请求本章判断，等待生成...' });
  } catch (err) {
    renderStatus({ type: 'error', text: err.message });
  } finally {
    analyzeChapterBtn.disabled = false;
  }
}

async function openSummaryWindow() {
  const response = await chrome.runtime.sendMessage({ type: 'OPEN_SUMMARY_WINDOW' });
  if (!response?.ok) {
    renderStatus({ type: 'error', text: response?.error?.message || '打开摘要窗口失败' });
  }
}

async function clearCache() {
  const response = await chrome.runtime.sendMessage({ type: 'CLEAR_SUMMARY_STATE' });
  if (!response?.ok) {
    renderStatus({ type: 'error', text: response?.error?.message || '清除缓存失败' });
    return;
  }
  renderSummaryState(response.summaryState || DEFAULT_SUMMARY_STATE);
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
