# SDD ledger — plan: docs/superpowers/plans/2026-09-14-skill-index-trimming.md

Spec: docs/superpowers/specs/2026-09-14-skill-index-trimming-design.md (reachable, read)
Worktree: D:\AI\anthropic-for-copilot\.claude\worktrees\skill-index-trimming, branch feat/skill-index-trimming
Merge base (branch start): 9e55655 (main after committing pending mcp-filter/deactivate work)
Baseline: npm test 53 pass / 0 fail

## Pre-flight scan

### Task pairs sharing a file or interface

| Tasks | Produces → Consumes | Finding |
|---|---|---|
| T1 → T2 | `SkillIndexEntry`; `NAME_TOKEN_WEIGHT`/`DESCRIPTION_TOKEN_WEIGHT`/`PREVIOUS_QUERY_WEIGHT`/`QUERY_MAX_CHARS`/`MIN_LATIN_TOKEN_LENGTH`/`STOP_WORDS`/`HAN_STOP_CHARS` → select.ts imports | consistent |
| T1 → T3 | `extractTag`, `SkillIndexEntry`, `RELEVANT_SKILLS_TAG`, `USER_REQUEST_TAG` → render.ts | consistent |
| T3 → T6 | `skills/index.ts` created in T3 (parse/select/render), rewritten in full in T6 adding flow exports | consistent (T6 text is a superset) |
| T4 → T6 | `SkillIndexSettings` defined in `src/config.ts`; flow.ts and flow test `import type` from config | consistent; Global Constraint about `config.ts` importing the skills barrel is moot (config.ts imports nothing from skills) |
| T4 → T7 | `getSkillIndexSettings()` → provider/index.ts import line | consistent |
| T5 → T6 | `createSkillIndexNotice(totalCount, maxRelevant)`, `SKILL_INDEX_NOTICE_START` → flow.ts; mock LM classes → flow test | consistent |
| T5 → T6 | `stripProviderNotices` gains the skill-index marker pair; T6's byte-stability relies on it for the notice | consistent |
| T6 → T7 | `processSkillIndex({messages, rawMessages, requestKind, settings})`, `SkillIndexStats`, `logSkillIndexDiagnostics(requestKind, stats)` via debug barrel → index.ts/request.ts/dump.ts | consistent |
| T4 ↔ T8 | setting ids `skillIndex.mode/threshold/maxRelevant`, defaults 32/12/64 → README/CLAUDE.md/CHANGELOG | consistent |
| T5 ↔ T8 | notice links `docs/notices/skill-index.{en,zh}.md` → files created in T8 | consistent (T5 tests only assert the link string) |

### Per-task self-consistency

| Task | Tests vs code / files created vs touched | Finding |
|---|---|---|
| T1 | 8 tests; `totalCount` counts unnamed entry, `entries` skips it; offsets slice PREFIX/SUFFIX exactly; sha1[0:10] hash | consistent |
| T2 | 11 tests hand-checked against the algorithm (kebab split, Han bigrams, stop chars incl. 做, IDF ln(1+N/df), name 3 > desc 1, 0.5 previous weight, 2000-char cut) | consistent |
| T3 | stub/blocks equality tests match the render code verbatim | consistent |
| T4 | clamp tests (−5→0, 7.9→7, 'many'→32, 0→0; 0→1, 999→64, NaN→12) match `clampInteger` | consistent |
| T5 | mock classes inserted before `vscodeStub`, exported after `ConfigurationTarget`; notice test relies on `filterProviderNotices` (exists) | consistent; import-chain risk (`notices.ts` → vision/protocols/errors) has a fallback step |
| T6 | 10 tests hand-checked: injectedCounts [1,1], byte identity over first 4 msgs, notice suppression via raw history, fallback without `<userRequest>`, error path via `content: null` | consistent |
| T7 | edits target current committed text of index.ts/request.ts/dump.ts (post-mcp-filter commit 9e55655) | consistent |
| T8 | docs only | consistent |

### Rubric conflicts

- `parse.ts` computes its own `sha1[0:10]` while `diagnostics.ts`/`dump.ts` each have a private `hashString`. One-line duplication of a private helper; not a shared-module candidate without exporting from debug (would create a skills→debug→skills shape). Accepted.
- No test asserts nothing; no verbatim logic-block duplication mandated.

Scan result: no conflicts requiring a ruling before Task 1.

## Model plan

