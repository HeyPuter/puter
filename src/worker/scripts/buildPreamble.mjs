import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(scriptDir, '..');
const templatePath = path.join(workerDir, 'template', 'puter-portable.template');
const outputDir = path.join(workerDir, 'dist');
const outputPath = path.join(outputDir, 'workerPreamble.js');

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
const preambleSource = await inlineIncludes(templatePath);
await writeFile(outputPath, preambleSource);
