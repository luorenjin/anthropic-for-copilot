# Copilot Skills 索引按需裁剪 — 设计文档

日期：2026-09-14
状态：设计已确认，待实现
范围：`anthropic-for-copilot` 扩展（Copilot Chat → Anthropic Messages API 转换层）

## 1. 背景与证据

VS Code Copilot Chat 启用 Agent Skills 后，会把它发现的每一个技能以索引形式注入系统提示：

```
<instructions>
<skills>
Here is a list of skills that contain domain specific knowledge on a variety of topics.
Each skill comes with a description of the topic and a file path that contains the detailed instructions.
When a user asks you to perform a task that falls within the domain of a skill, use the 'read_file' tool to acquire the full instructions from the file URI.
<skill>
<name>007</name>
<description>Security audit, hardening, threat modeling …</description>
<file>c:\Users\user\.agents\skills\007\SKILL.md</file>
</skill>
…
</skills>
</instructions>
```

技能正文并不在提示里，模型靠 `read_file` 按需加载；索引本身却是无条件全量注入的。本扩展 verbose dump（`request-dumps/`）里的实测数据：

| 观测项 | 数值 |
|---|---|
| `<skills>` 块大小（2026-09-09，来源 `~/.agents/skills`） | 480,685 字符，1,551 条 |
| 该块在系统提示中的位置 | 偏移 10,360 起；其后还有约 19KB（`<agents>` 等） |
| 含该块的会话数 | 30 / 75 |
| 同一会话内多次请求的块哈希 | 完全一致（字节稳定） |
| 每条 `<skill>` 平均大小 | 约 320 字符 |
| 扩展当前发送方式 | `system` 为单个字符串；未设置任何 `cache_control` |

后果：每次请求携带十几万 token 的无关索引；在 200K 上下文模型上几乎占满窗口；配合 OAuth 网关曾直接触发请求失败。

扩展现有代码只在 `provider/debug/diagnostics.ts`、`provider/debug/dump.ts`、`provider/routing/classifier.ts` 中**探测**这个块，没有任何裁剪逻辑。

## 2. 目标与非目标

**目标**

1. 技能数量超过阈值时，模型只看到与当前请求最相关的至多 K 条索引，其余不进入提示。
2. 裁剪不引入新的缓存失效：出站请求的前缀在会话内保持字节稳定。
3. 无额外 LLM 调用、无网络请求；全部在进程内以确定性算法完成。
4. 阈值内的用户零行为变化；默认开启；可一键关闭。
5. 任何解析或处理异常都退化为原样透传，绝不因优化步骤拖垮请求。

**非目标**

- 不做基于 LLM 的语义检索。
- 不裁剪 `<agents>` 块或 Copilot 其他指令段。
- 不实现扩展私有的 `search_skills` 工具（见第 12 节"后续工作"）。
- 不修改 `tools` 数组，不改动 OAuth 身份 system block 的构造逻辑。

## 3. 总体架构

### 3.1 方案选择

已比较三种方案并选定方案 A：

| 方案 | 做法 | 结论 |
|---|---|---|
| A（选定） | 系统提示中整块替换为固定桩；对每条用户请求消息按其文本确定性选出 Top-K 追加到消息尾部；历史消息每轮重算 | 相关性逐轮自适应；选择是纯函数，历史重算结果与上一轮字节一致，前缀缓存不受影响 |
| B | 用首条用户消息算一次子集，就地改写系统提示 | 相关性冻结在首句；若累积并集则每次新增都打穿缓存 |
| C | 桩 + 扩展内部处理的 `search_skills` 工具 | 最省 token，但需要 provider 内子循环、受 128 工具上限与 OAuth 工具名校验牵制，Copilot 历史中缺少这对调用会导致下一轮前缀漂移 |

### 3.2 接入点

`src/provider/index.ts` 的 `provideLanguageModelChatResponse` 流水线中，在 `processToolFlow` 返回且未短路（`preflightHandled === false`）之后、`prepareChatRequest` 之前插入：