- Implementers: T1–T3, T8 haiku (transcription); T4–T7 sonnet (multi-file integration).
- Task reviewers: sonnet for T1–T5, T8; opus for T6, T7.
- Final whole-branch review: fable.

## Progress

Task 1: dispatched (BASE 9e55655, implementer haiku)

Ruling: baseline is not format-clean on this Windows checkout — (a) core.autocrlf=true checks files out as CRLF while oxfmt requires LF, so `npm run format:check` fails on 83/85 files until `npm run format` rewrites the tree to LF; afterwards `git status` lists ~75 files as M with EMPTY diffs (harmless noise, cannot be staged into a change); (b) 9 files carry real oxfmt drift at base (client/error/index.ts, credentials.ts, i18n.ts, provider/convert.ts, provider/debug/diagnostics.ts, provider/debug/dump.ts, provider/index.ts, provider/vision/sources/vscode/index.ts, runtime/provider.ts) — committed once as standalone chore commit so the format:check gate is meaningful and Tasks 5–7 (which edit i18n.ts/diagnostics.ts/dump.ts/index.ts) do not absorb the drift — cost if wrong: the user drops one cosmetic 35+/28- commit.
Procedure for implementers: run `npm run format` before `format:check`; treat line-ending-only M entries in git status as expected; stage only task files; confirm with `git diff --stat -w`.
Task 1: implementer DONE (commit b1f8bc5, 61/61 tests); review dispatched (sonnet), package review-9e55655..b1f8bc5.diff

Task 1: review — 1 Important (plan-mandated: new test file LF vs sibling tests CRLF), 2 Minor.
Ruling: the Important finding is a false positive — the constraint concerns the repository convention, and `git ls-files --eol` shows every committed blob (all tests, all src) is i/lf; sibling tests appear as CRLF only because core.autocrlf=true converts them on checkout (w/crlf), while the new file was written LF and is stored LF like its siblings. No fix. Cost if wrong: none — the stored bytes are identical either way.
Task 1: minor (deferred): parse.ts — an unterminated <skill> breaks the entry loop, dropping later entries and not counting it in totalCount, contradicting the totalCount doc comment.
Task 1: minor (deferred): parse.ts — the multi-block guard is a blind substring search; a <skills> literal inside an entry description would make the parser bail with undefined.
Task 1: complete (commits 9e55655..b1f8bc5, review clean after ruling; 2 minors deferred). Baseline chore commit c6d00a7 sits between Task 1 and Task 2.
Task 2: dispatched (BASE c6d00a7, implementer haiku)

Ruling: `npm run lint` has exactly 2 pre-existing errors at baseline (unused import AnthropicRequest in src/provider/convert.ts; unused function formatDiagnosticImageUrlSummary in src/provider/debug/diagnostics.ts). They are outside this plan's scope and are left untouched; the lint gate for every task is "introduces no new lint error". Cost if wrong: the user fixes two trivial pre-existing lint errors that predate this branch.
Task 2: implementer DONE (commit 434772b, 72/72 tests); review dispatched (sonnet), package review-c6d00a7..434772b.diff

Task 2: review — Approved, 0 Critical/Important, 3 Minor. (Reviewer mistakenly ran oxfmt --write on the select test, self-reverted via git checkout; controller verified `git diff --stat -w` is empty.)
Task 2: minor (deferred): select.ts buildSkillIndexModel — "max wins" doc comment relies on write order (description then name) rather than Math.max; correct only while NAME_TOKEN_WEIGHT > DESCRIPTION_TOKEN_WEIGHT.
Task 2: minor (deferred): select.ts pushHan — a lone Han character in HAN_STOP_CHARS is dropped, slightly beyond the bigram-only wording of the spec (harmless).
Task 2: minor (deferred): implementer report line counts inconsistent (report-accuracy nit, not code).
Task 2: complete (commits c6d00a7..434772b, review clean)
Task 3: dispatched (BASE 434772b, implementer haiku)

Task 3: implementer (haiku) died on API 429 rate_limit_error mid-work, having written only tests/unit/skill-index-render.test.ts (uncommitted). Removed the partial file; branch head unchanged at 434772b.
Ruling: haiku is rate-limited on this account right now — all remaining implementers and reviewers move to sonnet (and opus/fable where the plan already called for it). Cost if wrong: slightly higher token spend per task than the original model plan.
Task 3: re-dispatched (BASE 434772b, implementer sonnet)

