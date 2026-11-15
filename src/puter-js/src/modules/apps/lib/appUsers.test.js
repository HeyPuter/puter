import { describe, expect, it } from 'vitest';
import { addUserIteration, addUserIterationToApps } from './appUsers.js';

/** An SDK whose app-telemetry driver serves `users`, recording each call. */
const sdkWithUsers = (users) => {
    const calls = [];
    return {
        calls,
        drivers: {
            call: async (iface, driver, method, args) => {
                calls.push([iface, driver, method, args]);
                const offset = args.offset ?? 0;
                return { result: users?.slice(offset, offset + (args.limit ?? users.length)) };
            },
        },
    };
};

const USERS = ['alice', 'bob', 'carol', 'dave', 'erin'].map(username => ({ username }));

const collect = async (iterator) => {
    const seen = [];
    for await ( const user of iterator ) seen.push(user.username);
    return seen;
};

describe('app.getUsers', () => {
    it('asks the telemetry driver for one page of the app\'s users', async () => {
        const sdk = sdkWithUsers(USERS);
        const app = addUserIteration(sdk, { uid: 'app-123' });
        expect(await app.getUsers({ limit: 2, offset: 1 })).toEqual([{ username: 'bob' }, { username: 'carol' }]);
        expect(sdk.calls).toEqual([
            ['app-telemetry', 'app-telemetry', 'get_users', { app_uuid: 'app-123', limit: 2, offset: 1 }],
        ]);
    });

    it('leaves the page size to the server when given no parameters', async () => {
        const sdk = sdkWithUsers(USERS);
        const app = addUserIteration(sdk, { uid: 'app-123' });
        expect(await app.getUsers()).toEqual(USERS);
        expect(sdk.calls[0][3]).toEqual({ app_uuid: 'app-123', limit: undefined, offset: undefined });
    });
});

describe('app.users', () => {
    it('walks every user a page at a time, stopping at a short page', async () => {
        const sdk = sdkWithUsers(USERS);
        const app = addUserIteration(sdk, { uid: 'app-123' });
        expect(await collect(app.users(2))).toEqual(['alice', 'bob', 'carol', 'dave', 'erin']);
        expect(sdk.calls.map(([, , , args]) => [args.limit, args.offset])).toEqual([[2, 0], [2, 2], [2, 4]]);
    });

    it('asks once more when the last page was full, and stops on the empty one', async () => {
        const sdk = sdkWithUsers(USERS.slice(0, 4));
        const app = addUserIteration(sdk, { uid: 'app-123' });
        expect(await collect(app.users(2))).toEqual(['alice', 'bob', 'carol', 'dave']);
        expect(sdk.calls.map(([, , , args]) => args.offset)).toEqual([0, 2, 4]);
    });

    it('fetches a hundred users per page by default', async () => {
        const sdk = sdkWithUsers(USERS);
        const app = addUserIteration(sdk, { uid: 'app-123' });
        expect(await collect(app.users())).toHaveLength(5);
        expect(sdk.calls.map(([, , , args]) => args.limit)).toEqual([100]);
    });

    it('yields nothing for an app without users, or when the driver returns none', async () => {
        expect(await collect(addUserIteration(sdkWithUsers([]), { uid: 'app-123' }).users())).toEqual([]);
        expect(await collect(addUserIteration(sdkWithUsers(undefined), { uid: 'app-123' }).users())).toEqual([]);
    });
});

describe('addUserIterationToApps', () => {
    it('gives every app in a list its own user lookups', async () => {
        const sdk = sdkWithUsers(USERS);
        const apps = [{ uid: 'app-1' }, { uid: 'app-2' }];
        expect(addUserIterationToApps(sdk, apps)).toBe(apps);
        await apps[1].getUsers({ limit: 1 });
        expect(sdk.calls[0][3].app_uuid).toBe('app-2');
        expect(typeof apps[0].users).toBe('function');
    });
});
