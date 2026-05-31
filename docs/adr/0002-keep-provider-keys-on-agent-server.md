# Keep WeRead and LLM keys on the Agent server

Chrome extensions will not store the WeRead API Key or LLM API Key. The extension only sends reading snapshots to the Agent server with a server URL and development access token, while the server owns official WeRead Skill calls, LLM calls, caching, and logging.

## Considered Options

- Store keys in the extension: simpler for a local prototype, but it exposes provider credentials to the browser surface and makes future deployment harder.
- Store keys on the Agent server: adds a server configuration step, but keeps the collector thin and preserves the intended Agent orchestration boundary.
