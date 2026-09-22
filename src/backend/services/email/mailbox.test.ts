import { Readable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import {
    MAIL_CONTENT_TYPE,
    copyIntoInbox,
    findMailboxOwner,
    hasMailbox,
    isPuterEmailAddress,
    isTempUser,
    mailDay,
    mailFolderPath,
    mailObjectName,
    mailboxPath,
    puterEmailAddressesOf,
    puterEmailUsername,
    storeInboxMessage,
} from './mailbox.js';

const UUID_V7 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const user = (over: Partial<UserRow> = {}): UserRow =>
    ({
        id: 7,
        uuid: '00000000-0000-4000-8000-000000000007',
        username: 'dan',
        email: 'dan@example.com',
        password: '$2b$10$hash',
        ...over,
    }) as UserRow;

describe('addresses', () => {
    test('both Puter domains are internal, case-insensitively', () => {
        expect(isPuterEmailAddress('dan@puter.email')).toBe(true);
        expect(isPuterEmailAddress('Dan@PuterStaging.Email')).toBe(true);
        expect(isPuterEmailAddress('dan@apps.puter.email')).toBe(false);
        expect(isPuterEmailAddress('dan@example.com')).toBe(false);
        expect(isPuterEmailAddress('not-an-address')).toBe(false);
    });

    test('the local part is the username', () => {
        expect(puterEmailUsername('dan@puter.email')).toBe('dan');
    });

    test('an account answers at every Puter domain', () => {
        expect(puterEmailAddressesOf('dan')).toEqual([
            'dan@puter.email',
            'dan@puterstaging.email',
        ]);
    });
});

describe('account eligibility', () => {
    test('temp means no password and no email; either alone is not temp', () => {
        expect(isTempUser({ password: null, email: null })).toBe(true);
        expect(isTempUser({ password: null, email: 'a@b.c' })).toBe(false);
        expect(isTempUser({ password: 'x', email: null })).toBe(false);
    });

    test('the owner of an address is its permanent account, else nothing', async () => {
        const rows = new Map<string, UserRow>([
            ['dan', user()],
            [
                'tmp',
                user({ username: 'tmp', email: null, password: undefined }),
            ],
        ]);
        const users = {
            getByUsername: async (name: string) => rows.get(name) ?? null,
        };
        expect(await findMailboxOwner(users, 'dan@puter.email')).toBe(
            rows.get('dan'),
        );
        expect(await findMailboxOwner(users, 'tmp@puter.email')).toBeNull();
        expect(await findMailboxOwner(users, 'nobody@puter.email')).toBeNull();
    });

    test('a mailbox is set up when ~/.mail is a directory', async () => {
        const dirs = new Map<string, Partial<FSEntry>>([
            ['/dan/.mail', { isDir: true }],
            ['/bob/.mail', { isDir: false }],
        ]);
        const fsEntries = {
            getEntryByPath: async (path: string) =>
                (dirs.get(path) as FSEntry) ?? null,
        };
        expect(await hasMailbox(fsEntries, { username: 'dan' })).toBe(true);
        expect(await hasMailbox(fsEntries, { username: 'bob' })).toBe(false);
        expect(await hasMailbox(fsEntries, { username: 'eve' })).toBe(false);
    });
});

describe('layout', () => {
    test('folders sit under ~/.mail by UTC day', () => {
        expect(mailboxPath('dan')).toBe('/dan/.mail');
        expect(mailFolderPath('dan', 'objects', '2026-09-15')).toBe(
            '/dan/.mail/objects/2026-09-15',
        );
        expect(mailDay(new Date('2026-09-15T23:59:59.000Z'))).toBe(
            '2026-09-15',
        );
    });

    test('an object name is a v7 uuid and the base64url subject', () => {
        const [id, encoded] = mailObjectName('Hello, wörld').split('--');
        expect(id).toMatch(UUID_V7);
        expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(
            'Hello, wörld',
        );
    });

    test('only the first 80 subject characters survive into the name', () => {
        const encoded = mailObjectName('x'.repeat(200)).split('--')[1];
        expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(
            'x'.repeat(80),
        );
    });

    test('a missing or non-string subject encodes as empty', () => {
        expect(mailObjectName(undefined)).toMatch(/--$/);
        expect(mailObjectName(['a'])).toMatch(/--$/);
    });
});

describe('storeInboxMessage', () => {
    const fakeFs = () => {
        const writes: Array<{
            userId: number;
            metadata: Record<string, unknown>;
            content: unknown;
            homeRegion?: string;
        }> = [];
        const fs = {
            write: async (
                userId: number,
                request: {
                    fileMetadata: Record<string, unknown>;
                    fileContent: unknown;
                },
                _tracker?: unknown,
                _allowance?: number,
                homeRegion?: string,
            ) => {
                writes.push({
                    userId,
                    metadata: request.fileMetadata,
                    content: request.fileContent,
                    homeRegion,
                });
                return { fsEntry: { path: request.fileMetadata.path } };
            },
        };
        return { fs: fs as never, writes };
    };

    test("files under today's inbox folder, in the owner's home region", async () => {
        const { fs, writes } = fakeFs();
        const owner = user({ home: 'frankfurt' });
        const content = Readable.from([Buffer.from('raw')]);
        const entry = await storeInboxMessage(fs, owner, {
            subject: 'hi',
            content,
            size: 3,
        });

        expect(writes).toHaveLength(1);
        const [write] = writes;
        expect(write.userId).toBe(7);
        expect(write.homeRegion).toBe('frankfurt');
        expect(write.content).toBe(content);
        expect(write.metadata).toMatchObject({
            size: 3,
            contentType: MAIL_CONTENT_TYPE,
            createMissingParents: true,
            overwrite: false,
            dedupeName: false,
        });
        const path = write.metadata.path as string;
        expect(path.startsWith(`/dan/.mail/objects/${mailDay()}/`)).toBe(true);
        expect(path.split('/').at(-1)).toMatch(
            new RegExp(`^${UUID_V7.source.slice(1, -1)}--aGk$`),
        );
        expect(entry).toEqual({ path });
    });

    test('an explicit day and name are used as given', async () => {
        const { fs, writes } = fakeFs();
        await storeInboxMessage(fs, user(), {
            content: Buffer.from('raw'),
            size: 3,
            day: '2020-01-01',
            name: 'fixed',
        });
        expect(writes[0].metadata.path).toBe(
            '/dan/.mail/objects/2020-01-01/fixed',
        );
    });
});

describe('copyIntoInbox', () => {
    test("makes the day folder, then copies under the caller's name", async () => {
        const calls: string[] = [];
        const parent = { uid: 'parent', path: '/dan/.mail/objects/2020-01-01' };
        const source = { uid: 'src', path: '/al/.mail/sent/2020-01-01/m' };
        const fs = {
            mkdir: async (userId: number, input: Record<string, unknown>) => {
                calls.push(
                    `mkdir ${userId} ${input.path} ${input.createMissingParents}`,
                );
                return parent;
            },
            copy: async (userId: number, input: Record<string, unknown>) => {
                calls.push(
                    `copy ${userId} ${(input.source as { uid: string }).uid} -> ${(input.destinationParent as { uid: string }).uid}/${input.newName}`,
                );
                return { path: `${parent.path}/${input.newName}` };
            },
        };
        const entry = await copyIntoInbox(fs as never, user(), {
            source: source as FSEntry,
            name: 'm',
            day: '2020-01-01',
        });
        expect(calls).toEqual([
            'mkdir 7 /dan/.mail/objects/2020-01-01 true',
            'copy 7 src -> parent/m',
        ]);
        expect(entry).toEqual({ path: '/dan/.mail/objects/2020-01-01/m' });
    });
});
