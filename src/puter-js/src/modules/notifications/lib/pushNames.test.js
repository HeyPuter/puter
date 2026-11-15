import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as names from './pushNames.js';
import { hasPushNames } from './pushNamesBlock.js';
import * as pushStore from './pushStore.js';

const WORKERS = {
    'push-sw.js': new URL('../../../push-sw.js', import.meta.url),
    "the GUI's sw.js": new URL('../../../../../gui/src/sw.js', import.meta.url),
};

/** Every `const NAME = '...';` the source declares. */
const declared = (source) =>
    Object.fromEntries(
        [...source.matchAll(/^\s*const ([A-Z_]+) = '([^']*)';$/gm)].map(
            ([, name, value]) => [name, value],
        ),
    );

describe('the puter-push database names', () => {
    it('are the ones the page module uses', () => {
        expect(Object.keys(names).length).toBeGreaterThan(0);
        for (const [name, value] of Object.entries(names))
            expect(pushStore[name]).toBe(value);
    });

    it.each(Object.entries(WORKERS))(
        'match the page module in %s',
        (_label, url) => {
            const source = readFileSync(url, 'utf8');
            expect(declared(source)).toMatchObject(names);
            expect(hasPushNames(source)).toBe(true);
        },
    );
});
