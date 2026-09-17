# Copilot Skills 索引按需裁剪 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当 Copilot 注入的 `<skills>` 索引条数超过阈值时，系统提示中只留固定桩，每条用户请求消息尾部只追加与其最相关的至多 K 条索引，且出站请求前缀在会话内字节稳定。

**Architecture:** 新增 `src/provider/skills/` 子系统（解析 → 词法打分选择 → 渲染 → 编排），在 `provider/index.ts` 流水线中接在 `processToolFlow` 之后、`prepareChatRequest` 之前。选择是纯函数，历史消息每轮重算的追加块与上一轮字节一致，因此不引入新的 prompt cache 失效。配置、诊断日志、一次性通知、dump 元数据与文档随之补齐。

**Tech Stack:** TypeScript（`tsc` 直接编译到 `out/`，无 bundler）、Node ≥ 24、VS Code Language Model API、`node:test` + `node:assert/strict` 离线测试（`tests/mock-vscode.js` 拦截 `require('vscode')`）、`oxlint` / `oxfmt`。

**Spec:** `docs/superpowers/specs/2026-09-14-skill-index-trimming-design.md`

## Global Constraints

- Node `>=24`（`.nvmrc`）；`module: commonjs`，`target: ES2022`；不得使用正则 `v` 标志。
- 代码风格：tab 缩进、单引号（`.oxfmtrc.json`）；`npm run lint`、`npm run format:check`、`npm run compile`、`npm test` 必须全部通过。
- 模块布局：`src/provider/skills/` 只通过 `index.ts` barrel 对外；`config.ts` 只能以 `import type` 方式引用该 barrel（避免运行时循环依赖）。
- 默认值必须与 spec 一致：`threshold = 32`、`maxRelevant = 12`（上限 `64`）、`QUERY_MAX_CHARS = 2000`、name 权重 `3`、description 权重 `1`、上一轮查询权重 `0.5`、拉丁词元最短长度 `2`。
- 桩文本与追加块文本必须与 spec 4.3 逐字一致；条目 `raw` 逐字节保留。
- 只对 `requestKind === 'main-agent'` 生效；任何异常都退化为返回原 `messages` 引用。
- 不修改 `tools` 数组，不改动 `buildSystemWithClaudeCodeIdentity`。
- 每个任务的 `git add` 只列出该任务自己的文件；工作区中已有的未提交改动（`src/provider/deactivate.ts`、`src/provider/tools/mcp-filter.ts` 等）不得被带入。
- 系统角色判定使用 `LANGUAGE_MODEL_CHAT_SYSTEM_ROLE`（`src/consts.ts`，值为 `3`），因为 `@types/vscode` 不暴露 `LanguageModelChatMessageRole.System`。

---

## 文件结构

| 路径 | 动作 | 职责 |
|---|---|---|
| `src/consts.ts` | 修改 | 新增三个默认值常量（`config.ts` 与 `skills/` 共用） |
| `src/provider/skills/consts.ts` | 新建 | 标签名、算法常量、停用词表 |
| `src/provider/skills/parse.ts` | 新建 | `parseSkillIndex`、`extractTag` |
| `src/provider/skills/select.ts` | 新建 | `tokenize`、`buildSkillIndexModel`、`selectRelevantSkills` |
| `src/provider/skills/render.ts` | 新建 | `renderSkillIndexStub`、`renderRelevantSkillsBlock`、`extractUserRequestText` |
| `src/provider/skills/flow.ts` | 新建 | `processSkillIndex` 及其类型 |
| `src/provider/skills/index.ts` | 新建 | barrel |
| `src/config.ts` | 修改 | `getSkillIndexSettings()` |
| `package.json` / `package.nls.json` / `package.nls.zh-cn.json` | 修改 | 三项设置声明与文案 |
| `src/provider/tools/consts.ts` | 修改 | 通知起止标记 |
| `src/provider/tools/notices.ts` | 修改 | `createSkillIndexNotice`，剥离新标记 |
| `src/i18n.ts` | 修改 | `notice.skillIndexTrimmed` 中英文案 |
| `src/provider/debug/diagnostics.ts` / `index.ts` | 修改 | `logSkillIndexDiagnostics` |
| `src/provider/debug/dump.ts` | 修改 | request dump 元数据加 `skillIndex` |
| `src/provider/request.ts` | 修改 | 透传 `skillIndexStats` |
| `src/provider/index.ts` | 修改 | 接入 `processSkillIndex` |
| `tests/mock-vscode.js` | 修改 | 补 Language Model API 桩 |
| `tests/unit/skill-index-*.test.ts` | 新建 | 六个测试文件 |
| `docs/notices/skill-index.en.md` / `.zh.md`、`README.md`、`README.zh-cn.md`、`CLAUDE.md`、`CHANGELOG.md` | 新建/修改 | 文档 |

单个测试文件的运行方式（所有任务通用）：

```bash
npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/<name>.test.js
```

---

### Task 1: 解析器 `parse.ts` 与算法常量 `consts.ts`

**Files:**
- Create: `src/provider/skills/consts.ts`
- Create: `src/provider/skills/parse.ts`
- Test: `tests/unit/skill-index-parse.test.ts`

**Interfaces:**
- Consumes: 无（纯字符串处理，`node:crypto`）
- Produces:
  - `interface SkillIndexEntry { name: string; description: string; file: string; raw: string }`
  - `interface ParsedSkillIndex { entries: SkillIndexEntry[]; totalCount: number; blockStart: number; blockEnd: number; hash: string }`
  - `parseSkillIndex(systemText: string): ParsedSkillIndex | undefined`
  - `extractTag(text: string, tag: string): string | undefined`
  - 常量 `SKILLS_BLOCK_OPEN`、`SKILLS_BLOCK_CLOSE`、`SKILL_ENTRY_OPEN`、`SKILL_ENTRY_CLOSE`、`RELEVANT_SKILLS_TAG`、`USER_REQUEST_TAG`、`QUERY_MAX_CHARS`、`NAME_TOKEN_WEIGHT`、`DESCRIPTION_TOKEN_WEIGHT`、`PREVIOUS_QUERY_WEIGHT`、`MIN_LATIN_TOKEN_LENGTH`、`STOP_WORDS`、`HAN_STOP_CHARS`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/skill-index-parse.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTag, parseSkillIndex } from '../../src/provider/skills/parse';

// Fixture mirrors the exact shape Copilot Chat injects (see the spec §1):
// intro sentences, then <skill> entries with <name>/<description>/<file>,
// wrapped in <instructions>, followed by an <agents> block.
const ENTRY_SECURITY = [
	'<skill>',
	'<name>007</name>',
	'<description>Security audit, hardening, threat modeling (STRIDE/PASTA), Red/Blue Team.</description>',
	'<file>c:\\Users\\user\\.agents\\skills\\007\\SKILL.md</file>',
	'</skill>',
].join('\n');
const ENTRY_SPANISH = [
	'<skill>',
	'<name>10-andruia-skill-smith</name>',
	'<description>Ingeniero de Sistemas de Andru.ia. Diseña y despliega nuevas habilidades.</description>',
	'<file>c:\\Users\\user\\.agents\\skills\\10-andruia-skill-smith\\SKILL.md</file>',
	'</skill>',
].join('\n');
const ENTRY_CHINESE = [
	'<skill>',
	'<name>数据库迁移助手</name>',
	'<description>为数据库迁移生成迁移脚本与回滚方案。</description>',
	'<file>c:\\Users\\user\\.agents\\skills\\db-migration\\SKILL.md</file>',
	'</skill>',
].join('\n');
const ENTRY_NO_NAME = [
	'<skill>',
	'<description>Broken entry without a name tag.</description>',
	'<file>c:\\Users\\user\\.agents\\skills\\broken\\SKILL.md</file>',
	'</skill>',
].join('\n');

const SKILLS_BLOCK = [
	'<skills>',
	'Here is a list of skills that contain domain specific knowledge on a variety of topics.',
	"When a user asks you to perform a task that falls within the domain of a skill, use the 'read_file' tool to acquire the full instructions from the file URI.",
	ENTRY_SECURITY,
	ENTRY_SPANISH,
	ENTRY_CHINESE,
	ENTRY_NO_NAME,
	'</skills>',
].join('\n');

const PREFIX = '<instructions>\nYou are an expert AI programming assistant.\n</instructions>\n\n<instructions>\n';
const SUFFIX = '\n</instructions>\n\n<agents>\n<agent>\n<name>Upgrade</name>\n</agent>\n</agents>';
const SYSTEM_TEXT = PREFIX + SKILLS_BLOCK + SUFFIX;

test('parses every well-formed entry and keeps raw bytes intact', () => {
	const parsed = parseSkillIndex(SYSTEM_TEXT);
	assert.ok(parsed);
	assert.equal(parsed.totalCount, 4);
	assert.equal(parsed.entries.length, 3);

	assert.deepEqual(parsed.entries[0], {
		name: '007',
		description: 'Security audit, hardening, threat modeling (STRIDE/PASTA), Red/Blue Team.',
		file: 'c:\\Users\\user\\.agents\\skills\\007\\SKILL.md',
		raw: ENTRY_SECURITY,
	});
	assert.equal(parsed.entries[1].name, '10-andruia-skill-smith');
	assert.equal(parsed.entries[1].raw, ENTRY_SPANISH);
	assert.equal(parsed.entries[2].name, '数据库迁移助手');
	assert.equal(parsed.entries[2].description, '为数据库迁移生成迁移脚本与回滚方案。');
	assert.equal(parsed.entries[2].raw, ENTRY_CHINESE);
});

test('block offsets slice exactly the <skills>…</skills> range', () => {
	const parsed = parseSkillIndex(SYSTEM_TEXT);
	assert.ok(parsed);
	assert.equal(SYSTEM_TEXT.slice(parsed.blockStart, parsed.blockEnd), SKILLS_BLOCK);
	assert.equal(SYSTEM_TEXT.slice(0, parsed.blockStart), PREFIX);
	assert.equal(SYSTEM_TEXT.slice(parsed.blockEnd), SUFFIX);
	assert.match(parsed.hash, /^[0-9a-f]{10}$/);
});

test('hash is stable for identical input and differs for different input', () => {
	const a = parseSkillIndex(SYSTEM_TEXT);
	const b = parseSkillIndex(SYSTEM_TEXT);
	const c = parseSkillIndex(PREFIX + SKILLS_BLOCK.replace('007', '008') + SUFFIX);
	assert.ok(a && b && c);
	assert.equal(a.hash, b.hash);
	assert.notEqual(a.hash, c.hash);
});

test('returns undefined when there is no <skills> block', () => {
	assert.equal(parseSkillIndex('<instructions>\nno skills here\n</instructions>'), undefined);
	assert.equal(parseSkillIndex(''), undefined);
});

test('returns undefined when the block is not closed', () => {
	assert.equal(parseSkillIndex(PREFIX + '<skills>\n' + ENTRY_SECURITY), undefined);
});

test('returns undefined when more than one <skills> block exists', () => {
	assert.equal(parseSkillIndex(SYSTEM_TEXT + '\n' + SKILLS_BLOCK), undefined);
});

test('an empty block parses with zero entries', () => {
	const parsed = parseSkillIndex('<skills>\n</skills>');
	assert.ok(parsed);
	assert.equal(parsed.totalCount, 0);
	assert.deepEqual(parsed.entries, []);
});