Task 3: implementer DONE (commit d14b88f, 75/75 tests); review dispatched (sonnet), package review-434772b..d14b88f.diff

Task 3: review — Approved, 0 findings (reviewer character-diffed render.ts and the test against the brief: byte-identical).
Task 3: complete (commits 434772b..d14b88f, review clean)
Task 4: dispatched (BASE d14b88f, implementer sonnet)

Task 4: implementer DONE (commit af020d1, 79/79 tests, JSON valid); review dispatched (sonnet), package review-d14b88f..af020d1.diff

Task 4: review — Approved, 0 Critical/Important, 2 Minor. NLS key parity verified in both languages; all 8 clamp cases hand-traced and hold.
Task 4: minor (deferred): package.json threshold has no JSON-schema maximum (upper bound only in code) — matches the brief.
Task 4: minor (deferred): mode.auto description says "more entries than threshold" without the word "strictly"; unambiguous, both languages consistent.
Task 4: complete (commits d14b88f..af020d1, review clean)
Task 5: dispatched (BASE af020d1, implementer sonnet)

Task 5: implementer DONE (commit 5d29ad7, 82/82 tests; no extra mock surface needed); review dispatched (sonnet), package review-af020d1..5d29ad7.diff

Task 5: review — Approved, 0 Critical/Important, 2 Minor. Strip-list registration confirmed (the cache-stability-critical check); notice shape is a structural clone of createToolDriftNotice; both dictionaries in parity.
Task 5: minor (deferred): mock LanguageModelChatMessageRole.System=3 has no counterpart in the real @types/vscode enum (brief-mandated; matches src/consts.ts LANGUAGE_MODEL_CHAT_SYSTEM_ROLE).
Task 5: minor (deferred): the notice links to docs/notices/skill-index.{zh,en}.md, created later in Task 8 — downstream dependency, tracked.
Task 5: complete (commits af020d1..5d29ad7, review clean)
Task 6: dispatched (BASE 5d29ad7, implementer opus — largest and most load-bearing task)

Task 6: implementer DONE (commit 2b077a2, 92/92 tests; self-verified reference identity, previousQuery ordering, and that compiled diagnostics.js has no require("../skills")); review dispatched (opus), package review-5d29ad7..2b077a2.diff

Task 6: review (opus) — Spec ❌. 1 Critical (plan-mandated), 0 Important, 6 Minor.
Critical: flow.ts findRequestQueries fallback `queries.set(lastTextIndex, lastText)` keys on the LAST text-bearing user message — a function of position/conversation length, not content. On that path, a message injected on turn N loses its block on turn N+1, so the prefix diverges and the cache breaks every turn. Path is reachable: classifyProviderRequest returns main-agent for any prompt containing <skills>.
Ruling: the finding stands over the plan text. The spec (§5 cache invariant) is the binding authority and the plan (§4.4 step 6) contradicts it; my own plan authored the defect. Fix = content-addressed fallback: when no <userRequest> exists anywhere, EVERY text-bearing user message is a request message scored on its own full text. This preserves the invariant for the same reason the main path does (history is append-only, so the set of earlier request messages for any given message never changes) AND keeps the feature working on surfaces that do not use <userRequest> — rejected the alternative of refusing to trim there, which would forfeit all token relief on exactly the unknown surfaces the fallback exists for. Cost if wrong: on a non-<userRequest> surface, Copilot environment-preamble messages also carry a <relevant_skills> block (stable, cached, ~K*320 chars once).
Ruling: reviewer Minor #4 (byte-identity test is shallow — only 4 messages, the sole injected message has previous=undefined, never exercises the previousQuery chain, never runs the fallback) is folded into this fix round rather than deferred, because it is the guard for the very invariant the Critical broke.
Task 6: minor (deferred): never-throw boundary not fully closed — `base` construction and the logSkillIndexDiagnostics call sit outside the try (brief-mandated shape; logger can throw if the output channel is disposed).
Task 6: minor (deferred): `absent` collapses four distinct causes (no block / multiple <skills> / unterminated / ambiguous multi-part) into one action with entries=0; add a reason field for diagnosability.
Task 6: minor (deferred): base.action placeholder `off` is always overwritten; Omit<SkillIndexStats,"action"> would make the invariant structural.
Task 6: minor (deferred): logSkillIndexDiagnostics body never executes under test (debug logging off), so its four format branches are unexercised; log line contains a non-ASCII arrow.
Task 6: minor (deferred): no test for the ambiguous/unterminated index path (the malformed-message test exercises catch, not parse rejection).
Task 6: fix round 1/5 dispatched (resume implementer opus): Critical fallback + folded Minor #4.

