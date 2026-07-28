import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every XHR the module opens lands here so tests can settle them by hand.
const { pending } = vi.hoisted(() => ({ pending: [] }));

vi.mock('../../lib/utils.js', () => ({
    initXhr: (path, origin, token, method) => ({
        path,
        origin,
        token,
        method,
        send () {
            pending.push(this);
        },
    }),
    setupXhrEventHandlers: (xhr, success, error, resolve, reject) => {
        xhr.settle = resolve;
        xhr.fail = reject;
    },
}));

const { user } = await import('./user.js');

const ctx = () => ({
    puter: { APIOrigin: 'https://api.test', authToken: 'tok-1' },
});

beforeEach(() => {
    pending.length = 0;
});

describe('os.user /whoami dedup', () => {
    it('coalesces concurrent callers onto a single request', async () => {
        const first = user.call(ctx(), {});
        const second = user.call(ctx(), {});

        expect(pending).toHaveLength(1);

        pending[0].settle({ username: 'alice' });

        await expect(first).resolves.toEqual({ username: 'alice' });
        await expect(second).resolves.toEqual({ username: 'alice' });
    });

    // The shared promise carries no per-caller callbacks, so `user` has to
    // invoke each caller's own — otherwise a coalesced caller silently never
    // hears back.
    it('still fires every coalesced caller\'s success callback', async () => {
        const firstSuccess = vi.fn();
        const secondSuccess = vi.fn();

        const first = user.call(ctx(), { success: firstSuccess });
        const second = user.call(ctx(), { success: secondSuccess });

        expect(pending).toHaveLength(1);
        pending[0].settle({ username: 'alice' });
        await Promise.all([first, second]);

        expect(firstSuccess).toHaveBeenCalledWith({ username: 'alice' });
        expect(secondSuccess).toHaveBeenCalledWith({ username: 'alice' });
    });

    it('rejects every coalesced caller and fires their error callbacks', async () => {
        const firstError = vi.fn();
        const secondError = vi.fn();
        const boom = new Error('unauthorized');

        const first = user.call(ctx(), { error: firstError });
        const second = user.call(ctx(), { error: secondError });

        expect(pending).toHaveLength(1);
        pending[0].fail(boom);

        await expect(first).rejects.toBe(boom);
        await expect(second).rejects.toBe(boom);
        expect(firstError).toHaveBeenCalledWith(boom);
        expect(secondError).toHaveBeenCalledWith(boom);
    });

    // This is in-flight coalescing, not a cache. Once a read settles the next
    // caller must hit the network again, or the GUI would render a user whose
    // state changed underneath it.
    it('issues a fresh request once the previous one has settled', async () => {
        const first = user.call(ctx(), {});
        pending[0].settle({ username: 'alice' });
        await first;

        const second = user.call(ctx(), {});
        expect(pending).toHaveLength(2);

        pending[1].settle({ username: 'alice' });
        await second;
    });

    it('does not share a result across different query shapes', async () => {
        const plain = user.call(ctx(), {});
        const sized = user.call(ctx(), { query: { icon_size: '64' } });

        expect(pending).toHaveLength(2);
        expect(pending[0].path).toBe('/whoami');
        expect(pending[1].path).toBe('/whoami?icon_size=64');

        pending[0].settle({ username: 'alice' });
        pending[1].settle({ username: 'alice', icon: 'x' });
        await Promise.all([plain, sized]);
    });

    it('does not share a result across different auth tokens', async () => {
        const asFirstUser = user.call(ctx(), {});
        const asSecondUser = user.call(
            { puter: { APIOrigin: 'https://api.test', authToken: 'tok-2' } },
            {},
        );

        expect(pending).toHaveLength(2);

        pending[0].settle({ username: 'alice' });
        pending[1].settle({ username: 'bob' });

        await expect(asFirstUser).resolves.toEqual({ username: 'alice' });
        await expect(asSecondUser).resolves.toEqual({ username: 'bob' });
    });
});
