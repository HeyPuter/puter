/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { AppFeedbackService } from './AppFeedbackService.js';

// Drives the real wired service against the real stores and in-memory
// database; only the email transport (a genuine external boundary) is
// stubbed. The controller's own tests cover request parsing and route gates —
// everything here is the business logic the controller delegates to.

// The email links the service builds are rooted at `config.origin`, which the
// default test config leaves unset.
const TEST_ORIGIN = 'https://puter.test';

let server: PuterServer;
let service: AppFeedbackService;

beforeAll(async () => {
    server = await setupTestServer({ origin: TEST_ORIGIN } as never);
    service = server.services.appFeedback;
});

afterAll(async () => {
    await server?.shutdown();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const makeUser = async (): Promise<number> => {
    const username = `fdbk-svc-${Math.random().toString(36).slice(2, 10)}`;
    const user = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
    });
    return user.id;
};

const makeApp = async (
    ownerUserId: number,
    opts: { feedbackEnabled?: boolean; name?: string; title?: string } = {},
) => {
    const name =
        opts.name ?? `fdbk-svc-app-${Math.random().toString(36).slice(2, 10)}`;
    return await server.stores.app.create(
        {
            name,
            title: opts.title ?? `Feedback Service Test ${name}`,
            index_url: `https://${name}.example.com`,
            ...(opts.feedbackEnabled ? { feedback_enabled: 1 } : {}),
        },
        { ownerUserId },
    );
};

// Feedback is only offered when the deployment can deliver it; most tests
// want that baseline without asserting anything about the mail itself.
const mockEmailConfigured = () =>
    vi.spyOn(server.clients.email, 'isConfigured', 'get').mockReturnValue(true);

const mockEmailReady = () => {
    mockEmailConfigured();
    return vi.spyOn(server.clients.email, 'send').mockResolvedValue(undefined);
};

// Columns the user store has no setter for; written directly the way the
// admin tooling does, then the cached row is dropped.
const setUserFlags = async (
    userId: number,
    flags: Partial<{
        email_confirmed: boolean;
        suspended: boolean;
        unsubscribed: boolean;
    }>,
) => {
    for (const [column, value] of Object.entries(flags)) {
        await server.clients.db.write(
            `UPDATE \`user\` SET \`${column}\` = ? WHERE \`id\` = ?`,
            [server.clients.db.booleanValue(Boolean(value)), userId],
        );
    }
    await server.stores.user.invalidateById(userId);
};

// An owner who can actually receive mail: the default for delivery tests.
const makeDeliverableOwner = async (): Promise<number> => {
    const ownerId = await makeUser();
    await setUserFlags(ownerId, { email_confirmed: true });
    return ownerId;
};

const feedbackRows = async (userId: number) =>
    (await server.clients.db.read(
        'SELECT * FROM `app_feedback` WHERE `user_id` = ? ORDER BY `id`',
        [userId],
    )) as Array<Record<string, unknown>>;

// -- Message normalization ---------------------------------------------

describe('AppFeedbackService.normalizeMessage', () => {
    it('unifies newlines, strips control chars, and trims', () => {
        expect(service.normalizeMessage('  a\r\nb\rc   ')).toBe('a\nb\nc');
        expect(service.normalizeMessage('keep\ttabs\nand\nnewlines')).toBe(
            'keep\ttabs\nand\nnewlines',
        );
        expect(service.normalizeMessage('a\u0000b\u0007c\u007F')).toBe('abc');
    });

    it('returns null for non-strings and whitespace-only input', () => {
        expect(service.normalizeMessage(42)).toBeNull();
        expect(service.normalizeMessage('   \n\t  ')).toBeNull();
        expect(service.normalizeMessage(null)).toBeNull();
        expect(service.normalizeMessage(undefined)).toBeNull();
        // Nothing but control characters normalizes away to nothing.
        expect(service.normalizeMessage('\u0000\u0007')).toBeNull();
    });
});

// -- Target resolution --------------------------------------------------

