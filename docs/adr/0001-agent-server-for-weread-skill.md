# Use an Agent server for WeRead Skill orchestration

V1 will use a browser-side collector plus an Agent server instead of a pure Chrome extension. The collector captures the current WeRead web reading context, while the server calls the official WeRead Skill and the LLM so credentials, caching, streaming, and future Agent workflows stay outside the browser extension.

## Considered Options

- Pure Chrome extension: simpler to install, but it cannot naturally host the official Skill workflow and would expose more orchestration and credential handling to the browser.
- Agent server: adds deployment work, but matches the goal of summarizing live page text together with WeRead Skill data.
