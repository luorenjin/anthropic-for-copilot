## Stabilize Tool List (Experimental)

First, open VS Code's Tools configuration and check how many tools are enabled for chat.

[Configure Tools](command:workbench.action.chat.configureTools)

- 64 or fewer enabled tools: there is usually no need to turn this on unless the tool list still changes across turns.
- More than 128 enabled tools: not recommended. Anthropic supports at most 128 functions in one `tools` request, so Anthropic Copilot cannot guarantee a stable `tools` list above that limit. Disable rarely used tools first, then consider enabling this setting.
- Between 64 and 128 enabled tools: consider this setting only if the tools list changes between turns and Anthropic prompt-cache hits are poor.

This setting may improve cache hits by making the Anthropic API `tools` parameter more complete and stable across turns. It may also increase input tokens because more function definitions can be included in each request.

[Open Anthropic setting](command:workbench.action.openSettings?%5B%22%40id%3Aanthropic-copilot.experimental.stabilizeToolList%22%5D)
