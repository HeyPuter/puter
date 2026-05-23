import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(scriptDir, '..');
const templatePath = path.join(workerDir, 'template', 'puter-portable.template');
const outputDir = path.join(workerDir, 'dist');
const outputPath = path.join(outputDir, 'workerPreamble.js');

// Build a version stamp: puter-js version + short git SHA
const puterJsPkg = JSON.parse(
    await readFile(path.resolve(workerDir, '../puter-js/package.json'), 'utf-8'),
);
let gitSha = 'unknown';
try {
    gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch { /* not in a git repo — keep "unknown" */ }
const preambleVersion = `${puterJsPkg.version}+${gitSha}`;

const inlineIncludes = async (filePath) => {
    const fileContents = await readFile(filePath, 'utf-8');
    const lines = fileContents.split('\n');
    const expandedLines = [];

    for (const line of lines) {
        const includeMatch = /^([ \t]*)#include "([^"]+)"$/.exec(line);
        if (!includeMatch) {
            expandedLines.push(line);
            continue;
        }

        const [, indent, relativePath] = includeMatch;
        const includedPath = path.resolve(path.dirname(filePath), relativePath);
        const includedContents = await inlineIncludes(includedPath);
        for (const includedLine of includedContents.split('\n')) {
            expandedLines.push(
                includedLine.length > 0
                    ? `${indent}${includedLine}`
                    : includedLine,
            );
        }
    }

    return expandedLines.join('\n');
};

await mkdir(outputDir, { recursive: true });
const versionBanner = `var __PUTER_PREAMBLE_VERSION__ = ${JSON.stringify(preambleVersion)};\n`;
const preambleSource = await inlineIncludes(templatePath);
await writeFile(outputPath, versionBanner + preambleSource);
