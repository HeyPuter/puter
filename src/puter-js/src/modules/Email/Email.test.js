import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The email methods have to act for the instance they hang off, not for
 * `globalThis.puter`: in a worker, `user.puter` and `me.puter` are different
 * identities, and the one making the call is the one billed and rate-limited.
 */

const captured = vi.hoisted(() => ({ specs: [], fetches: [] }));

vi.mock('../../lib/utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    makeDriverMethod: (spec) => {
        captured.specs.push(spec);
        return async () => ({});
    },
}));

vi.mock('../../lib/networkUtils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    fetchUrl: async (url, opts) => {
        captured.fetches.push({ url, opts });
        return { ok: true, status: 200, json: async () => ({ delivered: [] }) };
    },
}));

const { EmailModule } = await import('./Email.js');

const origPuter = globalThis.puter;

const makePuter = (username, authToken) => ({
    APIOrigin: 'https://api.example.test',
    authToken,
    getUser: vi.fn(async () => ({ username })),
    fs: { read: vi.fn() },
});

beforeEach(() => {
    captured.specs.length = 0;
    captured.fetches.length = 0;
    globalThis.puter = makePuter('global', 'global-token');
});

afterEach(() => {
    globalThis.puter = origPuter;
});

describe('EmailModule binds to its own instance', () => {
    it('hands sendTransactional its own puter, not the global one', () => {
        const own = makePuter('caller', 'caller-token');
        new EmailModule(own);
        const spec = captured.specs.find(s => s.method === 'sendTransactional');
        expect(spec.puter).toBe(own);
    });

    it('sends from, and authenticates as, a non-global instance', async () => {
        const own = makePuter('caller', 'caller-token');
        const email = new EmailModule(own);
        await email.send({ to: 'bob@example.com', subject: 'hi', text: 'hi' });

        expect(own.getUser).toHaveBeenCalled();
        expect(globalThis.puter.getUser).not.toHaveBeenCalled();
        const [{ url, opts }] = captured.fetches;
        expect(url).toBe('https://api.example.test/email/send');
        expect(opts.includePuterAuth).toBe(false);
        expect(opts.authToken).toBe('caller-token');
        expect(await opts.body.text()).toContain('From: caller@puter.email\r\n');
    });

    it('keeps the live-token path for the global instance', async () => {
        const email = new EmailModule(globalThis.puter);
        await email.send({ to: 'bob@example.com', subject: 'hi', text: 'hi' });
        const [{ opts }] = captured.fetches;
        expect(opts.includePuterAuth).toBe(true);
        expect(opts.authToken).toBeUndefined();
    });
});