test('extractTag returns trimmed inner text or undefined', () => {
	assert.equal(extractTag('<a>\n hello \n</a>', 'a'), 'hello');
	assert.equal(extractTag('<a>x</a><a>y</a>', 'a'), 'x');
	assert.equal(extractTag('<a>unterminated', 'a'), undefined);
	assert.equal(extractTag('nothing', 'a'), undefined);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-parse.test.js`
Expected: 编译失败，`Cannot find module '../../src/provider/skills/parse'`。

- [ ] **Step 3: 写 `src/provider/skills/consts.ts`**

```ts
/** Copilot Chat wraps its Agent Skills index in these tags inside the system prompt. */
export const SKILLS_BLOCK_OPEN = '<skills>';
export const SKILLS_BLOCK_CLOSE = '</skills>';
export const SKILL_ENTRY_OPEN = '<skill>';
export const SKILL_ENTRY_CLOSE = '</skill>';

/** Tag of the block this extension appends to each user request with the selected entries. */
export const RELEVANT_SKILLS_TAG = 'relevant_skills';

/** Copilot wraps the user's actual prompt in this tag inside each user message. */
export const USER_REQUEST_TAG = 'userRequest';

/** Query text beyond this many characters is ignored so pasted logs stay cheap to score. */
export const QUERY_MAX_CHARS = 2000;
export const NAME_TOKEN_WEIGHT = 3;
export const DESCRIPTION_TOKEN_WEIGHT = 1;
/** Tokens that only appear in the previous request count at this fraction. */
export const PREVIOUS_QUERY_WEIGHT = 0.5;
export const MIN_LATIN_TOKEN_LENGTH = 2;

/**
 * Whole-token stop words. The English half removes the "Use when the user
 * asks…" template every skill description shares; the Chinese half removes
 * function words and follow-up phrases ("继续") that carry no topic.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
	// English
	'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'with', 'this', 'that',
	'is', 'are', 'be', 'use', 'using', 'used', 'when', 'user', 'users', 'asks', 'ask',
	'asked', 'your', 'you', 'it', 'as', 'by', 'from', 'at', 'into', 'will', 'can',
	'should', 'any', 'all', 'not', 'if', 'do', 'does', 'how', 'what', 'which', 'about',
	'also', 'need', 'needs', 'help', 'me', 'my', 'we', 'our', 'please',
	// Chinese words and bigrams
	'我们', '一下', '一个', '这个', '那个', '进行', '需要', '可以', '如何', '什么', '怎么',
	'继续', '帮我', '请你', '一些', '然后', '以及', '或者', '因为', '所以', '这些', '那些',
]);

/** Any Han bigram containing one of these characters is dropped as noise. */
export const HAN_STOP_CHARS: ReadonlySet<string> = new Set([
	'的', '了', '是', '在', '和', '与', '或', '请', '我', '你', '帮', '吧', '吗', '呢', '把',
	'被', '就', '都', '也', '很', '这', '那', '要', '让', '给', '做',
]);
```

- [ ] **Step 4: 写 `src/provider/skills/parse.ts`**

```ts
import { createHash } from 'crypto';
import {
	SKILL_ENTRY_CLOSE,
	SKILL_ENTRY_OPEN,
	SKILLS_BLOCK_CLOSE,
	SKILLS_BLOCK_OPEN,
} from './consts';

export interface SkillIndexEntry {
	name: string;
	description: string;
	file: string;
	/** The `<skill>…</skill>` source, byte for byte, re-emitted verbatim when selected. */
	raw: string;
}

export interface ParsedSkillIndex {
	/** Entries that carry a `<name>`; only these can be selected. */
	entries: SkillIndexEntry[];
	/** Every `<skill>` occurrence, parseable or not — drives the threshold and the stub text. */
	totalCount: number;
	/** Offset of `<skills>` in the system text. */
	blockStart: number;
	/** Offset just past `</skills>`. */
	blockEnd: number;
	/** Short hash of the block, for diagnostics. */
	hash: string;
}

/**
 * Locates Copilot's `<skills>` block inside a system prompt and parses its
 * entries. Returns `undefined` unless there is exactly one opening tag with a
 * closing tag after it, so anything unexpected is forwarded untouched.
 */
export function parseSkillIndex(systemText: string): ParsedSkillIndex | undefined {
	const blockStart = systemText.indexOf(SKILLS_BLOCK_OPEN);
	if (blockStart < 0) {
		return undefined;
	}
	if (systemText.indexOf(SKILLS_BLOCK_OPEN, blockStart + SKILLS_BLOCK_OPEN.length) >= 0) {
		return undefined;
	}
	const closeIndex = systemText.indexOf(SKILLS_BLOCK_CLOSE, blockStart);
	if (closeIndex < 0) {
		return undefined;
	}
	const blockEnd = closeIndex + SKILLS_BLOCK_CLOSE.length;
	const block = systemText.slice(blockStart, blockEnd);

	const entries: SkillIndexEntry[] = [];
	let totalCount = 0;
	let cursor = 0;
	while (true) {
		const open = block.indexOf(SKILL_ENTRY_OPEN, cursor);
		if (open < 0) {
			break;
		}
		const close = block.indexOf(SKILL_ENTRY_CLOSE, open);
		if (close < 0) {
			break;
		}
		const end = close + SKILL_ENTRY_CLOSE.length;
		const raw = block.slice(open, end);
		totalCount += 1;
		const name = extractTag(raw, 'name');
		if (name) {
			entries.push({
				name,
				description: extractTag(raw, 'description') ?? '',
				file: extractTag(raw, 'file') ?? '',
				raw,
			});
		}
		cursor = end;
	}

	return {
		entries,
		totalCount,
		blockStart,
		blockEnd,
		hash: createHash('sha1').update(block).digest('hex').slice(0, 10),
	};
}

/** Inner text of the first `<tag>…</tag>` pair, trimmed; `undefined` when absent or unterminated. */
export function extractTag(text: string, tag: string): string | undefined {
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	const start = text.indexOf(open);
	if (start < 0) {
		return undefined;
	}
	const end = text.indexOf(close, start + open.length);
	if (end < 0) {
		return undefined;
	}
	return text.slice(start + open.length, end).trim();
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-parse.test.js`
Expected: 8 个测试全部 PASS。

- [ ] **Step 6: 格式化与 lint**

Run: `npm run format && npm run lint`
Expected: 无错误（`format` 可能重排 `STOP_WORDS` 的换行，这是预期）。

- [ ] **Step 7: 提交**

```bash
git add src/provider/skills/consts.ts src/provider/skills/parse.ts tests/unit/skill-index-parse.test.ts
git commit -m "feat(skills): 解析 Copilot 系统提示中的 <skills> 索引块"
```

---

### Task 2: 选择器 `select.ts`

**Files:**
- Create: `src/provider/skills/select.ts`
- Test: `tests/unit/skill-index-select.test.ts`

**Interfaces:**
- Consumes: `SkillIndexEntry`（Task 1）、`consts.ts` 中的权重与停用词常量
- Produces:
  - `interface SkillSelectionQuery { current: string; previous?: string }`
  - `interface SkillIndexModel { entries: readonly SkillIndexEntry[]; weights: ReadonlyArray<ReadonlyMap<string, number>>; idf: ReadonlyMap<string, number> }`
  - `tokenize(text: string): string[]`
  - `buildSkillIndexModel(entries: readonly SkillIndexEntry[]): SkillIndexModel`
  - `selectRelevantSkills(model: SkillIndexModel, query: SkillSelectionQuery, maxRelevant: number): SkillIndexEntry[]`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/skill-index-select.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillIndexEntry } from '../../src/provider/skills/parse';
import {
	buildSkillIndexModel,
	selectRelevantSkills,
	tokenize,
} from '../../src/provider/skills/select';

function entry(name: string, description: string): SkillIndexEntry {
	return {
		name,
		description,
		file: `c:\\skills\\${name}\\SKILL.md`,
		raw: `<skill>\n<name>${name}</name>\n<description>${description}</description>\n<file>c:\\skills\\${name}\\SKILL.md</file>\n</skill>`,
	};
}

function names(entries: SkillIndexEntry[]): string[] {
	return entries.map((item) => item.name);
}

test('tokenize splits kebab-case names into sub-words', () => {
	assert.deepEqual(tokenize('api-design-reviewer'), ['api', 'design', 'reviewer']);
	assert.deepEqual(tokenize('snake_case_name'), ['snake', 'case', 'name']);
});

test('tokenize lower-cases and drops single-character latin tokens and stop words', () => {
	assert.deepEqual(tokenize('Use when the user asks to Design a Schema'), ['design', 'schema']);
	assert.deepEqual(tokenize('a b cd'), ['cd']);
	assert.deepEqual(tokenize('version 2026 release'), ['version', '2026', 'release']);
});

test('tokenize turns Han runs into bigrams and drops bigrams with stop characters', () => {
	assert.deepEqual(tokenize('数据库迁移'), ['数据', '据库', '库迁', '迁移']);
	assert.deepEqual(tokenize('帮我做数据库迁移'), ['数据', '据库', '库迁', '迁移']);
	assert.deepEqual(tokenize('继续'), []);
	assert.deepEqual(tokenize('库'), ['库']);
});

test('tokenize separates mixed latin and Han runs', () => {
	assert.deepEqual(tokenize('vue组件重构'), ['vue', '组件', '件重', '重构']);
});

test('idf demotes template words shared by every description', () => {
	const model = buildSkillIndexModel([
		entry('alpha', 'Use when the user asks for help with widgets and a gadget'),
		entry('beta', 'Use when the user asks for help with widgets and a sprocket'),
		entry('gamma', 'Use when the user asks for help with widgets'),
	]);
	const picked = selectRelevantSkills(model, { current: 'widgets gadget' }, 10);
	assert.deepEqual(names(picked), ['alpha', 'beta', 'gamma']);
	// 'widgets' appears in all three: it must not separate beta from gamma,
	// so those two fall back to the name tie-break.
	const tie = selectRelevantSkills(model, { current: 'widgets' }, 10);
	assert.deepEqual(names(tie), ['alpha', 'beta', 'gamma']);
});

test('a name hit outweighs a description hit', () => {
	const model = buildSkillIndexModel([
		entry('misc', 'deploy helper tool'),
		entry('deploy-helper', 'misc'),
	]);
	assert.deepEqual(names(selectRelevantSkills(model, { current: 'deploy' }, 10)), [
		'deploy-helper',
		'misc',
	]);
});

test('results are deterministic and tie-break on name then index', () => {
	const model = buildSkillIndexModel([
		entry('zeta', 'rust toolchain'),
		entry('alpha', 'rust toolchain'),
		entry('mid', 'rust toolchain'),
	]);
	const first = selectRelevantSkills(model, { current: 'rust' }, 10);
	const second = selectRelevantSkills(model, { current: 'rust' }, 10);
	assert.deepEqual(names(first), ['alpha', 'mid', 'zeta']);
	assert.deepEqual(first, second);
});

test('maxRelevant caps the result and zero scores are excluded', () => {
	const model = buildSkillIndexModel([
		entry('a-rust', 'rust'),
		entry('b-rust', 'rust'),
		entry('c-rust', 'rust'),
		entry('python', 'python only'),
	]);
	assert.deepEqual(names(selectRelevantSkills(model, { current: 'rust' }, 2)), ['a-rust', 'b-rust']);
	assert.deepEqual(selectRelevantSkills(model, { current: 'cobol' }, 5), []);
	assert.deepEqual(selectRelevantSkills(model, { current: '' }, 5), []);
	assert.deepEqual(selectRelevantSkills(model, { current: 'rust' }, 0), []);
});

test('previous request tokens count at half weight', () => {
	// alpha only matches the previous query, in its name (3 × 0.5 = 1.5);
	// beta matches the current query, in its description (1 × 1 = 1).
	const nameModel = buildSkillIndexModel([entry('alpha-tool', 'x'), entry('y', 'beta tool')]);
	assert.deepEqual(names(selectRelevantSkills(nameModel, { current: 'beta', previous: 'alpha' }, 10)), [
		'alpha-tool',
		'y',
	]);
	// Move alpha into the description (1 × 0.5 = 0.5) and beta wins.
	const descriptionModel = buildSkillIndexModel([entry('z', 'alpha'), entry('y', 'beta tool')]);
	assert.deepEqual(
		names(selectRelevantSkills(descriptionModel, { current: 'beta', previous: 'alpha' }, 10)),
		['y', 'z'],
	);
});

test('a follow-up made only of stop words still selects via the previous request', () => {
	const model = buildSkillIndexModel([
		entry('数据库迁移助手', '为数据库迁移生成迁移脚本与回滚方案。'),
		entry('frontend-design', 'Guidance for distinctive UI visual design.'),
	]);
	const picked = selectRelevantSkills(model, { current: '继续', previous: '帮我做数据库迁移' }, 10);
	assert.deepEqual(names(picked), ['数据库迁移助手']);
});

test('query text beyond 2000 characters is ignored', () => {
	const model = buildSkillIndexModel([entry('needle-skill', 'needle')]);
	const padding = 'filler '.repeat(400); // 2800 chars of a word no entry contains
	assert.deepEqual(selectRelevantSkills(model, { current: padding + 'needle' }, 5), []);
	assert.deepEqual(names(selectRelevantSkills(model, { current: 'needle ' + padding }, 5)), [
		'needle-skill',
	]);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-select.test.js`
Expected: 编译失败，`Cannot find module '../../src/provider/skills/select'`。

- [ ] **Step 3: 写 `src/provider/skills/select.ts`**

```ts
import {
	DESCRIPTION_TOKEN_WEIGHT,
	HAN_STOP_CHARS,
	MIN_LATIN_TOKEN_LENGTH,
	NAME_TOKEN_WEIGHT,
	PREVIOUS_QUERY_WEIGHT,
	QUERY_MAX_CHARS,
	STOP_WORDS,
} from './consts';
import type { SkillIndexEntry } from './parse';

export interface SkillSelectionQuery {
	/** The `<userRequest>` text of the message being scored. */
	current: string;
	/** The `<userRequest>` text of the nearest earlier request message, if any. */
	previous?: string;
}

export interface SkillIndexModel {
	entries: readonly SkillIndexEntry[];
	/** Per entry: token → weight (name tokens 3, description tokens 1; max wins). */
	weights: ReadonlyArray<ReadonlyMap<string, number>>;
	/** token → ln(1 + N / df). */
	idf: ReadonlyMap<string, number>;
}

const WORD_RUN = /[\p{L}\p{N}]+/gu;
const HAN_CHAR = /\p{Script=Han}/u;

/**
 * Lower-cases, splits on non-alphanumerics (so kebab/snake names become
 * sub-words), keeps latin tokens of length >= 2, turns Han runs into character
 * bigrams, and drops stop words. Pure and deterministic.
 */
export function tokenize(text: string): string[] {
	const tokens: string[] = [];
	for (const match of text.toLowerCase().matchAll(WORD_RUN)) {
		let latin = '';
		let han = '';
		for (const char of match[0]) {
			if (HAN_CHAR.test(char)) {
				pushLatin(latin, tokens);
				latin = '';
				han += char;
			} else {
				pushHan(han, tokens);
				han = '';
				latin += char;
			}
		}
		pushLatin(latin, tokens);
		pushHan(han, tokens);
	}
	return tokens;
}

function pushLatin(token: string, tokens: string[]): void {
	if (token.length >= MIN_LATIN_TOKEN_LENGTH && !STOP_WORDS.has(token)) {
		tokens.push(token);
	}
}

function pushHan(run: string, tokens: string[]): void {
	const chars = [...run];
	if (chars.length === 0) {
		return;
	}
	if (chars.length === 1) {
		if (!HAN_STOP_CHARS.has(chars[0]) && !STOP_WORDS.has(chars[0])) {
			tokens.push(chars[0]);
		}
		return;
	}
	for (let index = 0; index + 1 < chars.length; index += 1) {
		const first = chars[index];
		const second = chars[index + 1];
		if (HAN_STOP_CHARS.has(first) || HAN_STOP_CHARS.has(second)) {
			continue;
		}
		const bigram = first + second;
		if (!STOP_WORDS.has(bigram)) {
			tokens.push(bigram);
		}
	}
}

export function buildSkillIndexModel(entries: readonly SkillIndexEntry[]): SkillIndexModel {
	const weights: Map<string, number>[] = [];
	const documentFrequency = new Map<string, number>();
	for (const entry of entries) {
		const entryWeights = new Map<string, number>();
		for (const token of tokenize(entry.description)) {
			entryWeights.set(token, DESCRIPTION_TOKEN_WEIGHT);
		}
		for (const token of tokenize(entry.name)) {
			entryWeights.set(token, NAME_TOKEN_WEIGHT);
		}
		for (const token of entryWeights.keys()) {
			documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
		}
		weights.push(entryWeights);
	}
	const idf = new Map<string, number>();
	for (const [token, df] of documentFrequency) {
		idf.set(token, Math.log(1 + entries.length / df));
	}
	return { entries, weights, idf };
}

/**
 * score(e) = Σ_{t∈current} w_e(t)·idf(t) + 0.5·Σ_{t∈previous∖current} w_e(t)·idf(t).
 * Sorted by score desc, then name asc (UTF-16 code unit order), then index;
 * returns the top `maxRelevant` entries with a positive score.
 */
export function selectRelevantSkills(
	model: SkillIndexModel,
	query: SkillSelectionQuery,
	maxRelevant: number,
): SkillIndexEntry[] {
	if (maxRelevant <= 0 || model.entries.length === 0) {
		return [];
	}
	const currentTokens = new Set(tokenize(query.current.slice(0, QUERY_MAX_CHARS)));
	const previousTokens = new Set<string>();
	for (const token of tokenize((query.previous ?? '').slice(0, QUERY_MAX_CHARS))) {
		if (!currentTokens.has(token)) {
			previousTokens.add(token);
		}
	}
	if (currentTokens.size === 0 && previousTokens.size === 0) {
		return [];
	}

	const scored: { index: number; score: number }[] = [];
	for (const [index, weights] of model.weights.entries()) {
		let score = 0;
		for (const token of currentTokens) {
			score += (weights.get(token) ?? 0) * (model.idf.get(token) ?? 0);
		}
		for (const token of previousTokens) {
			score += PREVIOUS_QUERY_WEIGHT * (weights.get(token) ?? 0) * (model.idf.get(token) ?? 0);
		}
		if (score > 0) {
			scored.push({ index, score });
		}
	}

	scored.sort((a, b) => {
		if (a.score !== b.score) {
			return b.score - a.score;
		}
		const nameA = model.entries[a.index].name;
		const nameB = model.entries[b.index].name;
		if (nameA !== nameB) {
			return nameA < nameB ? -1 : 1;
		}
		return a.index - b.index;
	});

	return scored.slice(0, maxRelevant).map((item) => model.entries[item.index]);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-select.test.js`
Expected: 11 个测试全部 PASS。若 `tokenize('vue组件重构')` 一例失败，检查 `HAN_STOP_CHARS` 是否误含 `组`/`件`/`重`/`构`。

- [ ] **Step 5: 格式化与 lint**

Run: `npm run format && npm run lint`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/provider/skills/select.ts tests/unit/skill-index-select.test.ts
git commit -m "feat(skills): 基于词法 IDF 打分的确定性 Top-K 技能选择"
```

---

### Task 3: 渲染 `render.ts` 与 barrel

**Files:**
- Create: `src/provider/skills/render.ts`
- Create: `src/provider/skills/index.ts`（本任务先导出 parse/select/render，Task 6 再补 flow）
- Test: `tests/unit/skill-index-render.test.ts`

**Interfaces:**
- Consumes: `SkillIndexEntry`、`extractTag`（Task 1）、`RELEVANT_SKILLS_TAG`、`USER_REQUEST_TAG`
- Produces:
  - `renderSkillIndexStub(totalCount: number): string`
  - `renderRelevantSkillsBlock(entries: readonly SkillIndexEntry[]): string`
  - `extractUserRequestText(messageText: string): string | undefined`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/skill-index-render.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillIndexEntry } from '../../src/provider/skills/parse';
import {
	extractUserRequestText,
	renderRelevantSkillsBlock,
	renderSkillIndexStub,
} from '../../src/provider/skills/render';

const RAW_A = '<skill>\n<name>a</name>\n<description>A.</description>\n<file>c:\\a\\SKILL.md</file>\n</skill>';
const RAW_B = '<skill>\n<name>b</name>\n<description>B.</description>\n<file>c:\\b\\SKILL.md</file>\n</skill>';
const A: SkillIndexEntry = { name: 'a', description: 'A.', file: 'c:\\a\\SKILL.md', raw: RAW_A };
const B: SkillIndexEntry = { name: 'b', description: 'B.', file: 'c:\\b\\SKILL.md', raw: RAW_B };

test('stub is the exact spec text with the count filled in', () => {
	assert.equal(
		renderSkillIndexStub(1551),
		[
			'<skills>',
			'1551 skills with domain-specific instructions are available in this workspace.',
			'To keep this prompt compact, only the skills most relevant to each user request are listed inside a <relevant_skills> block appended to that request, using the same <skill> format.',
			"When a task falls within the domain of a listed skill, use the 'read_file' tool to acquire the full instructions from the file path.",
			'If the user names a skill that is not listed, ask them for its file path.',
			'</skills>',
		].join('\n'),
	);
});

test('relevant skills block re-emits raw entries verbatim in order', () => {
	assert.equal(
		renderRelevantSkillsBlock([B, A]),
		'<relevant_skills>\n' + RAW_B + '\n' + RAW_A + '\n</relevant_skills>',
	);
	assert.equal(renderRelevantSkillsBlock([]), '<relevant_skills>\n</relevant_skills>');
});

test('extractUserRequestText returns the trimmed inner text of the first <userRequest>', () => {
	const message =
		'<context>\nThe current date is 2026-09-09.\n</context>\n<reminderInstructions>\nx\n</reminderInstructions>\n<userRequest>\n帮我做数据库迁移\n</userRequest>\n';
	assert.equal(extractUserRequestText(message), '帮我做数据库迁移');
	assert.equal(extractUserRequestText('<userRequest></userRequest>'), '');
	assert.equal(extractUserRequestText('<environment_info>win32</environment_info>'), undefined);
	assert.equal(extractUserRequestText('<userRequest>unterminated'), undefined);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-render.test.js`
Expected: 编译失败，`Cannot find module '../../src/provider/skills/render'`。

- [ ] **Step 3: 写 `src/provider/skills/render.ts`**

```ts
import { RELEVANT_SKILLS_TAG, USER_REQUEST_TAG } from './consts';
import { extractTag, type SkillIndexEntry } from './parse';

/**
 * Replaces Copilot's full index in the system prompt. Fixed text apart from
 * the count, so it only changes when the index itself changes.
 */
export function renderSkillIndexStub(totalCount: number): string {
	return [
		'<skills>',
		`${totalCount} skills with domain-specific instructions are available in this workspace.`,
		`To keep this prompt compact, only the skills most relevant to each user request are listed inside a <${RELEVANT_SKILLS_TAG}> block appended to that request, using the same <skill> format.`,
		"When a task falls within the domain of a listed skill, use the 'read_file' tool to acquire the full instructions from the file path.",
		'If the user names a skill that is not listed, ask them for its file path.',
		'</skills>',
	].join('\n');
}

/** The selected entries, byte-identical to Copilot's own `<skill>` markup. */
export function renderRelevantSkillsBlock(entries: readonly SkillIndexEntry[]): string {
	return [
		`<${RELEVANT_SKILLS_TAG}>`,
		...entries.map((entry) => entry.raw),
		`</${RELEVANT_SKILLS_TAG}>`,
	].join('\n');
}

/** The user's actual prompt inside a Copilot user message, without the surrounding context blocks. */
export function extractUserRequestText(messageText: string): string | undefined {
	return extractTag(messageText, USER_REQUEST_TAG);
}
```

- [ ] **Step 4: 写 `src/provider/skills/index.ts`（初版）**

```ts
export { parseSkillIndex, extractTag } from './parse';
export type { ParsedSkillIndex, SkillIndexEntry } from './parse';
export { buildSkillIndexModel, selectRelevantSkills, tokenize } from './select';
export type { SkillIndexModel, SkillSelectionQuery } from './select';
export {
	extractUserRequestText,
	renderRelevantSkillsBlock,
	renderSkillIndexStub,
} from './render';
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-render.test.js`
Expected: 3 个测试全部 PASS。

- [ ] **Step 6: 格式化与 lint，提交**

Run: `npm run format && npm run lint`

```bash
git add src/provider/skills/render.ts src/provider/skills/index.ts tests/unit/skill-index-render.test.ts
git commit -m "feat(skills): 渲染系统提示桩与 relevant_skills 追加块"
```

---

### Task 4: 配置项与默认值

**Files:**
- Modify: `src/consts.ts`（在 `LANGUAGE_MODEL_CHAT_SYSTEM_ROLE` 之后追加）
- Modify: `src/config.ts`（在 `getStabilizeToolListEnabled` 之后追加）
- Modify: `package.json`（`anthropic-copilot.experimental.stabilizeToolList` 块之后）
- Modify: `package.nls.json`、`package.nls.zh-cn.json`（`…stabilizeToolList.description` 行之后）
- Test: `tests/unit/skill-index-settings.test.ts`

**Interfaces:**
- Consumes: `vscode.workspace.getConfiguration`
- Produces:
  - `src/consts.ts`：`DEFAULT_SKILL_INDEX_THRESHOLD = 32`、`DEFAULT_SKILL_INDEX_MAX_RELEVANT = 12`、`MAX_SKILL_INDEX_MAX_RELEVANT = 64`
  - `src/config.ts`：`interface SkillIndexSettings { mode: 'auto' | 'off'; threshold: number; maxRelevant: number }`（定义在 config.ts 并导出；Task 6 的 `flow.ts` 以 `import type` 引用）与 `getSkillIndexSettings(): SkillIndexSettings`

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/skill-index-settings.test.ts`：

```ts
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { getSkillIndexSettings } from '../../src/config';

beforeEach(() => {
	__vscodeMock.reset();
	// Keep config.ts away from the developer's real ~/.claude/settings.json.
	__vscodeMock.config['anthropic-copilot.useClaudeCodeSettings'] = false;
});

test('defaults match the spec', () => {
	assert.deepEqual(getSkillIndexSettings(), { mode: 'auto', threshold: 32, maxRelevant: 12 });
});

test('mode accepts off and treats unknown values as auto', () => {
	__vscodeMock.config['anthropic-copilot.skillIndex.mode'] = 'off';
	assert.equal(getSkillIndexSettings().mode, 'off');
	__vscodeMock.config['anthropic-copilot.skillIndex.mode'] = 'sometimes';
	assert.equal(getSkillIndexSettings().mode, 'auto');
});

test('threshold is clamped to a non-negative integer', () => {
	__vscodeMock.config['anthropic-copilot.skillIndex.threshold'] = -5;
	assert.equal(getSkillIndexSettings().threshold, 0);
	__vscodeMock.config['anthropic-copilot.skillIndex.threshold'] = 7.9;
	assert.equal(getSkillIndexSettings().threshold, 7);
	__vscodeMock.config['anthropic-copilot.skillIndex.threshold'] = 'many';
	assert.equal(getSkillIndexSettings().threshold, 32);
	__vscodeMock.config['anthropic-copilot.skillIndex.threshold'] = 0;
	assert.equal(getSkillIndexSettings().threshold, 0);
});

test('maxRelevant is clamped to 1..64', () => {
	__vscodeMock.config['anthropic-copilot.skillIndex.maxRelevant'] = 0;
	assert.equal(getSkillIndexSettings().maxRelevant, 1);
	__vscodeMock.config['anthropic-copilot.skillIndex.maxRelevant'] = 999;
	assert.equal(getSkillIndexSettings().maxRelevant, 64);
	__vscodeMock.config['anthropic-copilot.skillIndex.maxRelevant'] = Number.NaN;
	assert.equal(getSkillIndexSettings().maxRelevant, 12);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-settings.test.js`
Expected: 编译失败，`Module '"../../src/config"' has no exported member 'getSkillIndexSettings'`。

- [ ] **Step 3: 在 `src/consts.ts` 末尾的角色常量之后追加**

```ts
// ---- Skills index trimming (see docs/superpowers/specs/2026-09-14-skill-index-trimming-design.md) ----

/** Trim only when Copilot's `<skills>` block has more entries than this. 0 means always. */
export const DEFAULT_SKILL_INDEX_THRESHOLD = 32;
/** Entries appended to each user request after trimming. */
export const DEFAULT_SKILL_INDEX_MAX_RELEVANT = 12;
export const MAX_SKILL_INDEX_MAX_RELEVANT = 64;
```

- [ ] **Step 4: 在 `src/config.ts` 中追加**

修改导入行：

```ts
import {
	CONFIG_SECTION,
	DEFAULT_SKILL_INDEX_MAX_RELEVANT,
	DEFAULT_SKILL_INDEX_THRESHOLD,
	MAX_SKILL_INDEX_MAX_RELEVANT,
	MODELS,
} from './consts';
```

在 `getStabilizeToolListEnabled` 之后追加：

```ts
export interface SkillIndexSettings {
	mode: 'auto' | 'off';
	/** Trim only when the index has strictly more entries than this; 0 means always. */
	threshold: number;
	/** Entries appended to each user request; 1..64. */
	maxRelevant: number;
}

/**
 * Settings for trimming Copilot's `<skills>` index. Read on every request so
 * changes apply without a reload; out-of-range values are clamped rather than
 * rejected so a typo never disables the feature silently.
 */
export function getSkillIndexSettings(): SkillIndexSettings {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const mode = config.get<unknown>('skillIndex.mode', 'auto');
	return {
		mode: mode === 'off' ? 'off' : 'auto',
		threshold: clampInteger(
			config.get<unknown>('skillIndex.threshold', DEFAULT_SKILL_INDEX_THRESHOLD),
			0,
			Number.MAX_SAFE_INTEGER,
			DEFAULT_SKILL_INDEX_THRESHOLD,
		),
		maxRelevant: clampInteger(
			config.get<unknown>('skillIndex.maxRelevant', DEFAULT_SKILL_INDEX_MAX_RELEVANT),
			1,
			MAX_SKILL_INDEX_MAX_RELEVANT,
			DEFAULT_SKILL_INDEX_MAX_RELEVANT,
		),
	};
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.trunc(value)));
}
```

- [ ] **Step 5: 在 `package.json` 的 `anthropic-copilot.experimental.stabilizeToolList` 块之后插入**

```json
				"anthropic-copilot.skillIndex.mode": {
					"type": "string",
					"default": "auto",
					"enum": [
						"auto",
						"off"
					],
					"markdownEnumDescriptions": [
						"%anthropic-copilot.config.skillIndex.mode.auto.description%",
						"%anthropic-copilot.config.skillIndex.mode.off.description%"
					],
					"markdownDescription": "%anthropic-copilot.config.skillIndex.mode.description%",
					"tags": [
						"language-models"
					]
				},
				"anthropic-copilot.skillIndex.threshold": {
					"type": "integer",
					"default": 32,
					"minimum": 0,
					"markdownDescription": "%anthropic-copilot.config.skillIndex.threshold.description%",
					"tags": [
						"language-models"
					]
				},
				"anthropic-copilot.skillIndex.maxRelevant": {
					"type": "integer",
					"default": 12,
					"minimum": 1,
					"maximum": 64,
					"markdownDescription": "%anthropic-copilot.config.skillIndex.maxRelevant.description%",
					"tags": [
						"language-models"
					]
				},
```

- [ ] **Step 6: 在 `package.nls.json` 的 `…stabilizeToolList.description` 行之后插入**

```json
	"anthropic-copilot.config.skillIndex.mode.description": "How to handle the Agent Skills index Copilot injects into the system prompt when it is large. See [docs](https://github.com/luorenjin/anthropic-for-copilot/blob/main/docs/notices/skill-index.en.md).",
	"anthropic-copilot.config.skillIndex.mode.auto.description": "When the index has more entries than `threshold`, keep a short stub in the system prompt and append only the `maxRelevant` skills most relevant to each user request.",
	"anthropic-copilot.config.skillIndex.mode.off.description": "Forward Copilot's skills index unchanged.",
	"anthropic-copilot.config.skillIndex.threshold.description": "Trim only when the skills index has strictly more entries than this. `0` trims always.",
	"anthropic-copilot.config.skillIndex.maxRelevant.description": "Maximum number of skills appended to each user request after trimming (1–64).",
```

在 `package.nls.zh-cn.json` 的同一位置插入：

```json
	"anthropic-copilot.config.skillIndex.mode.description": "Copilot 注入到系统提示中的 Agent Skills 索引过大时的处理方式。详见[文档](https://github.com/luorenjin/anthropic-for-copilot/blob/main/docs/notices/skill-index.zh.md)。",
	"anthropic-copilot.config.skillIndex.mode.auto.description": "索引条数超过 `threshold` 时，系统提示中只保留一段简短说明，并只在每条用户请求末尾追加与其最相关的 `maxRelevant` 个技能。",
	"anthropic-copilot.config.skillIndex.mode.off.description": "原样转发 Copilot 的技能索引。",
	"anthropic-copilot.config.skillIndex.threshold.description": "只有当技能索引条数严格大于该值时才裁剪。`0` 表示总是裁剪。",
	"anthropic-copilot.config.skillIndex.maxRelevant.description": "裁剪后每条用户请求最多追加的技能数（1–64）。",
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-settings.test.js`
Expected: 4 个测试全部 PASS。

- [ ] **Step 8: 校验 package.json 仍是合法 JSON 并通过 lint/format**

Run: `node -e "require('./package.json'); require('./package.nls.json'); require('./package.nls.zh-cn.json'); console.log('json ok')" && npm run format && npm run lint`
Expected: 输出 `json ok`，无 lint 错误。

- [ ] **Step 9: 提交**

```bash
git add src/consts.ts src/config.ts package.json package.nls.json package.nls.zh-cn.json tests/unit/skill-index-settings.test.ts
git commit -m "feat(skills): 新增 anthropic-copilot.skillIndex.* 设置"
```

---

### Task 5: 一次性通知与测试用 vscode 桩

**Files:**
- Modify: `tests/mock-vscode.js`
- Modify: `src/provider/tools/consts.ts`
- Modify: `src/provider/tools/notices.ts`
- Modify: `src/i18n.ts`
- Test: `tests/unit/skill-index-notice.test.ts`

**Interfaces:**
- Consumes: `t()`（`src/i18n.ts`）、现有 `createBlockquote`、`stripProviderNotices`
- Produces:
  - `tools/consts.ts`：`SKILL_INDEX_NOTICE_START = '[anthropic-copilot-skill-index-notice-start]: #'`、`SKILL_INDEX_NOTICE_END = '[anthropic-copilot-skill-index-notice-end]: #'`
  - `tools/notices.ts`：`createSkillIndexNotice(totalCount: number, maxRelevant: number): string`
  - `tests/mock-vscode.js`：`LanguageModelChatMessageRole = { User: 1, Assistant: 2, System: 3 }`，类 `LanguageModelTextPart(value)`、`LanguageModelToolCallPart(callId, name, input)`、`LanguageModelToolResultPart(callId, content)`、`LanguageModelDataPart(data, mimeType)`

- [ ] **Step 1: 扩展 `tests/mock-vscode.js`**

在 `const vscodeStub = {` 之前插入：

```js
// Minimal Language Model API surface. Source modules and tests both receive
// these same classes through the patched require, so `instanceof` checks in
// src/ work against parts constructed in tests.
class LanguageModelTextPart {
	constructor(value) {
		this.value = value;
	}
}
class LanguageModelToolCallPart {
	constructor(callId, name, input) {
		this.callId = callId;
		this.name = name;
		this.input = input;
	}
}
class LanguageModelToolResultPart {
	constructor(callId, content) {
		this.callId = callId;
		this.content = content;
	}
}
class LanguageModelDataPart {
	constructor(data, mimeType) {
		this.data = data;
		this.mimeType = mimeType;
	}
}
```

在 `ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },` 之后、`};` 之前追加：

```js
	LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 3 },
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	LanguageModelDataPart,
```

- [ ] **Step 2: 写失败的测试**

创建 `tests/unit/skill-index-notice.test.ts`：

```ts
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import vscode from 'vscode';
import {
	SKILL_INDEX_NOTICE_END,
	SKILL_INDEX_NOTICE_START,
} from '../../src/provider/tools/consts';
import {
	createSkillIndexNotice,
	filterProviderNotices,
} from '../../src/provider/tools/notices';

beforeEach(() => {
	__vscodeMock.reset();
});

test('notice is wrapped in its markers and carries both numbers', () => {
	const notice = createSkillIndexNotice(1551, 12);
	assert.ok(notice.includes(SKILL_INDEX_NOTICE_START));
	assert.ok(notice.includes(SKILL_INDEX_NOTICE_END));
	assert.ok(notice.includes('1551'));
	assert.ok(notice.includes('12'));
	assert.ok(notice.includes('docs/notices/skill-index.en.md'));
	assert.ok(notice.split('\n').some((line) => line.startsWith('> ')));
});

test('notice is localized to Simplified Chinese', () => {
	__vscodeMock.language = 'zh-cn';
	const notice = createSkillIndexNotice(43, 12);
	assert.ok(notice.includes('43'));
	assert.ok(notice.includes('docs/notices/skill-index.zh.md'));
});

test('filterProviderNotices strips the notice from assistant history', () => {
	const notice = createSkillIndexNotice(1551, 12);
	const assistant: vscode.LanguageModelChatRequestMessage = {
		role: vscode.LanguageModelChatMessageRole.Assistant,
		name: undefined,
		content: [new vscode.LanguageModelTextPart(notice + 'Here is the answer.')],
	};
	const user: vscode.LanguageModelChatRequestMessage = {
		role: vscode.LanguageModelChatMessageRole.User,
		name: undefined,
		content: [new vscode.LanguageModelTextPart('<userRequest>hi</userRequest>')],
	};
	const filtered = filterProviderNotices([user, assistant]);
	assert.equal(filtered.length, 2);
	assert.equal(filtered[0], user);
	const part = filtered[1].content[0];
	assert.ok(part instanceof vscode.LanguageModelTextPart);
	assert.equal(part.value, 'Here is the answer.');
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-notice.test.js`
Expected: 编译失败，`has no exported member 'SKILL_INDEX_NOTICE_START'` / `'createSkillIndexNotice'`。

- [ ] **Step 4: 在 `src/provider/tools/consts.ts` 末尾追加**

```ts
export const SKILL_INDEX_NOTICE_START = '[anthropic-copilot-skill-index-notice-start]: #';
export const SKILL_INDEX_NOTICE_END = '[anthropic-copilot-skill-index-notice-end]: #';
```

- [ ] **Step 5: 修改 `src/provider/tools/notices.ts`**

导入块改为：

```ts
import {
	SKILL_INDEX_NOTICE_END,
	SKILL_INDEX_NOTICE_START,
	TOOL_DRIFT_NOTICE_END,
	TOOL_DRIFT_NOTICE_START,
	VISION_PROXY_NOTICE_END,
	VISION_PROXY_NOTICE_START,
} from './consts';
```

在 `createToolDriftNotice` 之后新增：

```ts
export function createSkillIndexNotice(totalCount: number, maxRelevant: number): string {
	return [
		'',
		SKILL_INDEX_NOTICE_START,
		'',
		createBlockquote(t('notice.skillIndexTrimmed', totalCount, maxRelevant)),
		'',
		SKILL_INDEX_NOTICE_END,
		'',
	].join('\n');
}
```

`stripProviderNotices` 的标记列表加入一项：

```ts
	for (const marker of [
		{ start: TOOL_DRIFT_NOTICE_START, end: TOOL_DRIFT_NOTICE_END },
		{ start: VISION_PROXY_NOTICE_START, end: VISION_PROXY_NOTICE_END },
		{ start: SKILL_INDEX_NOTICE_START, end: SKILL_INDEX_NOTICE_END },
	]) {
```

- [ ] **Step 6: 在 `src/i18n.ts` 增加文案**

`zh` 字典中，`'notice.toolDrift'` 条目之后追加：

```ts
	'notice.skillIndexTrimmed':
		'ℹ️ Copilot 提供了 {0} 个技能；为节省 token，仅向模型展示与每条请求最相关的至多 {1} 个。[了解更多](https://github.com/luorenjin/anthropic-for-copilot/blob/main/docs/notices/skill-index.zh.md)',
```

`en` 字典中，`'notice.toolDrift'` 条目之后追加：

```ts
	'notice.skillIndexTrimmed':
		'ℹ️ Copilot supplied {0} skills; to save tokens, only the {1} most relevant to each request are shown to the model. [Learn more](https://github.com/luorenjin/anthropic-for-copilot/blob/main/docs/notices/skill-index.en.md)',
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-notice.test.js`
Expected: 3 个测试全部 PASS。若第 3 个测试因 `notices.ts` 的导入链（`../vision/protocols/errors` → `client/error/network`）在加载时抛错，把报错的 vscode API 名字按同样方式补进 `tests/mock-vscode.js`，再重跑。

- [ ] **Step 8: 全量测试确认没有破坏既有用例**

Run: `npm test`
Expected: 全部 PASS（既有 53 个 + 本计划到此为止新增的用例）。

- [ ] **Step 9: 格式化、lint、提交**

Run: `npm run format && npm run lint`

```bash
git add tests/mock-vscode.js src/provider/tools/consts.ts src/provider/tools/notices.ts src/i18n.ts tests/unit/skill-index-notice.test.ts
git commit -m "feat(skills): 技能索引裁剪的一次性通知与测试用 LM API 桩"
```

---

### Task 6: 编排 `flow.ts`、诊断日志与 barrel 完整化

**Files:**
- Create: `src/provider/skills/flow.ts`
- Modify: `src/provider/skills/index.ts`
- Modify: `src/provider/debug/diagnostics.ts`（在 `logToolFlowDiagnostics` 之后追加）
- Modify: `src/provider/debug/index.ts`
- Test: `tests/unit/skill-index-flow.test.ts`

**Interfaces:**
- Consumes: Task 1–5 的全部导出；`LANGUAGE_MODEL_CHAT_SYSTEM_ROLE`（`src/consts.ts`）；`RequestKind` 与 `formatRequestLogLine`（`provider/routing`）；`logger`；`SkillIndexSettings`（`src/config.ts`，`import type`）
- Produces:
  - `type SkillIndexAction = 'off' | 'not-applicable' | 'absent' | 'passthrough' | 'trimmed' | 'error'`
  - `interface SkillIndexStats { action: SkillIndexAction; threshold: number; maxRelevant: number; totalCount?: number; requestMessages?: number; injectedCounts?: number[]; systemCharsBefore?: number; systemCharsAfter?: number; indexHash?: string }`
  - `interface SkillIndexFlowOptions { messages: readonly vscode.LanguageModelChatRequestMessage[]; rawMessages: readonly vscode.LanguageModelChatRequestMessage[]; requestKind: RequestKind; settings: SkillIndexSettings }`
  - `interface SkillIndexFlowResult { messages: readonly vscode.LanguageModelChatRequestMessage[]; stats: SkillIndexStats; initialResponseNotice?: string }`
  - `processSkillIndex(options: SkillIndexFlowOptions): SkillIndexFlowResult`
  - `logSkillIndexDiagnostics(requestKind: RequestKind, stats: SkillIndexStats): void`（`provider/debug`）

- [ ] **Step 1: 写失败的测试**

创建 `tests/unit/skill-index-flow.test.ts`：

```ts
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import vscode from 'vscode';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../../src/consts';
import type { SkillIndexSettings } from '../../src/config';
import { processSkillIndex, renderSkillIndexStub } from '../../src/provider/skills';
import { SKILL_INDEX_NOTICE_START } from '../../src/provider/tools/consts';

type Message = vscode.LanguageModelChatRequestMessage;

const SYSTEM_ROLE = LANGUAGE_MODEL_CHAT_SYSTEM_ROLE as vscode.LanguageModelChatMessageRole;

function skill(name: string, description: string): string {
	return `<skill>\n<name>${name}</name>\n<description>${description}</description>\n<file>c:\\Users\\user\\.agents\\skills\\${name}\\SKILL.md</file>\n</skill>`;
}

const SKILLS = [
	skill('database-migration', 'Plan zero-downtime database migrations and rollbacks.'),
	skill('api-design-reviewer', 'Review REST API design for breaking changes.'),
	skill('frontend-design', 'Guidance for distinctive UI visual design.'),
	skill('数据库迁移助手', '为数据库迁移生成迁移脚本与回滚方案。'),
];
const SKILLS_BLOCK = ['<skills>', 'Here is a list of skills.', ...SKILLS, '</skills>'].join('\n');
const SYSTEM_PREFIX = '<instructions>\nYou are an expert.\n</instructions>\n\n<instructions>\n';
const SYSTEM_SUFFIX =
	'\n</instructions>\n\n<agents>\n<agent>\n<name>Upgrade</name>\n</agent>\n</agents>';
const SYSTEM_TEXT = SYSTEM_PREFIX + SKILLS_BLOCK + SYSTEM_SUFFIX;

function text(value: string): vscode.LanguageModelTextPart {
	return new vscode.LanguageModelTextPart(value);
}
function system(value: string): Message {
	return { role: SYSTEM_ROLE, name: undefined, content: [text(value)] };
}
function user(...parts: Message['content'][number][]): Message {
	return { role: vscode.LanguageModelChatMessageRole.User, name: undefined, content: parts };
}
function assistant(value: string): Message {
	return { role: vscode.LanguageModelChatMessageRole.Assistant, name: undefined, content: [text(value)] };
}
function request(prompt: string): Message {
	return user(
		text(
			`<context>\nThe current date is 2026-09-09.\n</context>\n<reminderInstructions>\nx\n</reminderInstructions>\n<userRequest>\n${prompt}\n</userRequest>\n`,
		),
	);
}
function toolResult(): Message {
	return user(new vscode.LanguageModelToolResultPart('call-1', [text('ok')]));
}
function textOf(message: Message): string {
	return message.content
		.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
		.map((part) => part.value)
		.join('');
}

const ENV = user(text('<environment_info>\nwin32\n</environment_info>'));
const SETTINGS: SkillIndexSettings = { mode: 'auto', threshold: 2, maxRelevant: 12 };

function conversation(): Message[] {
	return [
		system(SYSTEM_TEXT),
		ENV,
		request('Plan the database migration for this service'),
		assistant('Sure.'),
		toolResult(),
		request('继续'),
	];
}

beforeEach(() => {
	__vscodeMock.reset();
});

test('mode off returns the same messages reference', () => {
	const messages = conversation();
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: { ...SETTINGS, mode: 'off' },
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'off');
	assert.equal(result.initialResponseNotice, undefined);
});

test('non main-agent requests are left alone', () => {
	const messages = conversation();
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'background',
		settings: SETTINGS,
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'not-applicable');
});

test('no skills block means absent', () => {
	const messages = [system('<instructions>\nplain\n</instructions>'), request('hi')];
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'absent');
});

test('at or below the threshold the prompt passes through untouched', () => {
	const messages = conversation();
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: { ...SETTINGS, threshold: 4 },
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'passthrough');
	assert.equal(result.stats.totalCount, 4);
});

