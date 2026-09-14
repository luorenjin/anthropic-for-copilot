# Changelog

All notable changes to the `anthropic-for-copilot` extension will be documented in this file.

## [Unreleased]

### Added
- **Skills Index Trimming**: When Copilot Chat injects a large Agent Skills index into the system prompt (more than `anthropic-copilot.skillIndex.threshold` entries, default 128), the extension now replaces it with a short stub and appends only the `anthropic-copilot.skillIndex.maxRelevant` (default 12) skills most relevant to each user request. Selection is deterministic so the Anthropic prompt-cache prefix is preserved across turns. A one-time notice links to `docs/notices/skill-index.*.md`; set `anthropic-copilot.skillIndex.mode` to `off` to disable.

## [1.0.0] - 2026-09-09

### Added
- **Anthropic Claude 5 Model Family**: Initial release supporting Anthropic's flagship Claude models:
  - **Fable 5.1** (`claude-fable-5.1`): 1M context reasoning & creative model.
  - **Opus 5** (`claude-opus-5`): 1M context flagship reasoning model.
  - **Sonnet 5** (`claude-sonnet-5`): 1M context high-performance general model.
- **1M Token Context Window**: Full 1,000,000 token input context window for large codebase context in GitHub Copilot Chat.
- **Anthropic Messages API Integration**: Native support for `POST /v1/messages` with top-level `system` prompt, native base64 image inputs, `tool_use` and `tool_result` content blocks, and extended thinking (`thinking` block signature replay).
- **Flexible Authentication & Environment Variables**: Supports `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_API_KEY`, `CLAUDE_AUTH_TOKEN`, and VS Code SecretStorage.
- **CC-SWITCH & Custom Endpoint Support**: Full support for custom Base URLs via `anthropic-copilot.baseUrl` and environment variables `ANTHROPIC_BASE_URL`, `CLAUDE_BASE_URL`.
- **Extended Thinking & Reasoning Control**: Integrated reasoning effort configuration (`low`, `high`, `max`) with automatic budget calculation (`thinking.budget_tokens`).
- **Native Vision & Multi-modal Support**: Built-in support for native image input processing.
