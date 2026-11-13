---
name: pi-provider
description: "Inspect BB Pi provider support for message editing and context compaction."
---

# Pi provider

Pi supports editing and rerunning eligible user messages and compacting idle or
errored threads through the core `bb thread edit-message` and `bb thread compact`
commands. Inspect the thread first and use live command help for arguments.
Provider confirmation determines whether the operation completed.

Use the target host's provider catalog for available models and execution options.
The optional OpenAI Platform API key is configured in the Pi provider's plugin
settings; bb stores it as a secret and passes it to Pi only when configured.
OpenAI Codex, Gemini API, and Antigravity are separate provider routes.