```ts
const skillIndex = processSkillIndex({
	messages: toolFlow.messages,
	rawMessages: messages,
	requestKind,
	settings: getSkillIndexSettings(),
});
const prepared = await prepareChatRequest({
	…,
	messages: skillIndex.messages,
	skillIndexStats: skillIndex.stats,
});
return streamChatCompletion({
	…,
	initialResponseNotice: joinInitialResponseNotices(
		toolFlow.initialResponseNotice,
		skillIndex.initialResponseNotice,
		prepared.initialResponseNotice,
	),
});
```

选择此位置的理由：

- 位于 `dumpProviderInput` 之后：verbose 模式下 provider-input dump 保留 Copilot 原始输入，`dumpAnthropicRequest` 记录裁剪后的实际出站请求，两侧均可核对。
- 位于 `processToolFlow` 之后：preflight 短路整轮时不做无用功。
- 位于 `prepareChatRequest` 之前：操作对象是 VS Code 消息，`convert.ts`、vision 管线、replay marker 逻辑均不改动。
- **裁剪与否只看提示内容，不看 `requestKind`。** 曾按 `requestKind === 'main-agent'` 门控，理由是"其他类型请求本来不携带该块"——该前提对 `terminal-steering` 不成立：`classifyProviderRequest` 先按最新一条用户消息是否匹配 `[Terminal … notification:` 判定，根本不看系统提示。Agent 跑完一条终端命令后 Copilot 触发的那一轮就会命中，于是整份 480KB 索引原样发出、历史追加块全部消失，约 13 万 token 前缀未命中。现改为无条件解析，`requestKind` 只用于给"找不到块"这一结果贴标签（`main-agent` → `absent`，其余 → `not-applicable`，后者不打日志）。

### 3.3 数据流

```
messages (VS Code)
  └─ System 消息文本 ──parseSkillIndex──▶ index (N 条)
        mode=off / 无可用索引 ──▶ 原引用透传（无块时按 requestKind 贴 absent 或 not-applicable 标签）
        N ≤ threshold                    ──▶ 原引用透传
        N >  threshold ──▶ System 文本：<skills>…</skills> → renderSkillIndexStub(N)
                           每条"请求消息"：
                              query.current  = 该消息 <userRequest> 内文
                              query.previous = 上一条请求消息 <userRequest> 内文
                              picks = selectRelevantSkills(model, query, K)
                              picks 非空时追加 TextPart(renderRelevantSkillsBlock(picks))
```

## 4. 模块设计

新增目录 `src/provider/skills/`，遵循仓库 barrel 约定：外部只从 `index.ts` 导入。

| 文件 | 职责 | 依赖 `vscode` |
|---|---|---|
| `consts.ts` | 默认阈值、默认 K、查询截断长度、权重常量、`<relevant_skills>` 标签名、通知起止标记 | 否 |
| `parse.ts` | 定位并解析 `<skills>` 块 | 否 |
| `select.ts` | 分词、IDF 模型构建、Top-K 选择 | 否 |
| `render.ts` | 生成系统提示桩、`<relevant_skills>` 块；提取 `<userRequest>` 内文 | 否 |
| `flow.ts` | 编排：配置 → 解析 → 阈值 → 改写 System part → 追加请求消息 part → 统计与通知 | 是 |
| `index.ts` | barrel | — |

### 4.1 `parse.ts`

```ts
export interface SkillIndexEntry {
	name: string;
	description: string;
	file: string;
	/** 从 <skill> 到 </skill> 的原文，逐字节保留，渲染时直接复用 */
	raw: string;
}

export interface ParsedSkillIndex {
	/** 可解析（含 <name>）的条目 */
	entries: SkillIndexEntry[];
	/** 全部 <skill> 出现次数，含无法解析的条目；用于阈值判断与桩文本 */
	totalCount: number;
	/** <skills> 起始偏移（含标签） */
	blockStart: number;
	/** </skills> 结束偏移（含标签，exclusive） */
	blockEnd: number;
	/** 块原文哈希，用于诊断 */
	hash: string;
}

export function parseSkillIndex(systemText: string): ParsedSkillIndex | undefined;
```

规则：

- 系统文本中必须恰好出现一次 `<skills>`，且其后存在 `</skills>`；否则返回 `undefined`。
- 条目按 `<skill>…</skill>` 切分；`<name>` 缺失的条目跳过但计入 `totalCount`。
- `description`、`file` 缺失时取空字符串，不影响条目参与选择。
- 不做任何 XML 反转义或空白规范化，`raw` 与原文逐字节一致。