Task 6: fix round 1/5 — implementer DONE (commit 50526c3, 93/93; flow file 11/11). RED evidence genuine: new fallback test failed against old code on the byte-identity assertion (message #3 lost its block on turn N+1), 9 pass/2 fail; after fix 11/11. Implementer also mutation-checked the deepened test (previousQuery made conversation-scoped → both byte-identity cases fail, 8 pass/3 fail), then restored. Scoped re-review dispatched (sonnet), package review-2b077a2..50526c3.diff
Spec and plan text corrected to match the ruling: docs/superpowers/specs (4 places) and docs/superpowers/plans (findRequestQueries body, both byte-identity tests, troubleshooting note) now describe the content-addressed fallback.

Task 6: fix round 1/5 re-review — both findings ADDRESSED, no new breakage. Reviewer independently diffed old vs new findRequestQueries (main <userRequest> path byte-for-byte unchanged), traced the deepened test (message #5 "继续" has a real earlier previous and its injectedCounts entry is asserted truthy), and confirmed the fallback test compares a 5-message turn against a 7-message turn.
Task 6: out-of-scope note (deferred): whether the fallback branch activates is a whole-conversation property — any <userRequest> anywhere puts every turn on the main path. Intended by the ruling and stable in practice (a given Copilot surface either always wraps or never does), but worth naming for future readers.
Task 6: complete (commits 5d29ad7..50526c3, review clean after 1 fix round; 6 minors deferred)
Task 7: dispatched (BASE 50526c3, implementer sonnet)

Task 7: implementer DONE (commit 9f34b8f, 93/93 tests, compile/lint/format clean, npm run package produced dist/anthropic-for-copilot.vsix, gitignored and unstaged). Manual Extension-Development-Host verification skipped by instruction, left for the human. Review dispatched (opus), package review-50526c3..9f34b8f.diff

Task 7: review — Approved, 0 Critical/Important, 3 Minor. All four named risks verified: data flow (messages→toolFlow.messages, rawMessages→original messages, prepareChatRequest→skillIndex.messages, with no shadowing in between), placement after the short-circuit guard, both new imports type-only, skillIndex only on the resolved stage. Reviewer additionally confirmed non-skills paths return the same array reference, so behavior is byte-identical to before for them.
Task 7: minor (deferred): dump.ts `?? null` branch unreachable while stats is required — readers of a dump should treat action=off/not-applicable/absent/passthrough, not a null skillIndex, as "not trimmed".
Task 7: minor (deferred): skillIndexStats passes through prepareChatRequest purely to reach the dump, like segment/cacheDiagnostics — existing style, but the signature keeps widening.
Task 7: minor (deferred): the wiring itself has no test and a swap between the three same-typed arrays would compile and pass all 93 tests; reviewer sketched a probe-based regression test (not written, per instruction).
Task 7: complete (commits 50526c3..9f34b8f, review clean)
Task 8: dispatched (BASE 9f34b8f, implementer sonnet)

Task 8: implementer DONE (commit d03702f, 93/93 unchanged, both notice files verified at the exact i18n-linked paths). Applied the ruling: rewrote the CLAUDE.md provider/skills bullet to describe the content-addressed fallback; the two notice docs made no claim about it and needed no change. Review dispatched (sonnet), package review-9f34b8f..d03702f.diff

Task 8: review — Approved, 0 Critical/Important, 2 Minor. Reviewer verified every setting claim against package.json and config.ts, both notice files at the exact i18n-linked paths, the Open Request Dumps Folder command really exists, the no-extra-model-call claim, and full bilingual parity.
Task 8: minor (deferred): the notice docs add a "What The Extension Does" section the tool-drift house template lacks (brief-mandated; earns its place given the two-step mechanism).
Task 8: minor (deferred): the CHANGELOG entry is one dense sentence versus 1.0.0 short bullets.
Task 8: complete (commits 9f34b8f..d03702f, review clean)
ALL 8 TASKS COMPLETE. Final whole-branch review dispatched (fable), package review-9e55655..d03702f.diff, pointed at the deferred-minor list above.

=== FINAL WHOLE-BRANCH REVIEW (fable) — Ready with fixes ===
Critical 1: flow.ts:95 returns early when requestKind !== main-agent, but classifier.ts:92-93 assigns terminal-steering purely from the LATEST user message matching /^\[Terminal \S+ notification:/, before it ever looks at the system prompt. So an Agent-mode turn triggered by a terminal notification ships the full 480KB index and loses every historical <relevant_skills> block — a full-prefix cache miss (~130k tokens), triggered by Copilot rather than the user, and invisible because diagnostics silences not-applicable. The spec assumption "other request kinds do not carry the block" is false for this kind.
Ruling: fix it, content-addressed. Drop the requestKind early return; run locateSkillsBlock unconditionally and pick the action from what is actually in the prompt (block absent -> main-agent ? absent : not-applicable). This removes the last hidden input to the trim/no-trim decision and keeps not-applicable log silence for genuine background requests. Cost if wrong: a few extra string includes on background turns.
Ruling: also raise DEFAULT_SKILL_INDEX_THRESHOLD 32 -> 128 (review Minor 3). Break-even is N > R*K: at K=12 and N=33 a conversation with 3+ requests carries more skill bytes than the block it replaced, and the model sees 12 of 40 skills for no real saving. 128 keeps the default out of that regime while still catching the case the feature exists for (1551 entries). Cost if wrong: users with 33-128 skills keep an untrimmed block until they lower the setting themselves.
Ruling: include review Minor 5 (stats.reason + info-level log when a <skills> literal is present but parsing refused) in the same wave, since it lands in the code the Critical already touches and it is what makes the strict parse guard diagnosable instead of silent. Cost if wrong: one extra log line per affected request.
Ruling: DEFER review Minor 6 (stub wording), Minor 8 (memoize the model per index hash) and the deferred-minor triage table (all "ship as-is" bar the two above). Minor 6 touches the byte-exact stub contract for cosmetic gain; Minor 8 is an unmeasured perf change. Neither belongs in a post-final-review fix wave. Cost if wrong: minor polish deferred to a follow-up.
Important 2 (no automated guard on the three-array wiring; EDH verification skipped) stays open for the human — surfaced in the handoff, not fixable by a subagent without an interactive VS Code session.
Final fix wave dispatched (opus): Critical 1 + Minor 3 + Minor 5 + Minor 7 comment.

Spec corrected for final-review Minor 4: §7 no longer claims HostPromptTrace reflects Copilot original input — it reflects the outbound (trimmed) prompt, which is correct for cache diagnostics; the provider-input dump keeps the original.

Final fix wave: implementer DONE_WITH_CONCERNS (commit 798099c, 97/97 tests, was 93). Fix 1 RED confirmed (actual not-applicable, expected trimmed) then GREEN; compile/lint/format/package clean. Implementer also edited CLAUDE.md (outside its file list) because the provider/skills bullet stated both the old default and "main-agent requests only", which Fix 1 falsifies — controller judges that edit necessary and correct. Scoped re-review dispatched (opus), package review-d03702f..798099c.diff

Final fix wave re-review — all 4 findings ADDRESSED, no new Critical/Important breakage. Reviewer confirmed requestKind now only labels the no-block outcome (6 remaining references, one functional), the terminal-steering test is structurally capable of failing against the old code, and all 10 places stating the default threshold were updated with no stragglers. All four implementer concerns judged acceptable as shipped.
Controller applied the residual nit: CLAUDE.md invariant (3) reworded — a parse failure sets absent/not-applicable WITH a reason, an exception sets error with NO reason (commit 2495899).
Spec text brought in line with shipped behavior: requestKind no longer gates trimming (§3.2, §4.4 step list renumbered), threshold default 128 with the N vs R*K rationale, reason field and the unconditional logger.info in the error table and diagnostics section, HostPromptTrace semantics corrected.
FINAL GATES on 2495899: npm test 97/97, compile clean, format:check clean, lint 2 pre-existing errors only.
BRANCH READY FOR HANDOFF. Open for the human: (1) manual Extension Development Host verification, never run in this session — the three-array wiring in provider/index.ts has no automated guard; (2) after shipping, watch cache_read_input_tokens in metadata logs to confirm the cached prefix actually survives turn to turn.

2026-09-17: spec+plan committed (854a735); feat/skill-index-trimming fast-forwarded into local main (9e55655..854a735); npm test 97/97 on main; worktree removed, branch deleted; main NOT pushed (14 commits ahead of origin/main, was already 1 ahead before the merge). Ledger stays untracked by user choice.
