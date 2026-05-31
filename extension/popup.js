const DEFAULT_AGENT_CONFIG = {
  serverUrl: 'http://127.0.0.1:19763',
  clientToken: 'dev-token'
};
const OLD_DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const openSettingsBtn = document.getElementById('open-settings');
  const clearCacheBtn = document.getElementById('clear-cache');

  const result = await chrome.storage.local.get(['agentConfig']);
  const agentConfig = normalizeAgentConfig(result.agentConfig);

  if (agentConfig.serverUrl && agentConfig.clientToken) {
    statusEl.textContent = `已配置: ${agentConfig.serverUrl}`;
    statusEl.className = 'status ready';
  } else {
    statusEl.textContent = '请先配置 Agent 服务器';
    statusEl.className = 'status warning';
  }

  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  clearCacheBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('lastSignalPanel');
    statusEl.textContent = '本地缓存已清除';
    statusEl.className = 'status ready';
    setTimeout(() => window.close(), 1000);
  });
});

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