### 4.2 `select.ts`

```ts
export interface SkillSelectionQuery {
	current: string;
	previous?: string;
}

export interface SkillIndexModel {
	entries: readonly SkillIndexEntry[];
	/** 每条目 token → 权重（name 词元 3，description 词元 1，同一 token 取最大权重） */
	weights: ReadonlyArray<ReadonlyMap<string, number>>;
	/** token → ln(1 + N / df) */
	idf: ReadonlyMap<string, number>;
}

export function tokenize(text: string): string[];
export function buildSkillIndexModel(entries: readonly SkillIndexEntry[]): SkillIndexModel;
export function selectRelevantSkills(
	model: SkillIndexModel,
	query: SkillSelectionQuery,
	maxRelevant: number,
): SkillIndexEntry[];
```

**分词**（`tokenize`）

1. 小写化。
2. 拉丁字母/数字连续串按非字母数字边界切分；`kebab-case`、`snake_case` 名称因此自动拆为子词；保留长度 ≥ 2 的词元。
3. 中日韩统一表意文字连续串切成相邻双字 bigram；长度为 1 的串保留单字。
4. 过滤停用词：英文小表（the, a, an, to, for, of, and, or, in, on, with, this, that, is, are, be, use, when, user, users, asks, ask, your, you, it, as, by, from, at, into, will, can, should, any, all, etc.）与中文虚词表（的, 了, 是, 在, 和, 与, 或, 请, 我, 你, 帮, 我们, 一下, 一个, 这个, 那个, 进行, 需要, 可以, 如何, 什么, 怎么, etc.）。具体表在 `consts.ts` 中维护，测试覆盖代表项即可。

**模型构建**（`buildSkillIndexModel`）

- 每条目权重表：name 词元权重 3，description 词元权重 1；同一 token 在两处都出现时取 3。
- `df(t)` = 含 token t 的条目数；`idf(t) = ln(1 + N / df(t))`，N 为 `entries.length`。
- 模型在一次请求内只构建一次，供所有请求消息复用。

**打分与选择**（`selectRelevantSkills`）

- `current` 与 `previous` 各截取前 `QUERY_MAX_CHARS = 2000` 字符后分词并去重为集合 Q_cur、Q_prev。
- `score(e) = Σ_{t ∈ Q_cur} w_e(t)·idf(t) + 0.5 · Σ_{t ∈ Q_prev \ Q_cur} w_e(t)·idf(t)`，其中 `w_e(t)` 为条目 e 中 t 的权重，缺失为 0。
- 排序：score 降序；同分按 `name` 的码点序升序；再同则按索引顺序。
- 取前 `maxRelevant` 条且 `score > 0`；结果按上述排序返回。

所有步骤均为纯函数，对相同输入产生相同输出。

### 4.3 `render.ts`

```ts
export function renderSkillIndexStub(totalCount: number): string;
export function renderRelevantSkillsBlock(entries: readonly SkillIndexEntry[]): string;
export function extractUserRequestText(messageText: string): string | undefined;
```

**系统提示桩**（替换整个 `<skills>…</skills>`，外层 `<instructions>` 不动）：

```
<skills>
{N} skills with domain-specific instructions are available in this workspace.
To keep this prompt compact, only the skills most relevant to each user request are listed inside a <relevant_skills> block appended to that request, using the same <skill> format.
When a task falls within the domain of a listed skill, use the 'read_file' tool to acquire the full instructions from the file path.
If the user names a skill that is not listed, ask them for its file path.
</skills>
```

桩文本除 `{N}` 外完全固定；N 仅随索引变化而变化，而索引变化本身已意味着系统提示改变。

**请求消息追加块**：

```
<relevant_skills>
<skill>
…条目 raw 原文…
</skill>
…（≤ K 条，按 select 返回顺序）
</relevant_skills>
```

以 `'\n' + block` 作为一个新的 `LanguageModelTextPart` 追加到消息 `content` 末尾。

**`extractUserRequestText`**：返回第一对 `<userRequest>…</userRequest>` 之间的文本（去首尾空白）；无匹配返回 `undefined`。

