# Large Skills Index

Anthropic Claude for Copilot Chat detected that Copilot injected a large Agent Skills index into the system prompt and trimmed it before sending the request to Anthropic.

## Why This Happens

When Agent Skills are enabled, Copilot Chat lists **every** skill it discovers (`.github/skills`, `.claude/skills`, `~/.agents/skills`, …) in the system prompt as `<skill>` entries with a name, a description and a file path. Skill bodies are loaded on demand with `read_file`, but the index itself is sent in full on every request.

With many skills this index dominates the prompt. In one measured setup 1,551 skills produced a 480 KB block — well over 100K tokens per request — most of it unrelated to the task at hand.

## What The Extension Does

When the index has more entries than `anthropic-copilot.skillIndex.threshold` (default **128**), the extension:

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
