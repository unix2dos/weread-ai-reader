const DEFAULT_WEREAD_API_BASE = 'https://i.weread.qq.com';
const DEFAULT_WEREAD_SKILL_VERSION = '1.0.3';

function createWeReadClient({
  apiKey,
  apiBase = DEFAULT_WEREAD_API_BASE,
  skillVersion = DEFAULT_WEREAD_SKILL_VERSION,
  fetchImpl = fetch
}) {
  return {
    async call(apiName, params = {}) {
      if (!apiKey) {
        throw new Error('WEREAD_API_KEY is not configured');
      }

      const resp = await fetchImpl(`${apiBase}/api/agent/gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          api_name: apiName,
          skill_version: skillVersion,
          ...params
        })
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`WeRead API ${apiName} failed: ${resp.status} ${text}`);
      }

      const data = await resp.json();
      if (data.upgrade_info) {
        throw new Error(`WeRead Skill upgrade required: ${data.upgrade_info.message || 'upgrade_info returned'}`);
      }
      if (data.errcode && data.errcode !== 0) {
        throw new Error(`WeRead API ${apiName}: ${data.errmsg || 'unknown error'}`);
      }

      return data;
    }
  };
}

module.exports = {
  createWeReadClient
};
