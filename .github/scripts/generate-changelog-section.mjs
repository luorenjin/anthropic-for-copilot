// Prepends a `## [<version>] - <date>` section to CHANGELOG.md, built from the commit
// subjects since the previous release tag. Used by the automated release in ci.yml,
// which bumps the version itself and therefore has no hand-written changelog entry.
//
// Usage: node .github/scripts/generate-changelog-section.mjs <version> [changelog-path]
//
// Idempotent: a version that already has a section is left untouched.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [, , version, changelogPath = 'CHANGELOG.md'] = process.argv;

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
	console.error(`Expected a plain x.y.z version, got ${JSON.stringify(version ?? '')}.`);
	process.exit(1);
}

function git(...args) {
	try {
		return execFileSync('git', args, { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}

function previousReleaseTag() {
	// `--match` keeps unrelated tags out; a repository without any release tag falls
	// back to the full history, which is correct for a first release.
	return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD');
}

const GROUPS = ['Added', 'Fixed', 'Changed', 'Internal'];
const groupOf = (type) => {
	switch (type) {
		case 'feat':
			return 'Added';
		case 'fix':
			return 'Fixed';
		case 'perf':
		case 'refactor':
		case 'revert':
		case 'style':
		case 'docs':
		case 'improvement':
			return 'Changed';
		default:
			return 'Internal';
	}
};

const previousTag = previousReleaseTag();
const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';
const subjects = git('log', range, '--no-merges', '--pretty=format:%s')
	.split('\n')
	.map((line) => line.trim())
	.filter((line) => line.length > 0 && !line.startsWith('chore(release):'));

const grouped = new Map(GROUPS.map((name) => [name, []]));
for (const subject of subjects) {
	const conventional = /^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(subject);
	const type = conventional ? conventional[1] : '';
	const text = (conventional ? conventional[2] : subject).trim();
	grouped.get(groupOf(type)).push(text);
}

const today = new Date().toISOString().slice(0, 10);
const lines = [`## [${version}] - ${today}`, ''];
if (subjects.length === 0) {
	lines.push(`_No commits listed since ${previousTag || 'the first commit'}._`, '');
} else {
	for (const name of GROUPS) {
		const items = grouped.get(name);
		if (items.length === 0) {
			continue;
		}
		lines.push(`### ${name}`, ...items.map((item) => `- ${item}`), '');
	}
}
const section = lines.join('\n').trimEnd();

const changelog = fs.readFileSync(changelogPath, 'utf8');
if (changelog.includes(`## [${version}]`)) {
	console.log(`${changelogPath} already has a section for ${version}; nothing to do.`);
	process.exit(0);
}

const fileLines = changelog.split(/\r?\n/);
const unreleasedIndex = fileLines.findIndex((line) => /^##\s+\[Unreleased\]/.test(line));
let insertAt;
if (unreleasedIndex >= 0) {
	insertAt = unreleasedIndex + 1;
} else {
	const firstSection = fileLines.findIndex((line) => line.startsWith('## '));
	insertAt = firstSection >= 0 ? firstSection : fileLines.findIndex((line) => line.startsWith('# ')) + 1;
}
if (insertAt <= 0) {
	insertAt = 0;
}

const next = [
	...fileLines.slice(0, insertAt),
	'',
	section,
	'',
	...fileLines.slice(insertAt).filter((line, index) => !(index === 0 && line === '')),
];

fs.writeFileSync(changelogPath, next.join('\n'));
console.log(
	`Inserted ${subjects.length} commit subject(s) into ${changelogPath} as ${version}` +
		(previousTag ? ` (since ${previousTag}).` : ' (full history).'),
);