### 4.4 `flow.ts`

```ts
export interface SkillIndexSettings {
	mode: 'auto' | 'off';
	threshold: number;   // ≥ 0 的整数
	maxRelevant: number; // 1–64 的整数
}

export interface SkillIndexStats {
	action: 'off' | 'not-applicable' | 'absent' | 'passthrough' | 'trimmed' | 'error';
	threshold: number;
	maxRelevant: number;
	totalCount?: number;
	requestMessages?: number;
	injectedCounts?: number[];
	systemCharsBefore?: number;
	systemCharsAfter?: number;
	indexHash?: string;
}

export interface SkillIndexFlowOptions {
	/** processToolFlow 输出的消息（已剥离 notice 与 preflight 控制流） */
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	/** provider 收到的原始消息，用于检测历史中是否已展示过通知 */
	rawMessages: readonly vscode.LanguageModelChatRequestMessage[];
	requestKind: RequestKind;
	settings: SkillIndexSettings;
}

export interface SkillIndexFlowResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	stats: SkillIndexStats;
	initialResponseNotice?: string;
}

export function processSkillIndex(options: SkillIndexFlowOptions): SkillIndexFlowResult;
```

处理顺序：

1. `mode === 'off'` → `action: 'off'`，返回原 `messages` 引用。
2. 无条件在 System 角色消息（`LanguageModelChatMessageRole.System`）中查找索引。找不到可用索引时返回原引用，`action` 按 `requestKind === 'main-agent' ? 'absent' : 'not-applicable'`，并附 `reason`：无 `<skills>` 文本为 `no-skills-text`；含 `<skills>` 的文本 part 多于一个为 `multiple-system-parts`；`parseSkillIndex` 拒绝为 `unparseable-block`。后两者另发一条不受 debug 开关约束的 `logger.info`（`no-skills-text` 保持静默，它是绝大多数请求的常态）。
3. `totalCount <= threshold` → `action: 'passthrough'`，返回原引用。
4. 改写 System 消息：目标 text part 替换为 `text.slice(0, blockStart) + renderSkillIndexStub(totalCount) + text.slice(blockEnd)`；消息对象以展开拷贝方式生成（`{ ...message, content: […] }`），不修改输入对象。
5. 确定**请求消息**集合：
   - 候选 = 角色 User，且至少含一个 `LanguageModelTextPart`，且拼接文本中 `extractUserRequestText` 返回非 `undefined`。
   - 若整个会话没有候选（非 Agent 场景），退化为"每一条含文本 part 的 User 消息"，各自以自身全文为查询。**不得**退化为"最后一条"——那是消息位置与会话长度的函数，会使该路径上第 N 轮注入的消息在第 N+1 轮失去追加块，前缀分叉，违反 §5 不变量。内容寻址的退化路径之所以安全，与主路径同理：历史只追加，任一消息之前的请求消息集合跨轮不变。
   - tool_result 消息（无文本 part）与环境预置消息（无 `<userRequest>`）因此自然排除。
6. 对每条请求消息，`query.previous` 取按顺序更早的最近一条请求消息的 `<userRequest>` 文本；调用 `selectRelevantSkills`；结果非空时追加 text part。`injectedCounts` 记录每条消息注入数（含 0）。
7. 通知判定：若 `rawMessages` 中任一 Assistant 文本 part 含 `SKILL_INDEX_NOTICE_START`，则不再生成通知；否则 `initialResponseNotice = createSkillIndexNotice(totalCount, maxRelevant)`。
8. 整个函数体包在 try/catch 中；异常时 `logger.warn` 并返回原引用，`action: 'error'`（该路径不设 `reason`）。
9. 调用 `logSkillIndexDiagnostics(stats)`。

## 5. 缓存不变量

Anthropic 前缀缓存要求字节级一致：渲染顺序为 `tools → system → messages`，任一位置变化都使其后全部失效。本设计满足：

