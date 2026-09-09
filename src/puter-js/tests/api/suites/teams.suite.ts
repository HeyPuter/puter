import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

/**
 * Handles and usernames are unique across the whole deployment, and the suites
 * share one server, so every fixture carries a random tag.
 */
const tag = () => Math.random().toString(36).slice(2, 8);

type Team = { uid: string; name: string | null; handle: string | null; isOwner: boolean };

const makeTeam = async (t: TestContext, label: string): Promise<Team> =>
    (await t.puter.teams.create({ name: `Teams Suite ${label}`, handle: `ts-${label}-${tag()}` })) as Team;

export default suite('teams', {
    'create returns the team with the caller as owner': async (t) => {
        const team = await makeTeam(t, 'create');
        t.assert.ok(typeof team.uid === 'string' && team.uid.length > 0, 'uid should be set');
        t.assert.equal(team.name, 'Teams Suite create');
        t.assert.equal(team.isOwner, true);
    },

    'create without a handle leaves it null': async (t) => {
        const team = (await t.puter.teams.create({ name: `Teams Suite nohandle ${tag()}` })) as Team;
        t.assert.equal(team.handle, null);
    },

    'create with a blank name rejects before reaching the server': async (t) => {
        await t.assert.rejects(
            () => t.puter.teams.create({ name: '   ' }),
            'a blank name should reject',
        );
    },

    'get returns a team the caller belongs to': async (t) => {
        const team = await makeTeam(t, 'get');
        const fetched = (await t.puter.teams.get(team.uid)) as Team;
        t.assert.equal(fetched.uid, team.uid);
        t.assert.equal(fetched.handle, team.handle);
    },

    'get on an unknown uid rejects': async (t) => {
        await t.assert.rejects(
            () => t.puter.teams.get(`t-missing-${tag()}`),
            'an unknown team should reject',
        );
    },

    'list returns an array by default and the envelope with a cursor': async (t) => {
        const team = await makeTeam(t, 'list');

        const all = (await t.puter.teams.list()) as Team[];
        t.assert.ok(Array.isArray(all), 'list with no options should return an array');
        t.assert.ok(all.some((x) => x.uid === team.uid), 'created team should appear in list');

        const page = (await t.puter.teams.list({ cursor: null })) as { items: Team[] };
        t.assert.ok(Array.isArray(page.items), 'list with a cursor should return the page envelope');
        t.assert.ok(page.items.some((x) => x.uid === team.uid), 'envelope should carry the team');
    },

    'list streams page envelopes': async (t) => {
        const team = await makeTeam(t, 'stream');
        const seen: string[] = [];
        for await (const page of t.puter.teams.list({ stream: true }) as AsyncIterableIterator<{ items: Team[] }>) {
            for (const x of page.items) seen.push(x.uid);
        }
        t.assert.ok(seen.includes(team.uid), 'streamed pages should carry the team');
    },

    'update renames a team and releases its handle': async (t) => {
        const team = await makeTeam(t, 'update');
        const renamed = (await t.puter.teams.update(team.uid, { name: 'Teams Suite renamed' })) as Team;
        t.assert.equal(renamed.name, 'Teams Suite renamed');
        t.assert.equal(renamed.handle, team.handle);

        const released = (await t.puter.teams.update(team.uid, { handle: null })) as Team;
        t.assert.equal(released.handle, null);
    },

    'delete removes the team from list': async (t) => {
        const team = await makeTeam(t, 'delete');
        await t.puter.teams.delete(team.uid);
        const all = (await t.puter.teams.list()) as Team[];
        t.assert.ok(!all.some((x) => x.uid === team.uid), 'deleted team should be gone from list');
    },

    'listMembers includes the owner account': async (t) => {
        const team = await makeTeam(t, 'members');
        const members = (await t.puter.teams.listMembers(team.uid)) as Array<{ username: string }>;
        t.assert.ok(Array.isArray(members), 'listMembers with no options should return an array');
        t.assert.ok(
            members.some((m) => m.username === t.env.users.user.username),
            'the owner should be a member of their own team',
        );
    },

    'listMembers rejects offset, which the keyset route would ignore': async (t) => {
        const team = await makeTeam(t, 'offset');
        await t.assert.rejects(
            async () => t.puter.teams.listMembers(team.uid, { offset: 1 } as never),
            'offset should be refused',
        );
    },

    'createMember provisions an account that then appears as a member': async (t) => {
        const team = await makeTeam(t, 'provision');
        const username = `tsm${tag()}`;
        const created = (await t.puter.teams.createMember(team.uid, {
            username,
            email: `${username}@example.com`,
        })) as { username: string; temporaryPassword: string };

        t.assert.equal(created.username, username);
        t.assert.ok(
            typeof created.temporaryPassword === 'string' && created.temporaryPassword.length > 0,
            'a one-time credential should come back',
        );

        const members = (await t.puter.teams.listMembers(team.uid)) as Array<{ username: string; orgOwned: boolean }>;
        const member = members.find((m) => m.username === username);
        t.assert.ok(!!member, 'the provisioned account should be a member');
        t.assert.equal(member!.orgOwned, true);
    },

    'createMember with a taken username rejects': async (t) => {
        const team = await makeTeam(t, 'taken');
        await t.assert.rejects(
            () =>
                t.puter.teams.createMember(team.uid, {
                    username: t.env.users.other.username,
                    email: `taken-${tag()}@example.com`,
                }),
            'a username already in use should reject',
        );
    },

    'resendActivation issues a different credential before first sign-in': async (t) => {
        const team = await makeTeam(t, 'reissue');
        const username = `tsr${tag()}`;
        const first = (await t.puter.teams.createMember(team.uid, {
            username,
            email: `${username}@example.com`,
        })) as { temporaryPassword: string };

        const again = (await t.puter.teams.resendActivation(team.uid, username)) as {
            username: string;
            temporaryPassword: string;
        };
        t.assert.equal(again.username, username);
        t.assert.ok(again.temporaryPassword !== first.temporaryPassword, 'the credential should be replaced');
    },

    'disable then enable a provisioned account': async (t) => {
        const team = await makeTeam(t, 'disable');
        const username = `tsd${tag()}`;
        await t.puter.teams.createMember(team.uid, { username, email: `${username}@example.com` });

        await t.puter.teams.disableMember(team.uid, username);
        await t.puter.teams.enableMember(team.uid, username);
    },

    'deleting a member is refused until it is disabled': async (t) => {
        const team = await makeTeam(t, 'harddelete');
        const username = `tsx${tag()}`;
        await t.puter.teams.createMember(team.uid, { username, email: `${username}@example.com` });

        await t.assert.rejects(
            () => t.puter.teams.deleteMemberAccount(team.uid, username),
            'a live account should not be deletable',
        );

        await t.puter.teams.disableMember(team.uid, username);
        await t.puter.teams.deleteMemberAccount(team.uid, username);

        const members = (await t.puter.teams.listMembers(team.uid)) as Array<{ username: string }>;
        t.assert.ok(
            !members.some((m) => m.username === username),
            'the deleted account should be gone from the member list',
        );
    },

    'disabling an account that is not a member rejects': async (t) => {
        const team = await makeTeam(t, 'notamember');
        await t.assert.rejects(
            () => t.puter.teams.disableMember(team.uid, t.env.users.other.username),
            'an account outside the team should reject',
        );
    },

    'the audit log records what the team did': async (t) => {
        const team = await makeTeam(t, 'audit');
        const username = `tsa${tag()}`;
        await t.puter.teams.createMember(team.uid, { username, email: `${username}@example.com` });
        await t.puter.teams.disableMember(team.uid, username);

        const entries = (await t.puter.teams.listAudit(team.uid)) as Array<{
            action: string;
            username: string | null;
            actorUsername: string | null;
        }>;
        t.assert.ok(Array.isArray(entries), 'listAudit with no options should return an array');
        const disabled = entries.find((e) => e.action === 'disable' && e.username === username);
        t.assert.ok(!!disabled, 'disabling should be recorded');
        t.assert.equal(disabled!.actorUsername, t.env.users.user.username);
    },

    'listOwnAudit is scoped to the caller': async (t) => {
        const team = await makeTeam(t, 'ownaudit');
        const username = `tso${tag()}`;
        await t.puter.teams.createMember(team.uid, { username, email: `${username}@example.com` });

        const mine = (await t.puter.teams.listOwnAudit(team.uid)) as Array<{ username: string | null }>;
        t.assert.ok(
            mine.every((e) => e.username !== username),
            "another account's entries should not be in the caller's own audit",
        );
    },

    'another user cannot read a team they do not belong to': async (t) => {
        const team = await makeTeam(t, 'isolation');
        const resp = await fetch(`${t.env.apiOrigin}/teams/${team.uid}`, {
            headers: { Authorization: `Bearer ${t.env.users.other.token}` },
        });
        t.assert.ok(resp.status >= 400, `a non-member read should be refused, got ${resp.status}`);
    },
});
