import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * A popup's opener can be navigated to another origin while a picker is open,
 * so messages to it go to the origin attested at boot, not to '*'.
 */
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// Sent before the opener's origin is known, or to report that it is unusable.
const unattestedMessages = ['requestOrigin', 'permissionGranted', 'pushEnabled'];

const openerPosts = (src) => {
    const posts = [];
    for (const match of src.matchAll(/window\.opener\??\.postMessage\(/g)) {
        let depth = 1;
        let i = match.index + match[0].length;
        while (depth > 0 && i < src.length) {
            if (src[i] === '(') depth++;
            else if (src[i] === ')') depth--;
            i++;
        }
        posts.push(src.slice(match.index, i));
    }
    return posts;
};

describe('messages to a popup opener', () => {
    for (const file of ['./initgui.js', './UI/UIWindow.js', './helpers/openItem.js']) {
        it(`target the attested opener origin in ${file}`, () => {
            const posts = openerPosts(read(file));
            expect(posts.length).toBeGreaterThan(0);
            for (const post of posts) {
                if (!/'\*'\s*,?\s*\)$/.test(post)) continue;
                const msg = post.match(/msg:\s*'([^']+)'/)?.[1];
                expect(unattestedMessages, post).toContain(msg);
            }
        });
    }
});
