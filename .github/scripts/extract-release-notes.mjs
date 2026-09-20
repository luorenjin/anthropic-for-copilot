// Extracts the "## [<version>]" section of CHANGELOG.md into a release-notes file.
//
// Usage: node .github/scripts/extract-release-notes.mjs <version> <output-path>
// Writes an empty file when the version has no CHANGELOG section, so the release
// step can fall back to GitHub's auto-generated notes.

import fs from 'node:fs';

const [, , version, outputPath = 'dist/RELEASE_NOTES.md'] = process.argv;

if (!version) {
	console.error('Usage: node .github/scripts/extract-release-notes.mjs <version> [output-path]');
	process.exit(1);
}

const lines = fs.readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));

let body = '';
if (start >= 0) {
	let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
	if (end < 0) {
		end = lines.length;
	}
	body = lines.slice(start + 1, end).join('\n').trim();
}

// The file is fed to `body_path` alongside `generate_release_notes: true`, and an
// empty body there is not useful, so fall back to a pointer at the changelog.
if (!body) {
	body = `_No \`CHANGELOG.md\` entry for \`${version}\`; see the auto-generated notes below._`;
}

fs.writeFileSync(outputPath, `${body}\n`);
console.log(
	start >= 0
		? `Extracted CHANGELOG.md section for ${version} into ${outputPath}.`
		: `No CHANGELOG.md section for ${version}; wrote a fallback note into ${outputPath}.`,
);