describe('AppFeedbackService.resolveTargetApp', () => {
    it('resolves by uid and by name, including names starting with "app-"', async () => {
        const ownerId = await makeUser();
        const app = await makeApp(ownerId);
        const prefixed = await makeApp(ownerId, {
            name: `app-fdbk-${Math.random().toString(36).slice(2, 10)}`,
        });

        expect(await service.resolveTargetApp({ app: app.uid })).toMatchObject({
            id: app.id,
        });
        expect(await service.resolveTargetApp({ app: app.name })).toMatchObject(
            { id: app.id },
        );
        // A "app-"-prefixed *name* must not be mistaken for a uid and lost.
        expect(
            await service.resolveTargetApp({ app: prefixed.name }),
        ).toMatchObject({ id: prefixed.id });
    });

    it('returns null when neither app nor origin is given, and for unknown apps', async () => {
        expect(await service.resolveTargetApp({})).toBeNull();
        expect(
            await service.resolveTargetApp({ app: 'no-such-app-xyz' }),
        ).toBeNull();
    });

    it('resolves an origin to the app whose index_url it matches', async () => {
        const ownerId = await makeUser();
        const app = await makeApp(ownerId);
        const origin = new URL(app.index_url).origin;
        expect(await service.resolveTargetApp({ origin })).toMatchObject({
            id: app.id,
        });
    });

    it('treats a blocked origin as unknown rather than an error', async () => {
        // To a feedback caller "blocked" and "unknown" mean the same thing:
        // nobody is accepting feedback there. Surfacing the 403 would tell
        // any page whether its origin is on the blocklist.
        const ownerId = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const origin = new URL(app.index_url).origin;
        await server.clients.db.write(
            'INSERT INTO `blocked_app_origins` (`domain`, `include_subdomains`, `reason`) VALUES (?, ?, ?)',
            [new URL(origin).host, 0, 'test'],
        );
        server.services.appOriginBlocklist.invalidate();
        try {
            expect(await service.resolveTargetApp({ origin })).toBeNull();
        } finally {
            await server.clients.db.write(
                'DELETE FROM `blocked_app_origins` WHERE `domain` = ?',
                [new URL(origin).host],
            );
            server.services.appOriginBlocklist.invalidate();
        }
    });

    it('throws 400 on an unparseable origin', async () => {
        await expect(
            service.resolveTargetApp({ origin: 'not a url' }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });
});

// -- Eligibility --------------------------------------------------------

describe('AppFeedbackService.acceptsFeedback', () => {
    const app = { feedback_enabled: 1, owner_user_id: 7 };

    it('requires opt-in, an owner, and a configured email transport', () => {
        mockEmailConfigured();
        expect(service.acceptsFeedback(app)).toBe(true);
        expect(service.acceptsFeedback(null)).toBe(false);
        expect(service.acceptsFeedback({ ...app, feedback_enabled: 0 })).toBe(
            false,
        );
        expect(service.acceptsFeedback({ ...app, owner_user_id: null })).toBe(
            false,
        );
    });

    it('is false without an email transport, even for an opted-in app', () => {
        // The self-hosted no-SMTP default. Feedback rows have no other read
        // path, so soliciting them here would store-and-lose every message
        // while telling the sender it was delivered.
        expect(server.clients.email.isConfigured).toBe(false);
        expect(service.acceptsFeedback(app)).toBe(false);
    });
});

describe('AppFeedbackService.getTarget', () => {
    it('returns the dialog fields for an opted-in app', async () => {
        mockEmailConfigured();
        const ownerId = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        expect(await service.getTarget({ app: app.uid })).toEqual({
            enabled: true,
            app: { name: app.name, title: app.title },
        });
    });

    it('reports a resolved-but-ineligible app as disabled, still naming it', async () => {
        // The dialog needs the name/title to say *which* app declined.
        mockEmailConfigured();
        const ownerId = await makeUser();
        const app = await makeApp(ownerId);
        expect(await service.getTarget({ app: app.name })).toEqual({
            enabled: false,
            app: { name: app.name, title: app.title },
        });
    });

    it('reports an unknown target as disabled with no app', async () => {
        mockEmailConfigured();
        expect(await service.getTarget({ app: 'no-such-app-xyz' })).toEqual({
            enabled: false,
            app: null,
        });
    });
});

// -- Submission ---------------------------------------------------------

describe('AppFeedbackService.submit', () => {
    it('stores the normalized message and returns the row uid', async () => {
        mockEmailConfigured();
        const ownerId = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();

        const result = await service.submit({
            userId,
            app: app.uid,
            message: '  Great\r\napp!  ',
            sourceEnv: 'app',
        });

        const rows = await feedbackRows(userId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            uid: result.uid,
            app_uid: app.uid,
            message: 'Great\napp!',
            source_env: 'app',
            source_origin: null,
        });
        expect(Number(rows[0].app_id)).toBe(app.id);
    });

    it('stores the attested origin for web submissions', async () => {
        mockEmailConfigured();
        const ownerId = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const origin = new URL(app.index_url).origin;
        const userId = await makeUser();

        await service.submit({
            userId,
            origin,
            message: 'from the web',
            sourceEnv: 'web',
            sourceOrigin: origin,
        });

        expect((await feedbackRows(userId))[0]).toMatchObject({
            source_env: 'web',
            source_origin: origin,
        });
    });

    it('throws 403 feedback_not_enabled for opted-out, unknown, and undeliverable targets', async () => {
        const ownerId = await makeUser();
        const userId = await makeUser();

        mockEmailConfigured();
        const optedOut = await makeApp(ownerId);
        await expect(
            service.submit({ userId, app: optedOut.name, message: 'hi' }),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'feedback_not_enabled',
        });
        await expect(
            service.submit({ userId, app: 'no-such-app-xyz', message: 'hi' }),
        ).rejects.toMatchObject({ statusCode: 403 });

        // Same refusal when the deployment has no email transport at all.
        vi.restoreAllMocks();
        const enabled = await makeApp(ownerId, { feedbackEnabled: true });
        await expect(
            service.submit({ userId, app: enabled.name, message: 'hi' }),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'feedback_not_enabled',
        });
        expect(await feedbackRows(userId)).toHaveLength(0);
    });

    it('throws 400 for a message that is empty or too long after normalization', async () => {
        mockEmailConfigured();
        const ownerId = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();

        for (const message of ['   ', '\u0000\u0007', '\r\n \t ']) {
            await expect(
                service.submit({ userId, app: app.name, message }),
            ).rejects.toMatchObject({
                statusCode: 400,
                legacyCode: 'bad_request',
            });
        }
        await expect(
            service.submit({
                userId,
                app: app.name,
                message: 'x'.repeat(AppFeedbackService.MESSAGE_MAX_LENGTH + 1),
            }),
        ).rejects.toMatchObject({ statusCode: 400 });

        // A message at exactly the limit is fine — the cap is inclusive.
        await expect(
            service.submit({
                userId,
                app: app.name,
                message: 'x'.repeat(AppFeedbackService.MESSAGE_MAX_LENGTH),
            }),
        ).resolves.toMatchObject({ uid: expect.any(String) });
        expect(await feedbackRows(userId)).toHaveLength(1);
    });

    it('measures length after normalization, not before', async () => {
        // Padding and \r\n line endings must not push an otherwise-legal
        // message over the limit.
        mockEmailConfigured();
        const ownerId = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();
        const body = 'a\r\n'.repeat(AppFeedbackService.MESSAGE_MAX_LENGTH / 2);

        await expect(
            service.submit({ userId, app: app.name, message: `  ${body}  ` }),
        ).resolves.toMatchObject({ uid: expect.any(String) });
    });

    it('enforces the per-user-per-app daily cap with 429', async () => {
        mockEmailConfigured();
        const ownerId = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();

        for (let i = 0; i < AppFeedbackService.PER_USER_APP_DAILY_LIMIT; i++) {
            await expect(
                service.submit({
                    userId,
                    app: app.name,
                    message: `message ${i}`,
                }),
            ).resolves.toMatchObject({ uid: expect.any(String) });
        }
        await expect(
            service.submit({ userId, app: app.name, message: 'one too many' }),
        ).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'too_many_requests',
        });
        expect(await feedbackRows(userId)).toHaveLength(
            AppFeedbackService.PER_USER_APP_DAILY_LIMIT,
        );
    });

    it('enforces the per-user daily cap across apps with 429', async () => {
        mockEmailConfigured();
        const ownerId = await makeUser();
        const target = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();
        const other = await makeApp(ownerId, { feedbackEnabled: true });

        for (let i = 0; i < AppFeedbackService.PER_USER_DAILY_LIMIT; i++) {
            await server.stores.appFeedback.create({
                appId: other.id,
                appUid: other.uid,
                userId,
                message: `seed ${i}`,
            });
        }
        // Under the per-app cap for `target`, over the all-apps cap.
        await expect(
            service.submit({
                userId,
                app: target.name,
                message: 'over the limit',
            }),
        ).rejects.toMatchObject({ statusCode: 429 });
    });

    it('counts only rows inside the 24h window toward the caps', async () => {
        mockEmailConfigured();
        const ownerId = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();
        const yesterday = Math.floor(Date.now() / 1000) - 25 * 60 * 60;

        for (let i = 0; i < AppFeedbackService.PER_USER_APP_DAILY_LIMIT; i++) {
            const row = await server.stores.appFeedback.create({
                appId: app.id,
                appUid: app.uid,
                userId,
                message: `stale ${i}`,
            });
            await server.clients.db.write(
                'UPDATE `app_feedback` SET `created_at` = ? WHERE `id` = ?',
                [yesterday, row.id],
            );
        }

        await expect(
            service.submit({ userId, app: app.name, message: 'new day' }),
        ).resolves.toMatchObject({ uid: expect.any(String) });
    });

    it('rolls the stored row back when a concurrent burst breaches the cap', async () => {
        mockEmailConfigured();
        const ownerId = await makeUser();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();
        for (let i = 0; i < AppFeedbackService.PER_USER_APP_DAILY_LIMIT; i++) {
            await server.stores.appFeedback.create({
                appId: app.id,
                appUid: app.uid,
                userId,
                message: `seed ${i}`,
            });
        }
        // Simulate the losing side of the check-then-insert race: the
        // pre-insert check reads a stale under-cap count; the post-insert
        // recount sees the truth and must undo the insert.
        vi.spyOn(
            server.stores.appFeedback,
            'countByUserAndAppSince',
        ).mockResolvedValueOnce(0);

        await expect(
            service.submit({
                userId,
                app: app.name,
                message: 'raced past the cap',
            }),
        ).rejects.toMatchObject({
            statusCode: 429,
            legacyCode: 'too_many_requests',
        });
        expect(await feedbackRows(userId)).toHaveLength(
            AppFeedbackService.PER_USER_APP_DAILY_LIMIT,
        );
    });
});

