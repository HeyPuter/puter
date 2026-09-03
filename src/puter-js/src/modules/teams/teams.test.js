import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every method reaches the backend through the shared helper, so mocking it
// exercises the real module against a scripted `/teams` without a server.
const mockReq = vi.fn();
vi.mock('./lib/req.js', async (importOriginal) => ({
    ...await importOriginal(),
    req: (...args) => mockReq(...args),
}));

const { TeamsModule } = await import('./index.js');

const TEAM_ROW = {
    uid: 't-1',
    name: 'Acme',
    handle: 'acme',
    is_owner: true,
    created_at: '2026-01-01T00:00:00Z',
};

const TEAM = {
    uid: 't-1',
    name: 'Acme',
    handle: 'acme',
    isOwner: true,
    createdAt: '2026-01-01T00:00:00Z',
};

const member = username => ({ username, org_owned: true, created_at: '2026-01-02T00:00:00Z' });

let teams;

/** Replies per route, so a test says what the backend holds, not call order. */
const routes = (table) => {
    mockReq.mockImplementation(async (_puter, method, route, opts = {}) => {
        const key = `${method} ${route}`;
        const handler = table[key];
        if ( ! handler ) throw new Error(`unexpected request: ${key}`);
        return typeof handler === 'function' ? handler(opts) : handler;
    });
};

/** The route and options of the nth request the module made. */
const call = (n = 0) => {
    const [, method, route, opts] = mockReq.mock.calls[n];
    return { method, route, ...opts };
};

beforeEach(() => {
    mockReq.mockReset();
    teams = new TeamsModule({ APIOrigin: 'https://api.test' });
});

describe('teams', () => {
    it('creates a team and returns it in camelCase', async () => {
        routes({ 'POST /teams': TEAM_ROW });
        await expect(teams.create({ name: 'Acme', handle: 'acme' })).resolves.toEqual(TEAM);
        expect(call().body).toEqual({ name: 'Acme', handle: 'acme' });
    });

    it('omits `handle` from the body when it was not given', async () => {
        routes({ 'POST /teams': TEAM_ROW });
        await teams.create({ name: 'Acme' });
        expect(call().body).toEqual({ name: 'Acme' });
    });

    it('refuses a blank name without making a request', async () => {
        await expect(teams.create({ name: '  ' })).rejects.toMatchObject({ code: 'invalid_request' });
        expect(mockReq).not.toHaveBeenCalled();
    });

    it('gets, updates and deletes by uid', async () => {
        routes({
            'GET /teams/t-1': TEAM_ROW,
            'PUT /teams/t-1': { ...TEAM_ROW, name: 'Acme Inc' },
            'DELETE /teams/t-1': { success: true },
        });
        await expect(teams.get('t-1')).resolves.toEqual(TEAM);
        await expect(teams.update('t-1', { name: 'Acme Inc' })).resolves.toEqual({ ...TEAM, name: 'Acme Inc' });
        await expect(teams.delete('t-1')).resolves.toBeUndefined();
        expect(call(1).body).toEqual({ name: 'Acme Inc' });
    });

    it('sends `handle: null` on update, which releases the handle', async () => {
        routes({ 'PUT /teams/t-1': { ...TEAM_ROW, handle: null } });
        await expect(teams.update('t-1', { handle: null })).resolves.toMatchObject({ handle: null });
        expect(call().body).toEqual({ handle: null });
    });

    it('encodes a uid into the path', async () => {
        routes({ 'GET /teams/t%2F1': TEAM_ROW });
        await expect(teams.get('t/1')).resolves.toEqual(TEAM);
    });

    it('refuses a blank uid without making a request', async () => {
        await expect(teams.get('')).rejects.toMatchObject({ code: 'invalid_request' });
        expect(mockReq).not.toHaveBeenCalled();
    });
});

