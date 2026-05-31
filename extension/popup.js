const DEFAULT_AGENT_CONFIG = {
  serverUrl: 'http://127.0.0.1:8787',
  clientToken: 'dev-token'
};

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const openSettingsBtn = document.getElementById('open-settings');
  const clearCacheBtn = document.getElementById('clear-cache');

  const result = await chrome.storage.local.get(['agentConfig']);
  const agentConfig = { ...DEFAULT_AGENT_CONFIG, ...(result.agentConfig || {}) };

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
