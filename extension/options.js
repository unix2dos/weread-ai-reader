document.addEventListener('DOMContentLoaded', async () => {
  const wereadKeyInput = document.getElementById('weread-api-key');
  const llmProvider = document.getElementById('llm-provider');
  const llmKeyInput = document.getElementById('llm-api-key');
  const llmModel = document.getElementById('llm-model');
  const llmBase = document.getElementById('llm-api-base');
  const customBaseGroup = document.getElementById('custom-base-group');
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-btn');
  const status = document.getElementById('status');

  const result = await chrome.storage.local.get(['wereadApiKey', 'llmConfig']);
  if (result.wereadApiKey) wereadKeyInput.value = result.wereadApiKey;
  if (result.llmConfig) {
    llmProvider.value = result.llmConfig.provider || 'openai';
    llmKeyInput.value = result.llmConfig.apiKey || '';
    llmModel.value = result.llmConfig.model || 'gpt-4o-mini';
    llmBase.value = result.llmConfig.apiBase || '';
  }

  llmProvider.addEventListener('change', () => {
    customBaseGroup.style.display = llmProvider.value === 'custom' ? 'block' : 'none';
    if (llmProvider.value === 'openai') {
      llmBase.value = 'https://api.openai.com/v1';
    } else if (llmProvider.value === 'anthropic') {
      llmBase.value = 'https://api.anthropic.com/v1';
    }
  });

  saveBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      wereadApiKey: wereadKeyInput.value.trim(),
      llmConfig: {
        provider: llmProvider.value,
        apiKey: llmKeyInput.value.trim(),
        model: llmModel.value.trim(),
        apiBase: llmBase.value.trim()
      }
    });
    showStatus('配置已保存', 'success');
  });

  testBtn.addEventListener('click', async () => {
    showStatus('正在测试...', 'success');
    try {
      const resp = await fetch(`${llmBase.value}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmKeyInput.value.trim()}`
        },
        body: JSON.stringify({
          model: llmModel.value.trim(),
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5
        })
      });
      if (resp.ok) {
        showStatus('连接成功', 'success');
      } else {
        const err = await resp.text();
        showStatus(`连接失败: ${err}`, 'error');
      }
    } catch (err) {
      showStatus(`连接失败: ${err.message}`, 'error');
    }
  });

  function showStatus(text, type) {
    status.textContent = text;
    status.className = 'status ' + type;
    setTimeout(() => { status.className = 'status'; }, 3000);
  }
});