1. **系统提示**：桩替换发生在会话内字节稳定的块上；桩本身固定。块之前的内容不变；之后的内容整体前移但在会话内不变。
2. **历史请求消息**：追加块 = `f(该消息 <userRequest> 文本, 上一条请求消息 <userRequest> 文本, 索引, K)`。四个输入在会话内都稳定，因此第 N+1 轮对第 1…N 条请求消息重算出的追加块与第 N 轮发送的逐字节一致。
3. **Agent 模式工具往返**：同一用户请求内的多次 provider 调用共享同一条最新请求消息，追加块相同，工具往返部分照常追加在其后。
4. **索引中途变化**（Copilot customizations 更新）：系统提示本身即变化，与今天的行为一致，不构成新增失效。
5. **通知**：随助手回复进入 Copilot 历史，下一轮由 `filterProviderNotices` 剥离，与 tool-drift、vision 通知机制一致。

代价：每条历史请求消息多出至多 K 条条目（K=12 时约 4KB）。相对于原先每请求 480KB，量级相差两个数量级，且历史部分全部命中缓存。

## 6. 配置

`package.json` 新增三项，`markdownDescription` 走 `%key%` 占位符，`package.nls.json` 与 `package.nls.zh-cn.json` 同步：

| 设置 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `anthropic-copilot.skillIndex.mode` | `"auto"` \| `"off"` | `"auto"` | `off` 时完全透传 |
| `anthropic-copilot.skillIndex.threshold` | integer, minimum 0 | 128 | `totalCount > threshold` 才裁剪；0 表示总是裁剪。默认值取 128 而非更低：每条请求消息追加约 K×320 字符，R 条请求消息合计 R×K×320，而原块为 N×320，故 N ≤ R×K 时裁剪反而更费字节（K=12 时 N=33 只需 3 条请求消息即越界）。 |
| `anthropic-copilot.skillIndex.maxRelevant` | integer, 1–64 | 12 | 每条请求消息最多注入的条目数 |

`src/config.ts` 新增 `getSkillIndexSettings(): SkillIndexSettings`，对非法值做钳制（非整数取整、越界取边界、未知 mode 视为 `auto`）。设置变化不需要重启：每次请求读取。

## 7. 诊断

- `src/provider/debug/diagnostics.ts` 新增 `logSkillIndexDiagnostics(stats: SkillIndexStats)`，仅在 `getDebugLoggingEnabled()` 时输出一行：
  `skillIndex action=trimmed entries=1551 threshold=128 maxRelevant=12 requestMessages=3 injected=[12,12,0] systemChars=510025→29500 indexHash=3dbb4d52db`
  未找到可用索引时追加 `reason=`（`no-skills-text` / `multiple-system-parts` / `unparseable-block`）；系统文本含 `<skills>` 字面量却解析失败时，另有一条不受 debug 开关约束的 `logger.info`，否则用户只会看到功能静默失效。
- `dumpAnthropicRequest` 的选项增加 `skillIndexStats?: SkillIndexStats`，写入 request dump 元数据，与 `visionStats` 并列。
- 现有 `HostPromptTrace.hasSkillsTag / skillTagCount` 代码不改动，但**语义会变**：`request.ts` 传给 `cacheDiagnostics.beginRequest` 的是裁剪后的消息，因此裁剪生效时 `systemChars`/`systemHash` 反映的是桩而非 Copilot 原文，`skillTagCount` 恒为 1（来自桩文本中 "`<skill>` format" 这处字面量）。这对缓存诊断是正确的——它要看的就是实际出站内容；Copilot 侧原文改由 verbose 模式的 provider-input dump 保留。

## 8. 一次性通知

- `src/provider/tools/consts.ts` 增加 `SKILL_INDEX_NOTICE_START = '[anthropic-copilot-skill-index-notice-start]: #'` 与对应 END 标记；`notices.ts` 的 `stripProviderNotices` 列表加入该对标记。
- `notices.ts` 新增 `createSkillIndexNotice(totalCount: number, maxRelevant: number): string`，结构与 `createToolDriftNotice` 相同。
- `i18n.ts` 新增 `notice.skillIndexTrimmed`：
  - zh：`ℹ️ Copilot 提供了 {0} 个技能；为节省 token，仅向模型展示与每条请求最相关的至多 {1} 个。[了解更多](https://github.com/luorenjin/anthropic-for-copilot/blob/main/docs/notices/skill-index.zh.md)`
  - en：`ℹ️ Copilot supplied {0} skills; to save tokens, only the {1} most relevant to each request are shown to the model. [Learn more](https://github.com/luorenjin/anthropic-for-copilot/blob/main/docs/notices/skill-index.en.md)`
