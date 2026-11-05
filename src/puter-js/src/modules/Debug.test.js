import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Debug } from './Debug.js';

let handler;
let parent;

beforeEach(() => {
    parent = {};
    vi.stubGlobal('location', { href: 'https://app.test/?enabled_logs=net' });
    vi.stubGlobal('parent', parent);
    vi.stubGlobal('addEventListener', (type, fn) => {
        if (type === 'message') handler = fn;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const makeDebug = () => {
    const on = vi.fn();
    new Debug({ logger: { on } });
    return on;
};

/** Runs the listener the way the browser does: nothing awaits it. */
const dispatch = (event) => Promise.resolve().then(() => handler(event));

describe('Debug', () => {
    it('turns on the categories named in the URL', () => {
        expect(makeDebug()).toHaveBeenCalledWith('net');
    });

    it.each([null, undefined, 'text'])(
        'ignores a parent message carrying %s',
        async (data) => {
            const on = makeDebug();
            await expect(
                dispatch({ source: parent, data }),
            ).resolves.toBeUndefined();
            expect(on).toHaveBeenCalledTimes(1);
        },
    );

    it('turns a category on when the parent asks', async () => {
        const on = makeDebug();
        await dispatch({
            source: parent,
            data: { $: 'puterjs-debug', cmd: 'log.on', category: 'fs' },
        });
        expect(on).toHaveBeenCalledWith('fs');
    });
});
