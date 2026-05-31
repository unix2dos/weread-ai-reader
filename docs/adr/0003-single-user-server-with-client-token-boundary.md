# Start with a single-user Agent server and keep a client token boundary

V1 will run as a single-user Agent server for the project author, but Chrome extension requests must still include a `clientToken`. The server maps that token to a default user in V1, preserving a clear boundary for future multi-user hosted usage without changing the extension protocol.

## Considered Options

- No token for local V1: simpler, but makes later sharing require a protocol change and weakens log/cache ownership.
- Full multi-user accounts now: better for public sharing, but premature before the reading-value workflow is proven.
