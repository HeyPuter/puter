import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from './translations/en.js';

const guiSrc = join(dirname(fileURLToPath(import.meta.url)), '..');

const sourceFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if ( entry.isDirectory() ) return sourceFiles(path);
    return path.endsWith('.js') && !path.endsWith('.test.js') ? [path] : [];
});

describe('i18n keys', () => {
    // A key missing from en.js renders as the raw key, in every locale.
    it('every literal i18n() key in the GUI exists in en.js', () => {
        const missing = [];
        for ( const file of sourceFiles(guiSrc) ) {
            for ( const [, key] of readFileSync(file, 'utf8').matchAll(/\bi18n\(\s*['"]([\w.-]+)['"]/g) ) {
                if ( ! Object.hasOwn(en.dictionary, key) ) missing.push(`${relative(guiSrc, file)}: ${key}`);
            }
        }
        expect(missing).toEqual([]);
    });
});
