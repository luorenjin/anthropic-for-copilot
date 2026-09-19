# Changelog

All notable changes to the `anthropic-for-copilot` extension will be documented in this file.

## [0.9.0](https://github.com/luorenjin/anthropic-for-copilot/compare/v0.8.2...v0.9.0) (2026-09-19)


### Features

* add vision proxy panel styles and implement action handling ([f1041a9](https://github.com/luorenjin/anthropic-for-copilot/commit/f1041a9c284a297101e7a6c9e80baa664e68250d))
* Implement debounce for model picker refresh ([256693b](https://github.com/luorenjin/anthropic-for-copilot/commit/256693bf5de973620e4d27aff52aca1bb6b04a40))
* **skills:** 在请求流水线中接入技能索引裁剪并写入 dump 元数据 ([9f34b8f](https://github.com/luorenjin/anthropic-for-copilot/commit/9f34b8f7f29a98f777c64197906473e42a5ebf41))
* **skills:** 基于词法 IDF 打分的确定性 Top-K 技能选择 ([434772b](https://github.com/luorenjin/anthropic-for-copilot/commit/434772b57e083e95c8727f7cc2c6164ec3f3c30e))
* **skills:** 技能索引裁剪的一次性通知与测试用 LM API 桩 ([5d29ad7](https://github.com/luorenjin/anthropic-for-copilot/commit/5d29ad7986097a5507ad818e5917916696c240bc))
* **skills:** 技能索引裁剪编排、缓存安全的尾部注入与诊断日志 ([2b077a2](https://github.com/luorenjin/anthropic-for-copilot/commit/2b077a292da0e70acde096ca0f7675786957d491))
* **skills:** 新增 anthropic-copilot.skillIndex.* 设置 ([af020d1](https://github.com/luorenjin/anthropic-for-copilot/commit/af020d10c696ca510275df3a736f21daedecb504))
* **skills:** 渲染系统提示桩与 relevant_skills 追加块 ([d14b88f](https://github.com/luorenjin/anthropic-for-copilot/commit/d14b88fe3c842bff5b33e38203e395363c372c13))
* **skills:** 解析 Copilot 系统提示中的 &lt;skills&gt; 索引块 ([b1f8bc5](https://github.com/luorenjin/anthropic-for-copilot/commit/b1f8bc557b4841038997e9877bfe5b2644c9c02c))
* 支持凭证方案区分、Claude Code 配置读取与 1M 上下文 beta ([742ba27](https://github.com/luorenjin/anthropic-for-copilot/commit/742ba27ca6b3cad81f8fa185e74da174b57a96da))
* 过滤 OAuth 网关拒绝的 mcp_ 工具名，并在扩展关停时静默 Canceled 告警 ([9e55655](https://github.com/luorenjin/anthropic-for-copilot/commit/9e556558ebfae274af8c7f51984e5d7746c24c59))


### Bug Fixes

* Correct maxInputTokens for models ([256693b](https://github.com/luorenjin/anthropic-for-copilot/commit/256693bf5de973620e4d27aff52aca1bb6b04a40))
* **skills:** 按提示内容而非请求分类决定是否裁剪，并提高默认阈值 ([798099c](https://github.com/luorenjin/anthropic-for-copilot/commit/798099c1c674cccd1089ad6982bde12618d20de4))
* **skills:** 无 &lt;userRequest&gt; 时按内容而非位置选取请求消息，修复缓存字节稳定性 ([50526c3](https://github.com/luorenjin/anthropic-for-copilot/commit/50526c31660a924d8e3c29bb3ccf38ad6926a033))
* 将 vscode.lm 供应商 id 改为 anthropic-copilot，避免与 Copilot Chat 内置 BYOK 提供程序冲突 ([7154392](https://github.com/luorenjin/anthropic-for-copilot/commit/715439260f2294fc86d099762cf95331b677e012))
* 更新链接以反映维护者的 GitHub 用户名变更 ([a9b4475](https://github.com/luorenjin/anthropic-for-copilot/commit/a9b4475d50a899ade871a92e455e0b54f16952ab))


### Documentation

* **skills:** 技能索引裁剪的通知文档、README 配置说明与 CLAUDE.md ([d03702f](https://github.com/luorenjin/anthropic-for-copilot/commit/d03702fc6bd751559335cd1d75e547746731e782))
* **skills:** 收录技能索引裁剪的设计规格与实施计划 ([854a735](https://github.com/luorenjin/anthropic-for-copilot/commit/854a735bf35cf14c6944cedacf7a065b2a22d578))
* 修正 CLAUDE.md 中 stats.reason 的适用范围（error 路径不设 reason） ([2495899](https://github.com/luorenjin/anthropic-for-copilot/commit/249589967095ac2478d1511a4aecc23fe5290a3d))
* 添加技能索引裁剪的计划和进展记录 ([b847066](https://github.com/luorenjin/anthropic-for-copilot/commit/b84706683382cae4aecfd15386d5f63cf96790e9))

## [Unreleased]

### Fixed
- **Model picker vendor id collision with Copilot Chat's built-in Anthropic BYOK provider**: This extension previously registered its models under the `vscode.lm` vendor id `anthropic`, the same id GitHub Copilot Chat's own bundled Anthropic BYOK provider registers for itself. VS Code only allows one registrant per vendor id; whichever extension registered second would throw and fail to activate, which is why Claude models sometimes disappeared from the picker after install/update and only came back after `Developer: Reload Window`. The vendor id is now `anthropic-copilot`, eliminating the collision. **Action needed after updating:** re-select the Claude model in the Copilot Chat model picker, since it now appears under a new vendor entry.

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
