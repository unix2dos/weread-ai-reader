document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const openSettingsBtn = document.getElementById('open-settings');
  const clearCacheBtn = document.getElementById('clear-cache');

  const result = await chrome.storage.local.get(['wereadApiKey', 'llmConfig']);
  const hasWeRead = !!result.wereadApiKey;
  const hasLLM = !!(result.llmConfig?.apiKey);

  if (hasWeRead && hasLLM) {
    statusEl.textContent = '✓ 配置完成';
    statusEl.className = 'status ready';
  } else {
    statusEl.textContent = '⚠ 请先配置 API Key';
    statusEl.className = 'status warning';
  }

  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  clearCacheBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('analysisCache');
    statusEl.textContent = '✓ 缓存已清除';
    statusEl.className = 'status ready';
    setTimeout(() => window.close(), 1000);
  });
});