- 显示策略：会话内首次裁剪时显示一次（见 4.4 第 8 步）。与 tool-drift 每轮显示不同，因为裁剪是持续的正常状态而非异常。

## 9. 错误处理

| 情形 | 处理 |
|---|---|
| 无 `<skills>` 文本 | `absent` / `not-applicable`，`reason: 'no-skills-text'`，透传，不打日志 |
| 多个 `<skills>` 或无闭合标签 | `absent` / `not-applicable`，`reason: 'unparseable-block'`，透传，另发一条 `logger.info` |
| 含块的 text part 不唯一 | `absent` / `not-applicable`，`reason: 'multiple-system-parts'`，透传，另发一条 `logger.info` |
| 单条条目缺 `<name>` | 跳过该条，计入 `totalCount` |
| 会话无 `<userRequest>` 消息 | 退化为每一条含文本的 User 消息，各以自身全文为查询（内容寻址，禁止按位置取"最后一条"） |
| 某请求消息得分全为 0 | 不追加块，`injectedCounts` 记 0 |
| 任意未预期异常 | `logger.warn`，`error`，透传 |

原则：本步骤是优化，失败的代价必须只是"回到今天的行为"。

## 10. 测试

全部离线，位于 `tests/unit/`，使用 `node:test` + `node:assert/strict`；`parse` / `select` / `render` 不依赖 `vscode`，可直接导入；`flow` 测试依赖 `tests/mock-vscode.js`。

**测试基础设施**：当前 `tests/mock-vscode.js` 只提供 `workspace` / `window` / `env` / `ConfigurationTarget`，不含 Language Model API。需要补充最小桩：`LanguageModelChatMessageRole = { User: 1, Assistant: 2, System: 3 }`，以及 `LanguageModelTextPart`、`LanguageModelToolCallPart`、`LanguageModelToolResultPart`、`LanguageModelDataPart` 四个只保存构造参数的类。源码与测试通过同一个被拦截的 `require('vscode')` 拿到同一组类，`instanceof` 判定成立。

### 10.1 `skill-index-parse.test.ts`

- 按 dump 真实格式构造 fixture：含英文、西班牙文、中文描述与 Windows 反斜杠路径的 4–5 条条目，外层包 `<instructions>`，块后跟 `<agents>`。
- 断言 `entries` 字段逐一正确、`raw` 与原文切片相等、`blockStart/blockEnd` 切出的正文与 `<skills>…</skills>` 一致。
- 无块 → `undefined`；未闭合 → `undefined`；两个 `<skills>` → `undefined`；缺 `<name>` 的条目被跳过但 `totalCount` 计入。

### 10.2 `skill-index-select.test.ts`

- `tokenize`：`api-design-reviewer` 拆为 `api`、`design`、`reviewer`；`数据库迁移` 产生 `数据`、`据库`、`库迁`、`迁移`；停用词 `use`、`when`、`的` 被过滤；长度 1 的拉丁词元被丢弃。
- IDF：在 N 条描述中都含 `use when the user asks` 的模板词几乎不贡献分数；仅一条含的稀有词贡献最大。
- 权重：name 命中一次高于 description 命中一次。
- 确定性：同分条目按 name 升序；相同输入两次调用结果 `deepEqual`。
- 截断：`maxRelevant` 生效；全零得分返回空数组。
- 上一轮叠加：`current = "继续"`（全停用词）、`previous = "帮我做数据库迁移"` 时仍选出迁移相关条目；且 `previous` 命中的分数为 `current` 命中同词的一半。

### 10.3 `skill-index-flow.test.ts`

