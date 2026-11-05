import { Readable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { EVENTS_COALESCE_WINDOW_MS } from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import type { PuterServer } from '../../server.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import {
    createTestUser,
    setupTestServer,
    type TestUserCredentials,
} from '../../testUtil.js';
import type { DeliveryEnvelope } from '../events/EventsService.js';
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

// A real in-memory backend rather than stand-in services: these functions
// hand their arguments straight to the filesystem, so a fake would only prove
// which methods were called.
let server: PuterServer;
let dan: UserRow;
let danCredentials: TestUserCredentials;

// `frankfurt` is wired to the same bucket the test server already has, so a
// message filed for a Frankfurt account lands somewhere real and the region it
// was placed in can be read back off the entry.
const FRANKFURT_REGION = 'eu-central-1';

beforeAll(async () => {
    server = await setupTestServer({
        servers: {
            frankfurt: {
                bucket: 'puter-local',
                bucketRegion: FRANKFURT_REGION,
            },
        },
        events: { enabled: true },
        // Seeded accounts have no email, which plans read as a temporary
        // account that holds no persistent subscriptions.
        unlimitedMetering: true,
    } as never);
    danCredentials = await createTestUser(server, {
        username: 'dan',
        password: 'secret123!',
    });
    dan = (await server.stores.user.getByUsername('dan')) as UserRow;
});

afterAll(async () => {
    await server?.shutdown();
});

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

    test('a username with capitals yields lowercase addresses', () => {
        expect(puterEmailAddressesOf('Dan')).toEqual([
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
        // A temp account has neither password nor email, which is how one is
        // minted before signup completes.
        await server.stores.user.create({
            username: 'tmp',
            uuid: uuidv4(),
            password: null,
            email: null,
            requires_email_confirmation: false,
        });

        const owner = await findMailboxOwner(
            server.stores.user,
            'dan@puter.email',
        );
        expect(owner?.username).toBe('dan');
        expect(
            await findMailboxOwner(server.stores.user, 'tmp@puter.email'),
        ).toBeNull();
        expect(
            await findMailboxOwner(server.stores.user, 'nobody@puter.email'),
        ).toBeNull();
    });

    test('a mailbox is set up when ~/.mail is a directory', async () => {
        expect(await hasMailbox(server.stores.fsEntry, dan)).toBe(false);

        await server.services.fs.mkdir(dan.id, {
            path: mailboxPath(dan.username),
            createMissingParents: true,
        });
        expect(await hasMailbox(server.stores.fsEntry, dan)).toBe(true);
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
    test("files under today's inbox folder, in the owner's home region", async () => {
        await createTestUser(server, {
            username: 'frank',
            password: 'secret123!',
        });
        const created = (await server.stores.user.getByUsername(
            'frank',
        )) as UserRow;
        await server.stores.user.update(created.id, { home: 'frankfurt' });
        const owner = (await server.stores.user.getByUsername(
            'frank',
        )) as UserRow;

        const entry = await storeInboxMessage(server.services.fs, owner, {
            subject: 'hi',
            content: Readable.from([Buffer.from('raw')]),
            size: 3,
        });

        expect(entry.path).toBe(
            `${mailFolderPath('frank', 'objects', mailDay())}/${entry.name}`,
        );
        expect(entry.name).toMatch(
            new RegExp(`^${UUID_V7.source.slice(1, -1)}--aGk$`),
        );
        expect(entry.size).toBe(3);
        expect(JSON.parse(entry.metadata as string)).toMatchObject({
            contentType: MAIL_CONTENT_TYPE,
        });
        // The message follows the account, rather than landing wherever the
        // request happened to arrive.
        expect(entry.bucketRegion).toBe(FRANKFURT_REGION);

        const stored = await server.stores.fsEntry.getEntryByPath(entry.path);
        expect(stored?.uuid).toBe(entry.uuid);
    });

    test('an explicit day and name are used as given', async () => {
        const entry = await storeInboxMessage(server.services.fs, dan, {
            content: Buffer.from('raw'),
            size: 3,
            day: '2020-01-01',
            name: 'fixed',
        });
        expect(entry.path).toBe('/dan/.mail/objects/2020-01-01/fixed');
    });
});

describe('copyIntoInbox', () => {
    test("makes the day folder, then copies under the caller's name", async () => {
        const source = await storeInboxMessage(server.services.fs, dan, {
            content: Buffer.from('original'),
            size: 8,
            day: '2020-02-02',
            name: 'source',
        });

        const copied = await copyIntoInbox(server.services.fs, dan, {
            source,
            name: 'copied',
            day: '2020-03-03',
        });

        expect(copied.path).toBe('/dan/.mail/objects/2020-03-03/copied');
        // The day folder did not exist before the copy; `copy` cannot create
        // it, so the function has to.
        expect(
            await server.stores.fsEntry.getEntryByPath(
                '/dan/.mail/objects/2020-03-03',
            ),
        ).toBeTruthy();
        expect(copied.size).toBe(source.size);
    });
});

describe('the filesystem events filing raises', () => {
    let actor: Actor;
    let subId: string;
    const delivered: DeliveryEnvelope[] = [];

    beforeAll(async () => {
        actor = (await server.services.auth.authenticate(danCredentials.token))
            .actor!;
        ({
            sub: { subId },
        } = await server.services.events.subscribeDurable(actor, {
            subject: `fs:${mailboxPath('dan')}`,
        }));
        server.services.events.onDelivered = (envelope) =>
            delivered.push(envelope);
    });

    const deliveredAt = (path: string) =>
        vi.waitFor(
            () => {
                const found = delivered.find(
                    (envelope) =>
                        envelope.subId === subId &&
                        (envelope.event as { path?: string }).path === path,
                );
                expect(found).toBeDefined();
                return found!.event as { op: string; self: boolean };
            },
            { timeout: EVENTS_COALESCE_WINDOW_MS * 12, interval: 25 },
        );

    test("is not the owner's own change, even inside the owner's request", async () => {
        const entry = await runWithContext({ actor }, () =>
            storeInboxMessage(server.services.fs, dan, {
                subject: 'to myself',
                content: Buffer.from('raw'),
                size: 3,
            }),
        );

        expect(await deliveredAt(entry.path)).toMatchObject({
            op: 'add',
            self: false,
        });
    });

    test('nor is a message copied in', async () => {
        const source = await storeInboxMessage(server.services.fs, dan, {
            content: Buffer.from('original'),
            size: 8,
            day: '2021-01-01',
            name: `source-${uuidv4()}`,
        });

        const copied = await runWithContext({ actor }, () =>
            copyIntoInbox(server.services.fs, dan, {
                source,
                name: `copied-${uuidv4()}`,
                day: '2021-01-02',
            }),
        );

        expect((await deliveredAt(copied.path)).self).toBe(false);
    });

    test("while the owner's own write in the same request still is", async () => {
        const { fsEntry } = await runWithContext({ actor }, () =>
            server.services.fs.write(dan.id, {
                fileMetadata: {
                    path: `${mailboxPath('dan')}/note-${uuidv4()}.txt`,
                    size: 1,
                },
                fileContent: Buffer.from('x'),
            }),
        );

        expect((await deliveredAt(fsEntry.path)).self).toBe(true);
    });
});