// -- Owner email delivery -----------------------------------------------

describe('AppFeedbackService owner email', () => {
    it('emails the owner and shares a verified sender address as reply-to', async () => {
        const send = mockEmailReady();
        const ownerId = await makeDeliverableOwner();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();
        // Only a verified sender email is shared and used as reply-to.
        await setUserFlags(userId, { email_confirmed: true });
        const sender = (await server.stores.user.getById(userId))!;
        const owner = (await server.stores.user.getById(ownerId))!;

        await service.submit({ userId, app: app.name, message: 'hello dev' });

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
            owner.email,
            'app-user-feedback',
            expect.objectContaining({
                owner_username: owner.username,
                sender_username: sender.username,
                sender_email: sender.email,
                app_name: app.name,
                app_title: app.title,
                message: 'hello dev',
            }),
            expect.objectContaining({ replyTo: sender.email }),
        );
        expect(Boolean((await feedbackRows(userId))[0].email_sent)).toBe(true);
    });

    it('builds app and Dev Center links from the deployment origin', async () => {
        // Both links must follow config.origin so they resolve on
        // self-hosted deployments, not just puter.com.
        const send = mockEmailReady();
        const ownerId = await makeDeliverableOwner();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();

        await service.submit({ userId, app: app.name, message: 'links' });

        const [, , values] = send.mock.calls[0];
        expect(values).toMatchObject({
            app_link: `${TEST_ORIGIN}/app/${encodeURIComponent(app.name)}`,
            dev_center_link: `${TEST_ORIGIN}/app/dev-center`,
        });
    });

    it('collapses whitespace in the app title so it cannot forge header lines', async () => {
        // app_title lands in the subject; a newline there would let a
        // developer-controlled title inject its own headers or body lines.
        const send = mockEmailReady();
        const ownerId = await makeDeliverableOwner();
        const app = await makeApp(ownerId, {
            feedbackEnabled: true,
            title: 'Evil\r\nBcc: victim@example.com\tApp',
        });
        const userId = await makeUser();

        await service.submit({ userId, app: app.name, message: 'hi' });

        const [, , values] = send.mock.calls[0];
        expect((values as Record<string, unknown>).app_title).toBe(
            'Evil Bcc: victim@example.com App',
        );
    });

    it('does not share an unverified sender email and sets no reply-to', async () => {
        const send = mockEmailReady();
        const ownerId = await makeDeliverableOwner();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        // Sender's email is left unverified — it could be anyone's, so
        // pointing the developer's reply at it is not safe.
        const userId = await makeUser();

        await service.submit({ userId, app: app.name, message: 'hello dev' });

        expect(send).toHaveBeenCalledTimes(1);
        const [, , values, options] = send.mock.calls[0];
        expect((values as Record<string, unknown>).sender_email).toBeNull();
        expect(
            (options as { replyTo?: string } | undefined)?.replyTo,
        ).toBeUndefined();
        // Delivery still happens; only the reply path is withheld.
        expect(Boolean((await feedbackRows(userId))[0].email_sent)).toBe(true);
    });

    it('stores without emailing when the owner cannot or will not receive mail', async () => {
        const cases: Array<[string, Parameters<typeof setUserFlags>[1]]> = [
            ['unconfirmed email', { email_confirmed: false }],
            ['suspended', { email_confirmed: true, suspended: true }],
            ['unsubscribed', { email_confirmed: true, unsubscribed: true }],
        ];
        for (const [label, flags] of cases) {
            const send = mockEmailReady();
            const ownerId = await makeUser();
            await setUserFlags(ownerId, flags);
            const app = await makeApp(ownerId, { feedbackEnabled: true });
            const userId = await makeUser();

            await service.submit({
                userId,
                app: app.name,
                message: `owner is ${label}`,
            });

            expect(send, label).not.toHaveBeenCalled();
            const rows = await feedbackRows(userId);
            expect(rows, label).toHaveLength(1);
            expect(Boolean(rows[0].email_sent), label).toBe(false);
            vi.restoreAllMocks();
        }
    });

    it('stores but does not email past the per-app daily email cap', async () => {
        const send = mockEmailReady();
        const ownerId = await makeDeliverableOwner();
        const app = await makeApp(ownerId, { feedbackEnabled: true });

        // Seed the cap with already-emailed rows from other users — the cap
        // bounds mail per app, not per sender.
        for (let i = 0; i < AppFeedbackService.PER_APP_DAILY_EMAIL_LIMIT; i++) {
            const row = await server.stores.appFeedback.create({
                appId: app.id,
                appUid: app.uid,
                userId: await makeUser(),
                message: `seed ${i}`,
            });
            await server.stores.appFeedback.markEmailSent(row.id);
        }

        const userId = await makeUser();
        await expect(
            service.submit({ userId, app: app.name, message: 'past the cap' }),
        ).resolves.toMatchObject({ uid: expect.any(String) });

        expect(send).not.toHaveBeenCalled();
        const rows = await feedbackRows(userId);
        expect(rows).toHaveLength(1);
        // The claimed slot was released, so the cap count stays exact.
        expect(Boolean(rows[0].email_sent)).toBe(false);
        expect(
            await server.stores.appFeedback.countEmailedByAppSince(
                app.id,
                Math.floor(Date.now() / 1000) - 24 * 60 * 60,
            ),
        ).toBe(AppFeedbackService.PER_APP_DAILY_EMAIL_LIMIT);
    });

    it('keeps the feedback and releases the email slot when the send fails', async () => {
        mockEmailConfigured();
        vi.spyOn(server.clients.email, 'send').mockRejectedValue(
            new Error('smtp down'),
        );
        const ownerId = await makeDeliverableOwner();
        const app = await makeApp(ownerId, { feedbackEnabled: true });
        const userId = await makeUser();

        await expect(
            service.submit({ userId, app: app.name, message: 'still stored' }),
        ).resolves.toMatchObject({ uid: expect.any(String) });

        const rows = await feedbackRows(userId);
        expect(rows).toHaveLength(1);
        // Slot released — a failed send must not consume the app's daily
        // email budget.
        expect(Boolean(rows[0].email_sent)).toBe(false);
    });
});