- 构造 System 消息（含桩前指令、`<skills>` 块、`<agents>` 块）、环境预置 User 消息、若干含 `<userRequest>` 的 User 消息、Assistant 消息与 tool_result User 消息。
- `mode: off` → 返回同一 `messages` 引用，`action: 'off'`。
- `requestKind: 'background'` → 同一引用，`action: 'not-applicable'`。
- `totalCount <= threshold` → 同一引用，`action: 'passthrough'`。
- 超阈值：System 文本不再含原条目、含 `renderSkillIndexStub(totalCount)`、块前指令与 `<agents>` 逐字节不变；每条 `<userRequest>` 消息 `content` 长度 +1 且新 part 以 `<relevant_skills>` 开头；环境预置消息与 tool_result 消息引用不变。
- **字节一致性**：以第 N 轮消息数组运行一次得 R1；在其后追加一条 Assistant 与一条新的 `<userRequest>` User 消息构成第 N+1 轮，运行得 R2；断言 R2 前 `R1.messages.length` 条消息的全部文本 part 与 R1 对应消息逐字节相等。
- 通知：`rawMessages` 中无标记时返回 `initialResponseNotice`；某 Assistant part 含 `SKILL_INDEX_NOTICE_START` 时返回 `undefined`。
- 无 `<userRequest>` 的会话：每一条含文本的 User 消息各被追加一次，按自身全文选择；tool_result 消息仍按引用透传。
- **退化路径的字节一致性**：无 `<userRequest>` 的会话在第 N 轮与第 N+1 轮（追加一条助手消息与一条新用户消息）各跑一次，较早一轮的每条消息逐字节复现。该用例对旧的"最后一条"实现必须失败。
- 异常兜底：传入 `content` 不是数组的畸形 System 消息对象，触发内部异常 → `action: 'error'`，返回原 `messages` 引用，且不抛出。

### 10.4 验证命令

```
npm run compile
npm run lint
npm run format:check
npm test
```

可选真机验证：向 `~/.agents/skills` 放回大量技能，`anthropic-copilot.debugMode` 设为 `verbose`，在 Agent 模式对话两轮后比较 provider-input dump 与 request dump 中系统提示大小及 `<relevant_skills>` 块，并确认第二轮 request dump 中第一条请求消息的追加块与第一轮相同。

## 11. 文档与配套改动

- `docs/notices/skill-index.en.md`、`docs/notices/skill-index.zh.md`：结构仿 `tool-drift.*.md`（现象、原因、影响、可采取的措施：调阈值 / 调 K / 关闭 / 精简技能目录）。
- `README.md`、`README.zh-cn.md` 的 Configuration Reference 增加三项设置。
- `CLAUDE.md` 的 "Other subsystems" 增加 `provider/skills/` 小节，记录三个不变量：选择是纯函数因而缓存字节稳定；只用 `<userRequest>` 内文打分；`threshold` 语义为"严格大于才裁剪，0 表示总是裁剪"。
- `CHANGELOG.md` 增加条目。
- `src/provider/debug/dump.ts` 与 `request.ts` 透传 `skillIndexStats`。
- `provider/index.ts` 的 `joinInitialResponseNotices` 已是可变参数，直接多传一个通知即可。

## 12. 风险与后续工作

**风险**

| 风险 | 缓解 |
|---|---|
| 相关技能未被选中，模型不知其存在 | 桩文本指示模型向用户询问技能路径；用户可调高 K 或阈值、或关闭 |
| Copilot 改变块格式 | 解析器严格匹配，失败即透传；诊断行 `action=absent reason=unparseable-block` 加一条无条件 `logger.info` 可发现。严格匹配不可放宽：若用户的 instructions 文件在真实块之前字面写了 `<skills>`，宽松解析会把替换起点定在那个字面量上，桩会吞掉其间的自定义指令。 |
| Copilot 改变 `<userRequest>` 包装 | 退化为每条含文本 User 消息各以自身全文查询（内容寻址，保持跨轮字节一致） |
| 历史消息累积追加块占用上下文 | 每条至多 K×~320 字符，且全部命中缓存；K 可下调 |
| 多语言描述分词质量 | 拉丁子词 + 中日韩 bigram 覆盖主要场景；IDF 抑制模板词 |

**后续工作**（不在本次范围）

- 方案 C：扩展内部处理的 `search_skills` 工具，让模型主动检索未列出的技能。
- 对 `<agents>` 块施加同一机制。
- `skillIndex.pinned`：始终注入的技能名单。
- 使用 Anthropic mid-conversation system message（Opus 5 / Fable 5.x 支持，Sonnet 5 不支持）作为注入通道的模型分流。