test('above the threshold the system prompt keeps only the stub and requests get relevant skills', () => {
	const messages = conversation();
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.notEqual(result.messages, messages);
	assert.equal(result.stats.action, 'trimmed');
	assert.equal(result.stats.totalCount, 4);
	assert.equal(result.stats.requestMessages, 2);
	assert.deepEqual(result.stats.injectedCounts, [1, 1]);
	assert.equal(result.stats.systemCharsBefore, SYSTEM_TEXT.length);

	const systemText = textOf(result.messages[0]);
	assert.equal(systemText, SYSTEM_PREFIX + renderSkillIndexStub(4) + SYSTEM_SUFFIX);
	assert.ok(!systemText.includes('<name>api-design-reviewer</name>'));
	assert.equal(result.stats.systemCharsAfter, systemText.length);

	// Untouched messages keep their identity.
	assert.equal(result.messages[1], messages[1]);
	assert.equal(result.messages[3], messages[3]);
	assert.equal(result.messages[4], messages[4]);

	// Request messages get exactly one appended text part.
	const first = result.messages[2];
	assert.equal(first.content.length, messages[2].content.length + 1);
	const appended = first.content[first.content.length - 1];
	assert.ok(appended instanceof vscode.LanguageModelTextPart);
	assert.ok(appended.value.startsWith('\n<relevant_skills>\n<skill>'));
	assert.ok(appended.value.includes('<name>database-migration</name>'));
	assert.ok(!appended.value.includes('<name>frontend-design</name>'));

	// "继续" has no topic words of its own and inherits the previous request.
	const second = result.messages[5];
	assert.equal(second.content.length, messages[5].content.length + 1);
	assert.ok(textOf(second).includes('<name>database-migration</name>'));
});

