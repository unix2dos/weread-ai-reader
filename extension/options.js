const DEFAULT_AGENT_CONFIG = {
  serverUrl: 'http://127.0.0.1:8787',
  clientToken: 'dev-token'
};

document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('agent-server-url');
  const clientTokenInput = document.getElementById('client-token');
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-btn');
  const status = document.getElementById('status');

  const result = await chrome.storage.local.get(['agentConfig']);
  const agentConfig = { ...DEFAULT_AGENT_CONFIG, ...(result.agentConfig || {}) };
  serverUrlInput.value = agentConfig.serverUrl;
  clientTokenInput.value = agentConfig.clientToken;

  saveBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      agentConfig: readConfig()
    });
    showStatus('配置已保存', 'success');
  });

  testBtn.addEventListener('click', async () => {
    const config = readConfig();
    showStatus('正在测试连接...', 'success');
    try {
      const resp = await fetch(`${normalizeServerUrl(config.serverUrl)}/health`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const body = await resp.json();
      showStatus(`连接成功\n${JSON.stringify(body)}`, 'success');
    } catch (err) {
      showStatus(`连接失败: ${err.message}`, 'error');
    }
  });

  function readConfig() {
    return {
      serverUrl: normalizeServerUrl(serverUrlInput.value || DEFAULT_AGENT_CONFIG.serverUrl),
      clientToken: clientTokenInput.value.trim() || DEFAULT_AGENT_CONFIG.clientToken
    };
  }

  function showStatus(text, type) {
    status.textContent = text;
    status.className = `status ${type}`;
  }
});

function normalizeServerUrl(value) {
  return String(value || DEFAULT_AGENT_CONFIG.serverUrl).replace(/\/+$/, '');
}