describe('list forms', () => {
    const page1 = { items: [member('ann'), member('bob')], cursor: 'c-2' };
    const page2 = { items: [member('cat')] };

    const paged = () => routes({
        'GET /teams/t-1/members': ({ query }) => (query.cursor === 'c-2' ? page2 : page1),
    });

    it('returns a plain array with no options, following the cursor itself', async () => {
        paged();
        const result = await teams.listMembers('t-1');
        expect(Array.isArray(result)).toBe(true);
        expect(result.map(m => m.username)).toEqual(['ann', 'bob', 'cat']);
        expect(mockReq).toHaveBeenCalledTimes(2);
    });

    it('returns the page envelope when a cursor is passed', async () => {
        paged();
        const result = await teams.listMembers('t-1', { cursor: null });
        expect(result).toEqual({
            cursor: 'c-2',
            items: [
                { username: 'ann', orgOwned: true, createdAt: '2026-01-02T00:00:00Z' },
                { username: 'bob', orgOwned: true, createdAt: '2026-01-02T00:00:00Z' },
            ],
        });
        expect(mockReq).toHaveBeenCalledTimes(1);
    });

    it('resumes from a cursor', async () => {
        paged();
        const result = await teams.listMembers('t-1', { cursor: 'c-2' });
        expect(result.items.map(m => m.username)).toEqual(['cat']);
        expect(result.cursor).toBeUndefined();
    });

    it('streams page envelopes under `stream: true`', async () => {
        paged();
        const seen = [];
        for await ( const page of teams.listMembers('t-1', { stream: true }) ) {
            seen.push(page.items.map(m => m.username));
        }
        expect(seen).toEqual([['ann', 'bob'], ['cat']]);
    });

    it('caps at one page and still returns an array when only `limit` is given', async () => {
        paged();
        const result = await teams.listMembers('t-1', { limit: 2 });
        expect(result.map(m => m.username)).toEqual(['ann', 'bob']);
        expect(mockReq).toHaveBeenCalledTimes(1);
        expect(call().query.limit).toBe(2);
    });

    it('refuses `offset`, which these keyset routes would ignore', () => {
        expect(() => teams.listMembers('t-1', { offset: 10 })).toThrow(/offset/);
        expect(mockReq).not.toHaveBeenCalled();
    });

    it('lists teams from `/teams`', async () => {
        routes({ 'GET /teams': { items: [TEAM_ROW] } });
        await expect(teams.list()).resolves.toEqual([TEAM]);
    });

    it('maps audit entries and reads the caller-only route separately', async () => {
        const row = {
            action: 'disable_member',
            reason: null,
            username: 'bob',
            actor_username: 'ann',
            created_at: '2026-01-03T00:00:00Z',
        };
        routes({
            'GET /teams/t-1/audit': { items: [row] },
            'GET /teams/t-1/audit/me': { items: [] },
        });
        await expect(teams.listAudit('t-1')).resolves.toEqual([{
            action: 'disable_member',
            reason: null,
            username: 'bob',
            actorUsername: 'ann',
            createdAt: '2026-01-03T00:00:00Z',
        }]);
        await expect(teams.listOwnAudit('t-1')).resolves.toEqual([]);
    });
});

describe('members', () => {
    it('provisions an account and surfaces the one-time credential', async () => {
        routes({ 'POST /teams/t-1/members': { username: 'bob', temporary_password: 'hunter2' } });
        await expect(teams.createMember('t-1', { username: 'bob', email: 'bob@example.com' }))
            .resolves.toEqual({ username: 'bob', temporaryPassword: 'hunter2' });
        expect(call().body).toEqual({ username: 'bob', email: 'bob@example.com' });
    });

    it('refuses a member without an email without making a request', async () => {
        await expect(teams.createMember('t-1', { username: 'bob' }))
            .rejects.toMatchObject({ code: 'invalid_request' });
        expect(mockReq).not.toHaveBeenCalled();
    });

    it('reissues an activation credential', async () => {
        routes({ 'POST /teams/t-1/members/bob/activation': { temporary_password: 'hunter3' } });
        await expect(teams.resendActivation('t-1', 'bob'))
            .resolves.toEqual({ username: 'bob', temporaryPassword: 'hunter3' });
    });

    it('passes an activated account\'s refusal through untouched', async () => {
        routes({
            'POST /teams/t-1/members/bob/activation': () => {
                throw Object.assign(new Error('That account is already activated'), { code: 'conflict' });
            },
        });
        await expect(teams.resendActivation('t-1', 'bob')).rejects.toMatchObject({ code: 'conflict' });
    });

    it('disables and enables an account', async () => {
        routes({
            'POST /teams/t-1/members/bob/disable': { success: true },
            'POST /teams/t-1/members/bob/enable': { success: true },
        });
        await expect(teams.disableMember('t-1', 'bob')).resolves.toBeUndefined();
        await expect(teams.enableMember('t-1', 'bob')).resolves.toBeUndefined();
    });

    it('refuses a blank username without making a request', async () => {
        await expect(teams.disableMember('t-1', '')).rejects.toMatchObject({ code: 'invalid_request' });
        expect(mockReq).not.toHaveBeenCalled();
    });

    it('returns the reset credential once, and only that', async () => {
        routes({ 'POST /teams/t-1/members/bob/password-reset': { temporary_password: 'tmp-abc123' } });
        await expect(teams.resetPassword('t-1', 'bob')).resolves.toEqual({
            username: 'bob',
            temporaryPassword: 'tmp-abc123',
        });
    });

    it('deletes a member, and surfaces the disable-first refusal', async () => {
        routes({ 'DELETE /teams/t-1/members/bob': { success: true } });
        await expect(teams.deleteMemberAccount('t-1', 'bob')).resolves.toBeUndefined();

        routes({
            'DELETE /teams/t-1/members/bob': () => {
                throw Object.assign(new Error('Disable the account before deleting it'), { code: 'account_must_be_disabled_first' });
            },
        });
        await expect(teams.deleteMemberAccount('t-1', 'bob')).rejects.toMatchObject({ code: 'account_must_be_disabled_first' });
    });
});

describe('binding', () => {
    it('keeps `this` when a method is destructured off the module', async () => {
        routes({ 'GET /teams': { items: [TEAM_ROW] }, 'POST /teams': TEAM_ROW });
        const { create, list } = teams;
        await expect(create({ name: 'Acme' })).resolves.toEqual(TEAM);
        await expect(list()).resolves.toEqual([TEAM]);
    });
});