test('re-running on the next turn reproduces the earlier turn byte for byte', () => {
	// Must span at least three request messages so the comparison covers
	// messages whose `previous` is a real earlier query — a regression in the
	// previousQuery chain is invisible when every compared message has
	// previous === undefined.
	const turnOne = [
		...conversation(),
		assistant('done'),
		request('now review the REST API design'),
	];
	const turnTwo = [...turnOne, assistant('ok'), request('and the UI polish pass')];
	const one = processSkillIndex({
		messages: turnOne,
		rawMessages: turnOne,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	const two = processSkillIndex({
		messages: turnTwo,
		rawMessages: turnTwo,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(one.stats.action, 'trimmed');
	assert.equal(two.stats.action, 'trimmed');
	assert.ok(one.stats.requestMessages >= 3);
	for (let index = 0; index < one.messages.length; index += 1) {
		// Compare part by part, so a change in part order or count is caught
		// as well as a change in the concatenated text.
		const before = one.messages[index].content;
		const after = two.messages[index].content;
		assert.equal(after.length, before.length, `message #${index} part count`);
		for (let part = 0; part < before.length; part += 1) {
			const a = before[part];
			const b = after[part];
			if (a instanceof vscode.LanguageModelTextPart) {
				assert.ok(b instanceof vscode.LanguageModelTextPart, `message #${index} part #${part} kind`);
				assert.equal(b.value, a.value, `message #${index} part #${part}`);
			}
		}
	}
});

test('the notice is returned once and suppressed when history already carries it', () => {
	const messages = conversation();
	const fresh = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.ok(fresh.initialResponseNotice);
	assert.ok(fresh.initialResponseNotice.includes(SKILL_INDEX_NOTICE_START));

	const raw = [...messages];
	raw[3] = assistant(`\n${SKILL_INDEX_NOTICE_START}\n\n> shown before\n\n[anthropic-copilot-skill-index-notice-end]: #\n\nSure.`);
	const repeat = processSkillIndex({
		messages,
		rawMessages: raw,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(repeat.initialResponseNotice, undefined);
	assert.equal(repeat.stats.action, 'trimmed');
});

test('without <userRequest> every text-bearing user message is scored on its own full text', () => {
	const messages = [
		system(SYSTEM_TEXT),
		user(text('Review the REST API design')),
		assistant('ok'),
		user(text('now the database migration plan')),
		toolResult(),
	];
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(result.stats.action, 'trimmed');
	assert.equal(result.stats.requestMessages, 2);
	// Each request message reflects its OWN text, not the conversation's last message.
	assert.ok(textOf(result.messages[1]).includes('<name>api-design-reviewer</name>'));
	assert.ok(textOf(result.messages[3]).includes('<name>database-migration</name>'));
	assert.equal(result.messages[4], messages[4]);
});

test('the fallback path is byte-identical across turns', () => {
	// Keying the fallback on "the last text-bearing message" made a message's
	// block depend on conversation length, so turn N's bytes did not survive
	// into turn N+1. This is the regression guard for that.
	const turnOne = [
		system(SYSTEM_TEXT),
		user(text('Review the REST API design')),
		assistant('ok'),
		user(text('now the database migration plan')),
	];
	const turnTwo = [...turnOne, assistant('done'), user(text('and the UI polish pass'))];
	const one = processSkillIndex({
		messages: turnOne,
		rawMessages: turnOne,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	const two = processSkillIndex({
		messages: turnTwo,
		rawMessages: turnTwo,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(one.stats.action, 'trimmed');
	assert.equal(two.stats.action, 'trimmed');
	for (let index = 0; index < one.messages.length; index += 1) {
		assert.equal(textOf(two.messages[index]), textOf(one.messages[index]), `message #${index}`);
	}
});

test('a request with no matching skill gets no appended block', () => {
	const messages = [system(SYSTEM_TEXT), request('cobol mainframe accounting')];
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(result.stats.action, 'trimmed');
	assert.deepEqual(result.stats.injectedCounts, [0]);
	assert.equal(result.messages[1], messages[1]);
});

test('an internal failure forwards the messages unchanged instead of throwing', () => {
	const broken = { role: SYSTEM_ROLE, name: undefined, content: null } as unknown as Message;
	const messages = [broken, request('hi')];
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'error');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-flow.test.js`
Expected: 编译失败，`Module '"../../src/provider/skills"' has no exported member 'processSkillIndex'`。

- [ ] **Step 3: 在 `src/provider/debug/diagnostics.ts` 新增日志函数**

在导入块中加入：

```ts
import type { SkillIndexStats } from '../skills';
```

在 `logToolFlowDiagnostics` 函数之后追加：

```ts
/**
 * One line per request describing what the skills-index trimming step did.
 * `not-applicable` (background requests) is skipped because every title or
 * commit-message request would otherwise log it.
 */
export function logSkillIndexDiagnostics(requestKind: RequestKind, stats: SkillIndexStats): void {
	if (!getDebugLoggingEnabled() || stats.action === 'not-applicable') {
		return;
	}

	let message =
		`[skill-index] action=${stats.action}` +
		` entries=${stats.totalCount ?? 0}` +
		` threshold=${stats.threshold}` +
		` maxRelevant=${stats.maxRelevant}`;
	if (stats.requestMessages !== undefined) {
		message += ` requestMessages=${stats.requestMessages}`;
	}
	if (stats.injectedCounts) {
		message += ` injected=[${stats.injectedCounts.join(',')}]`;
	}
	if (stats.systemCharsBefore !== undefined && stats.systemCharsAfter !== undefined) {
		message += ` systemChars=${stats.systemCharsBefore}→${stats.systemCharsAfter}`;
	}
	if (stats.indexHash) {
		message += ` indexHash=${stats.indexHash}`;
	}

	logger.info(formatRequestLogLine(requestKind, message));
}
```

- [ ] **Step 4: 在 `src/provider/debug/index.ts` 导出**

```ts
export {
	createCacheDiagnosticsRecorder,
	logSkillIndexDiagnostics,
	logToolFlowDiagnostics,
	observeCancellationToken,
} from './diagnostics';
```

- [ ] **Step 5: 写 `src/provider/skills/flow.ts`**

```ts
import vscode from 'vscode';
import type { SkillIndexSettings } from '../../config';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../../consts';
import { logger } from '../../logger';
import { logSkillIndexDiagnostics } from '../debug';
import type { RequestKind } from '../routing';
import { SKILL_INDEX_NOTICE_START } from '../tools/consts';
import { createSkillIndexNotice } from '../tools/notices';
import { SKILLS_BLOCK_OPEN } from './consts';
import { parseSkillIndex, type ParsedSkillIndex } from './parse';
import { extractUserRequestText, renderRelevantSkillsBlock, renderSkillIndexStub } from './render';
import { buildSkillIndexModel, selectRelevantSkills } from './select';

export type SkillIndexAction =
	| 'off'
	| 'not-applicable'
	| 'absent'
	| 'passthrough'
	| 'trimmed'
	| 'error';

export interface SkillIndexStats {
	action: SkillIndexAction;
	threshold: number;
	maxRelevant: number;
	totalCount?: number;
	requestMessages?: number;
	/** Entries appended to each request message, in message order (0 when nothing matched). */
	injectedCounts?: number[];
	systemCharsBefore?: number;
	systemCharsAfter?: number;
	indexHash?: string;
}

export interface SkillIndexFlowOptions {
	/** Messages as returned by processToolFlow (notices and preflight control flow already removed). */
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	/** Messages exactly as the provider received them; used to see whether the notice was shown before. */
	rawMessages: readonly vscode.LanguageModelChatRequestMessage[];
	requestKind: RequestKind;
	settings: SkillIndexSettings;
}

export interface SkillIndexFlowResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	stats: SkillIndexStats;
	initialResponseNotice?: string;
}

type Message = vscode.LanguageModelChatRequestMessage;

interface LocatedSkillsBlock {
	messageIndex: number;
	partIndex: number;
	systemText: string;
	parsed: ParsedSkillIndex;
}

/**
 * Replaces Copilot's `<skills>` index with a stub when it is larger than the
 * threshold and appends the entries most relevant to each user request to
 * that request. Selection is a pure function of the request text, the
 * previous request text, the index and K, so history messages re-render
 * byte-identically every turn and the prompt-cache prefix is preserved. Any
 * failure forwards the conversation unchanged — this is an optimization.
 */
export function processSkillIndex(options: SkillIndexFlowOptions): SkillIndexFlowResult {
	const base: SkillIndexStats = {
		action: 'off',
		threshold: options.settings.threshold,
		maxRelevant: options.settings.maxRelevant,
	};
	let result: SkillIndexFlowResult;
	try {
		result = processSkillIndexUnsafe(options, base);
	} catch (error) {
		logger.warn(
			`[skill-index] failed, forwarding the prompt unchanged: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		result = { messages: options.messages, stats: { ...base, action: 'error' } };
	}
	logSkillIndexDiagnostics(options.requestKind, result.stats);
	return result;
}

function processSkillIndexUnsafe(
	{ messages, rawMessages, requestKind, settings }: SkillIndexFlowOptions,
	base: SkillIndexStats,
): SkillIndexFlowResult {
	if (settings.mode === 'off') {
		return { messages, stats: { ...base, action: 'off' } };
	}
	if (requestKind !== 'main-agent') {
		return { messages, stats: { ...base, action: 'not-applicable' } };
	}

	const located = locateSkillsBlock(messages);
	if (!located) {
		return { messages, stats: { ...base, action: 'absent' } };
	}
	const { parsed, systemText } = located;
	if (parsed.totalCount <= settings.threshold) {
		return {
			messages,
			stats: { ...base, action: 'passthrough', totalCount: parsed.totalCount, indexHash: parsed.hash },
		};
	}

	const rewrittenSystemText =
		systemText.slice(0, parsed.blockStart) +
		renderSkillIndexStub(parsed.totalCount) +
		systemText.slice(parsed.blockEnd);
	const model = buildSkillIndexModel(parsed.entries);
	const requestQueries = findRequestQueries(messages);

	const injectedCounts: number[] = [];
	const output: Message[] = [];
	let previousQuery: string | undefined;
	for (const [index, message] of messages.entries()) {
		if (index === located.messageIndex) {
			output.push(replaceTextPart(message, located.partIndex, rewrittenSystemText));
			continue;
		}
		const query = requestQueries.get(index);
		if (query === undefined) {
			output.push(message);
			continue;
		}
		const picks = selectRelevantSkills(
			model,
			{ current: query, previous: previousQuery },
			settings.maxRelevant,
		);
		previousQuery = query;
		injectedCounts.push(picks.length);
		output.push(
			picks.length > 0 ? appendTextPart(message, '\n' + renderRelevantSkillsBlock(picks)) : message,
		);
	}

	return {
		messages: output,
		stats: {
			...base,
			action: 'trimmed',
			totalCount: parsed.totalCount,
			requestMessages: requestQueries.size,
			injectedCounts,
			systemCharsBefore: systemText.length,
			systemCharsAfter: rewrittenSystemText.length,
			indexHash: parsed.hash,
		},
		initialResponseNotice: hasSkillIndexNotice(rawMessages)
			? undefined
			: createSkillIndexNotice(parsed.totalCount, settings.maxRelevant),
	};
}

/** The single system text part carrying `<skills>`; `undefined` when there is none or more than one. */
function locateSkillsBlock(messages: readonly Message[]): LocatedSkillsBlock | undefined {
	let located: LocatedSkillsBlock | undefined;
	for (const [messageIndex, message] of messages.entries()) {
		if ((message.role as number) !== LANGUAGE_MODEL_CHAT_SYSTEM_ROLE) {
			continue;
		}
		for (const [partIndex, part] of message.content.entries()) {
			if (!(part instanceof vscode.LanguageModelTextPart) || !part.value.includes(SKILLS_BLOCK_OPEN)) {
				continue;
			}
			if (located) {
				return undefined;
			}
			const parsed = parseSkillIndex(part.value);
			if (!parsed) {
				return undefined;
			}
			located = { messageIndex, partIndex, systemText: part.value, parsed };
		}
	}
	return located;
}

/**
 * Message index → query text for every user message that carries a
 * `<userRequest>`. Tool-result messages have no text parts and Copilot's
 * environment preamble has no `<userRequest>`, so both drop out. When the
 * conversation has no `<userRequest>` at all (non-agent surfaces), every
 * text-bearing user message becomes a request message scored on its own
 * full text. The fallback is content-addressed on purpose: keying it on
 * "the last text-bearing message" would make selection a function of
 * conversation length, so a message injected on one turn would lose its
 * block on the next and the cached prefix would diverge there.
 */
function findRequestQueries(messages: readonly Message[]): Map<number, string> {
	const queries = new Map<number, string>();
	const textBearing = new Map<number, string>();
	for (const [index, message] of messages.entries()) {
		if (message.role !== vscode.LanguageModelChatMessageRole.User) {
			continue;
		}
		const text = joinTextParts(message);
		if (text === undefined) {
			continue;
		}
		textBearing.set(index, text);
		const request = extractUserRequestText(text);
		if (request !== undefined) {
			queries.set(index, request);
		}
	}
	return queries.size > 0 ? queries : textBearing;
}

/** Concatenated text parts, or `undefined` when the message has none. */
function joinTextParts(message: Message): string | undefined {
	let text: string | undefined;
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text = (text ?? '') + part.value;
		}
	}
	return text;
}

function replaceTextPart(message: Message, partIndex: number, value: string): Message {
	return {
		...message,
		content: message.content.map((part, index) =>
			index === partIndex ? new vscode.LanguageModelTextPart(value) : part,
		),
	};
}

function appendTextPart(message: Message, value: string): Message {
	return { ...message, content: [...message.content, new vscode.LanguageModelTextPart(value)] };
}

function hasSkillIndexNotice(messages: readonly Message[]): boolean {
	return messages.some(
		(message) =>
			message.role === vscode.LanguageModelChatMessageRole.Assistant &&
			message.content.some(
				(part) =>
					part instanceof vscode.LanguageModelTextPart &&
					part.value.includes(SKILL_INDEX_NOTICE_START),
			),
	);
}
```

- [ ] **Step 6: 完整化 `src/provider/skills/index.ts`**

```ts
export { processSkillIndex } from './flow';
export type {
	SkillIndexAction,
	SkillIndexFlowOptions,
	SkillIndexFlowResult,
	SkillIndexStats,
} from './flow';
export { parseSkillIndex, extractTag } from './parse';
export type { ParsedSkillIndex, SkillIndexEntry } from './parse';
export { buildSkillIndexModel, selectRelevantSkills, tokenize } from './select';
export type { SkillIndexModel, SkillSelectionQuery } from './select';
export {
	extractUserRequestText,
	renderRelevantSkillsBlock,
	renderSkillIndexStub,
} from './render';
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `npm run compile:tests && node --require ./tests/mock-vscode.js --test out/tests/unit/skill-index-flow.test.js`
Expected: 10 个测试全部 PASS。常见失败与原因：
- `injectedCounts` 为 `[1, 0]`：第二条请求 `继续` 未继承上一轮查询，检查 `previousQuery` 是否在 `selectRelevantSkills` 之后才更新。
- 字节一致性用例失败：说明选择依赖了消息内容以外的东西。按可能性排序检查：消息在数组中的下标或会话长度（最常见，退化路径尤甚）、`Date`、随机数、`Map` 以外容器的迭代顺序。任何"取最后一条"的写法都属于此类。
- `error` 用例抛出而非捕获：确认 `try/catch` 包住了 `processSkillIndexUnsafe` 的整个调用。

- [ ] **Step 8: 全量测试、格式化、lint**

Run: `npm test && npm run format && npm run lint`
Expected: 全部 PASS，无 lint 错误。

- [ ] **Step 9: 提交**

```bash
git add src/provider/skills/flow.ts src/provider/skills/index.ts src/provider/debug/diagnostics.ts src/provider/debug/index.ts tests/unit/skill-index-flow.test.ts
git commit -m "feat(skills): 技能索引裁剪编排、缓存安全的尾部注入与诊断日志"
```

---

### Task 7: 接入 provider 流水线与 dump 元数据

**Files:**
- Modify: `src/provider/index.ts`（导入区与 `provideLanguageModelChatResponse`）
- Modify: `src/provider/request.ts`（`PrepareChatRequestOptions`、解构、`dumpAnthropicRequest` 调用）
- Modify: `src/provider/debug/dump.ts`（`DumpAnthropicRequestOptions`、`createPipelineSnapshot`、`createDumpSnapshot`）

**Interfaces:**
- Consumes: `processSkillIndex`、`SkillIndexStats`（Task 6）、`getSkillIndexSettings`（Task 4）
- Produces: request dump JSON 中新增 `skillIndex` 字段（`resolved` 阶段为 `SkillIndexStats | null`，`input` 阶段为 `undefined`）

- [ ] **Step 1: 修改 `src/provider/index.ts` 导入**

```ts
import { getAllModels, getBaseUrl, getSkillIndexSettings, getStabilizeToolListEnabled } from '../config';
```

在 `import { streamChatCompletion } from './stream';` 之前加入：

```ts
import { processSkillIndex } from './skills';
```

- [ ] **Step 2: 修改 `provideLanguageModelChatResponse` 主体**

把 `if (toolFlow.preflightHandled) { return; }` 之后到 `return streamChatCompletion({…})` 的部分改为：

```ts
		const skillIndex = processSkillIndex({
			messages: toolFlow.messages,
			rawMessages: messages,
			requestKind,
			settings: getSkillIndexSettings(),
		});

		const prepared = await prepareChatRequest({
			authManager: this.authManager,
			globalStorageUri: this.globalStorageUri,
			modelInfo,
			segment,
			messages: skillIndex.messages,
			options,
			token,
			cacheDiagnostics: this.cacheDiagnostics,
			getVisionDescriber: () => this.vision.get(),
			skillIndexStats: skillIndex.stats,
		});

		return streamChatCompletion({
			prepared,
			progress,
			token,
			initialResponseNotice: joinInitialResponseNotices(
				toolFlow.initialResponseNotice,
				skillIndex.initialResponseNotice,
				prepared.initialResponseNotice,
			),
			getCharsPerToken: () => this.charsPerToken,
			setCharsPerToken: (charsPerToken) => {
				this.charsPerToken = charsPerToken;
			},
		});
```

- [ ] **Step 3: 修改 `src/provider/request.ts`**

导入区加入：

```ts
import type { SkillIndexStats } from './skills';
```

`PrepareChatRequestOptions` 末尾加入字段：

```ts
	skillIndexStats?: SkillIndexStats;
```

`prepareChatRequest` 的解构参数列表加入 `skillIndexStats,`（放在 `getVisionDescriber,` 之后）。

`dumpAnthropicRequest(request, {…})` 的选项对象末尾加入：

```ts
		skillIndexStats,
```

- [ ] **Step 4: 修改 `src/provider/debug/dump.ts`**

导入区加入：

```ts
import type { SkillIndexStats } from '../skills';
```

`DumpAnthropicRequestOptions` 末尾加入：

```ts
	skillIndexStats?: SkillIndexStats;
```

`createPipelineSnapshot` 中 `vision:` 字段之后加入：

```ts
		skillIndex: stage === 'resolved' ? (options.skillIndexStats ?? null) : undefined,
```

`createDumpSnapshot` 的参数类型中 `vision?: object;` 之后加入：

```ts
	skillIndex?: SkillIndexStats | null;
```

其返回对象中 `vision: options.vision,` 之后加入：

```ts
		skillIndex: options.skillIndex,
```

- [ ] **Step 5: 编译、全量测试、lint、格式检查**

Run: `npm run compile && npm test && npm run lint && npm run format:check`
Expected: 四条命令全部成功。`compile` 若报循环依赖相关错误，检查 `config.ts` 对 `./provider/skills` 是否为 `import type`（本计划中 `SkillIndexSettings` 定义在 `config.ts`，`skills/flow.ts` 以 `import type` 反向引用，`config.ts` 不应导入 `skills`）。

- [ ] **Step 6: 打包冒烟**

Run: `npm run package`
Expected: `dist/` 下生成 `.vsix`，无错误。

- [ ] **Step 7: 手工验证（可选，需要真实凭证）**

1. 在 `~/.agents/skills/` 下放入 ≥ 33 个技能目录（每个含 `SKILL.md`），或临时把 `anthropic-copilot.skillIndex.threshold` 设为 `0`。
2. `anthropic-copilot.debugMode` 设为 `verbose`，F5 启动扩展开发宿主，在 Copilot Chat Agent 模式下用 Anthropic 模型连续发送两轮消息。
3. 运行命令 `Anthropic: Open Request Dumps Folder`，比较最新会话目录中 `anthropic-provider-input-*.json` 的 `systemPromptSummary.skillTagCount` 与 `anthropic-request-*.json` 的 `system` 长度；后者应只含桩。
4. 第二轮 `anthropic-request-*.json` 里第一条请求消息末尾的 `<relevant_skills>` 块应与第一轮完全相同。
5. 第一轮回复开头出现 ℹ️ 通知，第二轮不再出现。

- [ ] **Step 8: 提交**

```bash
git add src/provider/index.ts src/provider/request.ts src/provider/debug/dump.ts
git commit -m "feat(skills): 在请求流水线中接入技能索引裁剪并写入 dump 元数据"
```

---

### Task 8: 文档

**Files:**
- Create: `docs/notices/skill-index.en.md`
- Create: `docs/notices/skill-index.zh.md`
- Modify: `README.md`（Configuration Reference 表）
- Modify: `README.zh-cn.md`（配置属性说明表）
- Modify: `CLAUDE.md`（`### Other subsystems` 列表）
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 4 的设置名与默认值；Task 5 的通知链接目标
- Produces: 通知文案中链接指向的两个文档

- [ ] **Step 1: 写 `docs/notices/skill-index.en.md`**

```markdown
# Large Skills Index

Anthropic Claude for Copilot Chat detected that Copilot injected a large Agent Skills index into the system prompt and trimmed it before sending the request to Anthropic.

## Why This Happens

When Agent Skills are enabled, Copilot Chat lists **every** skill it discovers (`.github/skills`, `.claude/skills`, `~/.agents/skills`, …) in the system prompt as `<skill>` entries with a name, a description and a file path. Skill bodies are loaded on demand with `read_file`, but the index itself is sent in full on every request.

With many skills this index dominates the prompt. In one measured setup 1,551 skills produced a 480 KB block — well over 100K tokens per request — most of it unrelated to the task at hand.

## What The Extension Does

When the index has more entries than `anthropic-copilot.skillIndex.threshold` (default **32**), the extension:

1. Replaces the whole `<skills>` block in the system prompt with a short fixed note.
2. Appends a `<relevant_skills>` block to each user request containing at most `anthropic-copilot.skillIndex.maxRelevant` (default **12**) entries chosen by lexical similarity between the request text and each skill's name and description. Entries keep Copilot's exact `<skill>` markup.

Selection is deterministic and depends only on the request text, the previous request text, the index and the limit, so earlier turns re-render identically on every request and the Anthropic prompt cache prefix stays intact. No additional model call is made.

## Impact

- Input tokens drop by roughly the size of the removed index.
- Skills that were not selected are invisible to the model for that request. The note in the system prompt tells the model to ask you for a skill's file path if you name one it cannot see.
- Each user message in the conversation carries at most `maxRelevant` entries (about 320 characters each); this content is cached after the first request.

## What You Can Do

1. Raise `anthropic-copilot.skillIndex.maxRelevant` if relevant skills are being missed, or raise `anthropic-copilot.skillIndex.threshold` if you want trimming only for very large indexes.
2. Set `anthropic-copilot.skillIndex.mode` to `off` to forward the index unchanged.
3. Reduce the number of skills Copilot discovers by moving rarely used skills out of the scanned folders.
4. Set `anthropic-copilot.debugMode` to `verbose` and open the request dumps (`Anthropic: Open Request Dumps Folder`) to see exactly which entries were sent.

If you have a better solution, please join the discussion in [issues](https://github.com/luorenjin/anthropic-for-copilot/issues).
```

- [ ] **Step 2: 写 `docs/notices/skill-index.zh.md`**

```markdown
# 技能索引过大

Anthropic Claude for Copilot Chat 检测到 Copilot 向系统提示注入了一份很大的 Agent Skills 索引，并在发送给 Anthropic 之前对其做了裁剪。

## 为什么会发生

启用 Agent Skills 后，Copilot Chat 会把它发现的**全部**技能（`.github/skills`、`.claude/skills`、`~/.agents/skills` 等）以 `<skill>` 条目的形式列在系统提示里，每条包含名称、描述和文件路径。技能正文由模型按需通过 `read_file` 加载，但索引本身每次请求都会全量发送。

技能一多，这份索引就会占满提示。实测一个安装了 1,551 个技能的环境，索引块达到 480 KB，每次请求超过 10 万 token，其中绝大部分与当前任务无关。

## 扩展做了什么

当索引条数超过 `anthropic-copilot.skillIndex.threshold`（默认 **32**）时，扩展会：

1. 把系统提示中的整个 `<skills>` 块替换为一段固定的简短说明。
2. 在每条用户请求末尾追加一个 `<relevant_skills>` 块，其中最多包含 `anthropic-copilot.skillIndex.maxRelevant`（默认 **12**）条技能，按请求文本与技能名称、描述之间的词法相似度选出。条目保留 Copilot 原始的 `<skill>` 格式。

选择过程是确定性的，只依赖请求文本、上一条请求文本、索引内容和条数上限，因此历史轮次每次都会渲染出完全相同的内容，Anthropic 的 prompt cache 前缀不受影响。整个过程不产生额外的模型调用。

## 影响

- 输入 token 大致减少被移除索引的大小。
- 未被选中的技能在该次请求中对模型不可见。系统提示中的说明会让模型在你提到它看不到的技能时向你询问文件路径。
- 会话中每条用户消息最多携带 `maxRelevant` 条条目（每条约 320 字符），这些内容在第一次请求之后会命中缓存。

## 你可以怎么做

1. 如果相关技能经常被漏掉，调高 `anthropic-copilot.skillIndex.maxRelevant`；如果只想在索引特别大时才裁剪，调高 `anthropic-copilot.skillIndex.threshold`。
2. 把 `anthropic-copilot.skillIndex.mode` 设为 `off`，原样转发索引。
3. 把不常用的技能移出 Copilot 扫描的目录，减少被发现的技能数量。
4. 把 `anthropic-copilot.debugMode` 设为 `verbose`，通过 `Anthropic: Open Request Dumps Folder` 查看实际发送了哪些条目。

如果你有更好的解决方案，欢迎在 [Issues](https://github.com/luorenjin/anthropic-for-copilot/issues) 讨论。
```

- [ ] **Step 3: 在 `README.md` 的 Configuration Reference 表末尾（`debugMode` 行之后）追加**

```markdown
| `anthropic-copilot.skillIndex.mode` | `string` | `"auto"` | Trim Copilot's Agent Skills index when it is large (`auto`) or forward it unchanged (`off`). See [docs](docs/notices/skill-index.en.md) |
| `anthropic-copilot.skillIndex.threshold` | `number` | `32` | Trim only when the index has strictly more entries than this (`0` = always) |
| `anthropic-copilot.skillIndex.maxRelevant` | `number` | `12` | Skills appended to each user request after trimming (1–64) |
```

- [ ] **Step 4: 在 `README.zh-cn.md` 的配置属性说明表末尾（`debugMode` 行之后）追加**

```markdown
| `anthropic-copilot.skillIndex.mode` | `string` | `"auto"` | Copilot 技能索引过大时是否裁剪（`auto`）或原样转发（`off`），详见[文档](docs/notices/skill-index.zh.md) |
| `anthropic-copilot.skillIndex.threshold` | `number` | `32` | 索引条数严格大于该值才裁剪（`0` 表示总是裁剪） |
| `anthropic-copilot.skillIndex.maxRelevant` | `number` | `12` | 裁剪后每条用户请求最多追加的技能数（1–64） |
```

- [ ] **Step 5: 在 `CLAUDE.md` 的 `### Other subsystems` 列表中、`provider/debug/` 条目之后插入**

```markdown
- **`provider/skills/`** — trims Copilot's Agent Skills index. Copilot lists every discovered skill as a `<skill>` entry inside a `<skills>` block in the system prompt (1,551 entries / 480 KB in one measured setup). When `totalCount > anthropic-copilot.skillIndex.threshold` (default 32; 0 = always), `processSkillIndex` (`flow.ts`, called from `provider/index.ts` after `processToolFlow`, `main-agent` requests only) swaps the block for a fixed stub and appends a `<relevant_skills>` block with at most `maxRelevant` (default 12) entries to **every** user message carrying a `<userRequest>`. Three invariants: (1) selection (`select.ts`) is a pure lexical IDF function of the request text, the previous request text, the index and K, so history messages re-render byte-identically each turn and the prompt-cache prefix survives — never add non-deterministic inputs; (2) only the `<userRequest>` inner text is scored, never the surrounding `<context>`/`<reminderInstructions>`; (3) any parse failure or exception forwards the messages untouched (`stats.action` = `absent` / `error`). Entries are re-emitted as their raw bytes.
```

- [ ] **Step 6: 在 `CHANGELOG.md` 的 `## [1.0.0] - 2026-09-09` 之前插入**

```markdown
## [Unreleased]

### Added
- **Skills Index Trimming**: When Copilot Chat injects a large Agent Skills index into the system prompt (more than `anthropic-copilot.skillIndex.threshold` entries, default 32), the extension now replaces it with a short stub and appends only the `anthropic-copilot.skillIndex.maxRelevant` (default 12) skills most relevant to each user request. Selection is deterministic so the Anthropic prompt-cache prefix is preserved across turns. A one-time notice links to `docs/notices/skill-index.*.md`; set `anthropic-copilot.skillIndex.mode` to `off` to disable.

```

- [ ] **Step 7: 校验链接与格式**

Run: `npm run format:check && node -e "for (const f of ['docs/notices/skill-index.en.md','docs/notices/skill-index.zh.md']) require('fs').accessSync(f); console.log('docs ok')"`
Expected: 输出 `docs ok`，格式检查通过（Markdown 不在 oxfmt 范围内，此步主要确认没有误改到 `src/`）。

- [ ] **Step 8: 提交**

```bash
git add docs/notices/skill-index.en.md docs/notices/skill-index.zh.md README.md README.zh-cn.md CLAUDE.md CHANGELOG.md
git commit -m "docs(skills): 技能索引裁剪的通知文档、README 配置说明与 CLAUDE.md"
```

---

## 自检记录

**Spec 覆盖**

| Spec 章节 | 任务 |
|---|---|
| §3.2 接入点、§3.3 数据流 | Task 6（编排）、Task 7（接入） |
| §4.1 parse | Task 1 |
| §4.2 select（分词、IDF、权重、0.5、截断、排序） | Task 2 |
| §4.3 render（桩、追加块、extractUserRequestText） | Task 3 |
| §4.4 flow 十步 | Task 6 |
| §5 缓存不变量 | Task 6 字节一致性测试 |
| §6 配置与钳制 | Task 4 |
| §7 诊断（日志行、dump 元数据） | Task 6（日志）、Task 7（dump） |
| §8 通知（标记、i18n、首次显示） | Task 5、Task 6 |
| §9 错误处理表 | Task 6（absent / passthrough / error 用例） |
| §10 测试（含 mock 扩展） | Task 1–6 |
| §11 文档 | Task 8 |

**类型一致性**：`SkillIndexSettings` 定义于 `src/config.ts`（Task 4），`flow.ts` 与测试均以 `import type` 从 `../../src/config` 引用；`SkillIndexStats` 定义于 `skills/flow.ts`（Task 6），`diagnostics.ts`、`dump.ts`、`request.ts` 均以 `import type` 从 `../skills` / `./skills` 引用。`processSkillIndex` 的参数与 `provider/index.ts` 调用处一致；`createSkillIndexNotice(totalCount, maxRelevant)` 在 Task 5 定义、Task 6 调用。

**与 spec 的两处细节差异（有意为之）**：
1. spec §4.4 第 3 步只说"System 消息"，实现同时用 `LANGUAGE_MODEL_CHAT_SYSTEM_ROLE` 判定，因为 `@types/vscode` 不暴露 `System` 枚举值（见 `src/consts.ts` 注释与 `convert.ts` 的同样做法）。
2. spec §7 的日志"每请求一行"在实现中跳过 `not-applicable`，避免每个后台请求（标题、提交信息生成）都打一行无意义日志；`absent`、`off` 仍会记录，spec §12 依赖 `action=absent` 发现格式变化的诉求得以保留。
