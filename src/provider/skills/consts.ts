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
	'the',
	'a',
	'an',
	'to',
	'for',
	'of',
	'and',
	'or',
	'in',
	'on',
	'with',
	'this',
	'that',
	'is',
	'are',
	'be',
	'use',
	'using',
	'used',
	'when',
	'user',
	'users',
	'asks',
	'ask',
	'asked',
	'your',
	'you',
	'it',
	'as',
	'by',
	'from',
	'at',
	'into',
	'will',
	'can',
	'should',
	'any',
	'all',
	'not',
	'if',
	'do',
	'does',
	'how',
	'what',
	'which',
	'about',
	'also',
	'need',
	'needs',
	'help',
	'me',
	'my',
	'we',
	'our',
	'please',
	// Chinese words and bigrams
	'我们',
	'一下',
	'一个',
	'这个',
	'那个',
	'进行',
	'需要',
	'可以',
	'如何',
	'什么',
	'怎么',
	'继续',
	'帮我',
	'请你',
	'一些',
	'然后',
	'以及',
	'或者',
	'因为',
	'所以',
	'这些',
	'那些',
]);

/** Any Han bigram containing one of these characters is dropped as noise. */
export const HAN_STOP_CHARS: ReadonlySet<string> = new Set([
	'的',
	'了',
	'是',
	'在',
	'和',
	'与',
	'或',
	'请',
	'我',
	'你',
	'帮',
	'吧',
	'吗',
	'呢',
	'把',
	'被',
	'就',
	'都',
	'也',
	'很',
	'这',
	'那',
	'要',
	'让',
	'给',
	'做',
]);
