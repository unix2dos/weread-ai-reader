# Use SSE for short judgement streaming

The Chrome extension will upload a reading snapshot first, receive a `snapshotId` plus the signal panel, then open an SSE stream for the short reading-value judgement. This lets the UI show WeRead Skill signals immediately while the AI judgement arrives progressively.

## Considered Options

- Single HTTP response: simpler, but blocks the AI panel until LLM generation finishes and weakens the real-time reading companion feel.
- SSE stream after snapshot upload: slightly more routing and UI state, but matches the desired signal-first and judgement-streaming interaction.
