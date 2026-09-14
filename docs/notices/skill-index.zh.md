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
