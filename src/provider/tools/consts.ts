// Anthropic Messages API tool limit (128 functions supported)
export const ANTHROPIC_TOOLS_LIMIT = 128;

export const ACTIVATE_TOOL_PREFIX = 'activate_';
export const PREFLIGHT_ACTIVATE_CALL_ID_PREFIX = 'anthropic_preflight_activate_';
export const MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST = 3;

export const TOOL_DRIFT_NOTICE_START = '[anthropic-copilot-tool-drift-notice-start]: #';
export const TOOL_DRIFT_NOTICE_END = '[anthropic-copilot-tool-drift-notice-end]: #';
export const VISION_PROXY_NOTICE_START = '[anthropic-copilot-vision-proxy-notice-start]: #';
export const VISION_PROXY_NOTICE_END = '[anthropic-copilot-vision-proxy-notice-end]: #';

export const SKILL_INDEX_NOTICE_START = '[anthropic-copilot-skill-index-notice-start]: #';
export const SKILL_INDEX_NOTICE_END = '[anthropic-copilot-skill-index-notice-end]: #';
