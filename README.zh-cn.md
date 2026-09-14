<h1 align="center">Anthropic Claude for Copilot Chat</h1>

<p align="center">
  <img src="resources/icon.png" alt="Anthropic Claude Logo" width="120" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code%20Extension-v1.0.0-d97757?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="版本" />
  <img src="https://img.shields.io/badge/Anthropic-Messages%20API-d97757?style=for-the-badge" alt="Anthropic Messages API" />
  <img src="https://img.shields.io/badge/上下文-1M%20Tokens-d97757?style=for-the-badge" alt="1M 上下文" />
</p>

<p align="center">
  <a href="README.md">English</a> |
  简体中文
</p>

**直接在 VS Code Copilot Chat 模型选择器中使用拥有 1M 超长上下文的 Anthropic Claude 5 系列模型（Sonnet 5, Opus 5, Fable 5.1），同时完整保留 GitHub Copilot 的所有 Agent 工具与原生界面。**

---

## 🌟 为什么选择本扩展？

喜欢 Anthropic Claude 卓越的推理能力、编程表现和 **1M Tokens** 超大上下文，但又不想放弃 GitHub Copilot 的 Agent 模式、工具调用以及流畅的编辑器集成体验？

本扩展将 **Anthropic Claude 5 代模型 (Sonnet 5, Opus 5, Fable 5.1)** 无缝接入 VS Code 原生 Copilot Chat 模型选择器，带来 **1M 精准上下文**、**自定义 API Key & Base URL**、**CC-SWITCH 原生适配**、**原生多模态视觉理解**、**思维链 (Extended Thinking)** 以及 **Agent 工具调用**。

---

## ✨ 核心特性

### 1. Anthropic 5 代旗舰模型 (1M 上下文)
- **Sonnet 5** (`claude-sonnet-5`) — 高性能全能旗舰模型，**1,000,000 Tokens (1M)** 上下文。
- **Opus 5** (`claude-opus-5`) — Anthropic 最强逻辑与深度推理模型，**1,000,000 Tokens (1M)** 上下文。
- **Fable 5.1** (`claude-fable-5.1`) — 深度思维与创意推理模型，**1,000,000 Tokens (1M)** 上下文。

### 2. 自定义 API Key & Base URL (BYOK 与代理支持)
- **自定义 Base URL**：配置 `anthropic-copilot.baseUrl`（默认为 `https://api.anthropic.com`），支持无缝接入官方端点、One API、OpenRouter 或自定义反向代理。
- **加密存储**：通过运行 `Anthropic: 设置 API Key` 安全保存密钥或 Token，秘钥加密保存在 OS Keychain (SecretStorage) 中，绝不写入本地文件。

### 3. CC-SWITCH 与环境变量无缝自动检测
原生兼容 **CC-SWITCH** 等 Claude Code 开发者工具与中转管理软件：
- 自动检测并读取 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`、`CLAUDE_AUTH_TOKEN` 与 `CLAUDE_API_KEY`。
- 自动继承 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_URL` 或 `CLAUDE_BASE_URL` 代理地址，实现无感平滑切换。

### 4. 深度思维链 (Thinking) 与原生多模态
- 完整支持 Claude **Extended Thinking** (`thinking` 块)，思考过程直接渲染在 Copilot Chat 的可折叠思考视图中。
- 支持 **原生多模态视觉理解**（base64 图片上传与识别）及 Function Calling 工具调用。

### 5. 继承 Copilot 的全套能力
基于 VS Code 原生 `LanguageModelChatProvider` API 构建，完美兼容 Copilot 全部生态：
- **Agent 模式** — 自主多步骤代码重构与开发。
- **Tool calling** — 工作区搜索、文件修改、终端命令执行、Git 交互。
- **指令与技能** — `.instructions.md`、`AGENTS.md` 及 Prompt 技能完美运行。

---

## 🚀 快速开始

### 前置要求
- VS Code `1.116.0` 或更高版本。
- GitHub Copilot 订阅（Free、Pro 或 Enterprise 均可）。
- Anthropic API Key 或 Auth Token（或代理端点 Token）。

### 安装与使用

1. **安装插件**：
   - 方式 1：在 VS Code 扩展视图中选择 `从 VSIX 安装...`，选择 `anthropic-for-copilot.vsix`。
   - 方式 2：在终端运行：
     ```bash
     code --install-extension anthropic-for-copilot.vsix
     ```

2. **配置 API Key / Token**：
   - 按 `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`) 打开命令面板，运行 **`Anthropic: 设置 API Key`**，输入 Key 或 Token。
   - *或者*：在环境变量中设置 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`。

3. **配置自定义 Base URL (可选)**：
   - 如使用第三方中转代理或 CC-SWITCH，运行 **`Anthropic: 打开设置`**，在 `anthropic-copilot.baseUrl` 中填写代理端点。

4. **开始对话**：
   - 打开 Copilot Chat (`Ctrl+Alt+I`)，在模型选择器中切换到 **Sonnet 5**、**Opus 5** 或 **Fable 5.1**，畅享 1M 超长上下文！

---

## ⚙️ 配置属性说明

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `anthropic-copilot.baseUrl` | `string` | `"https://api.anthropic.com"` | Anthropic API Base URL（支持自定义代理或 CC-SWITCH 端点） |
| `anthropic-copilot.maxTokens` | `number` | `0` | 每次请求最大输出 Token 数（0 表示使用模型默认上限） |
| `anthropic-copilot.modelIdOverrides` | `object` | `{}` | 自定义模型 ID 映射（用于代理服务端点不同模型名的场景） |
| `anthropic-copilot.debugMode` | `string` | `"minimal"` | 诊断日志模式 (`minimal`, `metadata`, `verbose`) |
| `anthropic-copilot.skillIndex.mode` | `string` | `"auto"` | Copilot 技能索引过大时是否裁剪（`auto`）或原样转发（`off`），详见[文档](docs/notices/skill-index.zh.md) |
| `anthropic-copilot.skillIndex.threshold` | `number` | `128` | 索引条数严格大于该值才裁剪（`0` 表示总是裁剪） |
| `anthropic-copilot.skillIndex.maxRelevant` | `number` | `12` | 裁剪后每条用户请求最多追加的技能数（1–64） |

---

## 🔒 安全与隐私

- 所有 API Key 和 Token 均保存在 VS Code 的加密 `SecretStorage`（Windows 凭据管理器 / macOS Keychain / Linux Secret Service）中。
- 零运行时依赖 — 仅使用 Node.js 原生 `fetch` 与 VS Code 标准 API，轻量安全。

---

## 📄 开源协议

[MIT License](LICENSE) © Luorj
