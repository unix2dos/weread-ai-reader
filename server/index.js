const { createApp } = require('./createApp');
const { createLlmClient } = require('./llmClient');
const { createWeReadClient } = require('./wereadClient');

const config = {
  port: Number(process.env.PORT || 19763),
  clientToken: process.env.CLIENT_TOKEN || 'dev-token'
};

const app = createApp({
  config,
  wereadClient: createWeReadClient({
    apiKey: process.env.WEREAD_API_KEY,
    apiBase: process.env.WEREAD_API_BASE,
    skillVersion: process.env.WEREAD_SKILL_VERSION
  }),
  llmClient: createLlmClient({
    apiKey: process.env.LLM_API_KEY,
    apiBase: process.env.LLM_API_BASE,
    model: process.env.LLM_MODEL
  }),
  logger: console
});

app.listen(config.port, () => {
  console.log(`[WeRead AI Agent] listening on http://127.0.0.1:${config.port}`);
  console.log(`[WeRead AI Agent] LLM model: ${process.env.LLM_MODEL || 'gpt-4.1-nano'}`);
});
