const DEFAULT_AGENT_CONFIG = {
  serverUrl: 'http://127.0.0.1:19763',
  clientToken: 'dev-token'
};
const OLD_DEFAULT_SERVER_URL = 'http://127.0.0.1:8787';

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

  return false;
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
