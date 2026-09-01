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

/**
 * The mail a share actually sends.
 *
 * `ShareNotificationService.test.ts` covers who gets told and how often, with
 * the notification layer stubbed. This covers what the message says: the spy
 * sits on `sendRaw`, so every template renders for real and a variable the
 * service doesn't pass shows up as a gap in the text rather than passing
 * silently.
 *
 * An invited address is driven from its own mail — the confirmation code is read
 * out of the message that was sent to it — so the invite becoming a real share
 * rests on the same path a person would follow.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

const BOOT_TIMEOUT_MS = 120_000;
const SETTLE_MS = 300;

/** Window for the tests that need several calls to land inside one. */
const DIGEST_WINDOW_SECONDS = 3;

/** One send, as the transport would have received it. */
interface SentEmail {
    to: string;
    subject: string;
    html: string;
    /** The plain-text alternative, which carries its own links. */
    text: string;
}

const uniqueSuffix = (): string =>
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** An address nobody has an account for. */
const uninvitedAddress = (): string => `invited-${uniqueSuffix()}@puter.local`;

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `body` with the digest window widened, for the tests whose point is that
 * several calls land in one window.
 *
 * The suite's default window is short enough that the run doesn't wait on it,
 * which is fine for a test making one call — but a test making four sequential
 * round trips inside it is racing the timer, and on a loaded runner the last
 * one lands after the window closed and arrives as a second email. Widening it
 * for those cases costs the run that much wall clock and nothing else: the
 * behaviour under test is what the digest *contains*, not how long it waits.
 */
const withDigestWindow = async <T>(
    env: PuterTestEnv,
    seconds: number,
    body: () => Promise<T>,
): Promise<T> => {
    // Read off the service, which holds the same config object the server was
    // built with — `#limits()` re-reads it per call, so this takes effect
    // without a reboot. Same shape as `OIDCService.test.ts`.
    const limits = (
        env.server.services.shareNotification.config as {
            share_notify_limits: { emailBatchSeconds?: number };
        }
    ).share_notify_limits;
    const previous = limits.emailBatchSeconds;
    limits.emailBatchSeconds = seconds;
    try {
        return await body();
    } finally {
        limits.emailBatchSeconds = previous;
    }
};

describe('share email', () => {
    let env: PuterTestEnv;
    let sent: SentEmail[];

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            // A transport has to exist for the service to try sending at all;
            // nothing reaches it, because `sendRaw` is spied below.
            email: {
                from: '"Puter (test)" <no-reply@puter.localhost>',
                host: '127.0.0.1',
                port: 1,
            },
            // Not set: share email is on by default, which this suite proves.
            // Near-immediate digests; the batching itself is tested with two
            // senders below, not by waiting a real minute.
            share_notify_limits: { emailBatchSeconds: 0.05 },
        } as never);
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await env?.shutdown();
    });

    beforeEach(() => {
        sent = [];
        vi.spyOn(env.server.clients.email, 'sendRaw').mockImplementation(
            async (options: {
                to: string;
                subject: string;
                html?: string;
                text?: string;
            }) => {
                sent.push({
                    to: options.to,
                    subject: options.subject,
                    html: options.html ?? '',
                    text: options.text ?? '',
                });
                return null;
            },
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Where the "Open Puter" button points, as distinct from the item links. */
    const openPuterHref = (html: string): string | undefined =>
        html.match(/href="([^"]+)"[^>]*>Open Puter<\/a>/)?.[1];

    const post = (path: string, token: string, body: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    const get = (path: string, token: string, params: Record<string, string> = {}) => {
        const url = new URL(path, env.apiOrigin);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        return fetch(url, { headers: { authorization: `Bearer ${token}` } });
    };

    /** A file in the owner's home, written directly — this suite is about the
     *  mail a share sends, not the upload path. */
    const makeFile = async (owner: { username: string }, label: string) => {
        const uid = crypto.randomUUID();
        const name = `${label}-${uid.slice(0, 8)}.txt`;
        const user = await env.server.stores.user.getByUsername(owner.username);
        await env.server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, 0, ?)',
            [
                uid,
                name,
                `/${owner.username}/${name}`,
                user!.id,
                Math.floor(Date.now() / 1000),
            ],
        );
        return { uid, name };
    };

    const shareWith = (
        sender: { token: string },
        recipient: string,
        items: Array<{ uid: string }>,
    ) =>
        post('/share', sender.token, {
            recipients: [recipient],
            items,
            mode: 'read',
        });

    const mailTo = (address: string) => sent.filter((mail) => mail.to === address);

    /** Announcements are off the response path, so they land just after it. */
    const waitForMail = async (
        match: { to: string; subject?: string },
        timeoutMs = 10_000,
    ) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const [mail] = mailTo(match.to).filter(
                (candidate) =>
                    !match.subject || candidate.subject.includes(match.subject),
            );
            if (mail) return mail;
            if (Date.now() >= deadline) {
                const held = sent.length
                    ? sent.map((m) => `[${m.to}] ${m.subject}`).join('\n  ')
                    : '(none)';
                throw new Error(
                    `no email matching ${JSON.stringify(match)} within ${timeoutMs}ms. Sent:\n  ${held}`,
                );
            }
            await sleep(10);
        }
    };

    /** Poll until `check` holds — for state a fire-and-forget event settles. */
    const eventually = async (
        what: string,
        check: () => Promise<boolean>,
        timeoutMs = 15_000,
    ) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (await check()) return;
            if (Date.now() >= deadline) {
                throw new Error(`timed out waiting: ${what}`);
            }
            await sleep(50);
        }
    };

    const sharedWithMe = async (token: string) => {
        const res = await get('/share/shared-with-me', token);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            items: Array<Record<string, unknown>>;
        };
        return body.items;
    };

    /**
     * A confirmed account for `email`, made the way a real recipient would: sign
     * up, then confirm with the code that was mailed to them.
     */
    const signUpAndConfirm = async (email: string) => {
        const username = `se${uniqueSuffix()}`;
        const signup = await fetch(new URL('/signup', env.origin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                username,
                email,
                password: 'puter-share-email-1234',
            }),
        });
        expect(signup.status, await signup.clone().text()).toBe(200);
        const { token } = (await signup.json()) as { token: string };

        const codeMail = await waitForMail({
            to: email,
            subject: 'confirmation code',
        });
        const code = /(\d{6})/.exec(codeMail.subject)?.[1];
        expect(code, `no code in "${codeMail.subject}"`).toBeDefined();

        const confirmed = await post('/confirm-email', token, { code });
        expect(await confirmed.json()).toMatchObject({ email_confirmed: true });

        return { username, email, token };
    };

    it('emails an invite to an address with no account', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner, 'invite');
        const invitee = uninvitedAddress();

        const res = await shareWith(owner, invitee, [{ uid: file.uid }]);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
            results: [{ status: 'pending', recipient: invitee }],
        });

        const mail = await waitForMail({ to: invitee });
        expect(mail.subject).toBe(
            `${owner.username} shared ${file.name} with you on Puter`,
        );
        expect(mail.html).toContain(file.name);
        // The address is in the body because it is the one to sign up with: an
        // account on any other address will not find the share.
        expect(mail.html).toContain(invitee);
        expect(mail.html).toContain('Create your free account');
        // The full origin, port included — a rebuilt protocol://domain link
        // is dead on any self-host that doesn't run on the default port.
        expect(mail.html).toContain(`href="${env.origin}"`);

        // Nobody else hears about it — least of all the sender.
        await sleep(SETTLE_MS);
        expect(sent).toHaveLength(1);
    });

    it('hands an invited address its share once the address is confirmed', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner, 'claimed');
        const invitee = uninvitedAddress();

        await shareWith(owner, invitee, [{ uid: file.uid }]);
        await waitForMail({ to: invitee });

        // Whoever manages the item can see who was asked, before any account
        // exists to hold it.
        const listed = await get('/share/shares', owner.token, { uid: file.uid });
        expect(await listed.json()).toMatchObject({
            items: [{ pending: true, recipient_email: invitee, holder: null }],
        });

        const recipient = await signUpAndConfirm(invitee);

        await eventually('the invite to become a real share', async () =>
            (await sharedWithMe(recipient.token)).some(
                (item) => item.uid_entry === file.uid,
            ),
        );

        const [share] = (await sharedWithMe(recipient.token)).filter(
            (item) => item.uid_entry === file.uid,
        );
        expect(share).toMatchObject({
            mode: 'read',
            issuer: owner.username,
            holder: recipient.username,
        });

        // The claim is announced in the app, not by email — the invite already
        // spent the one message they agreed to receive.
        await sleep(SETTLE_MS);
        expect(
            mailTo(invitee).filter((mail) => mail.html.includes('Open Puter')),
        ).toHaveLength(0);
    });

    it('emails an account holder once per window, however often they are shared with', async () => {
        const owner = env.users.user;
        const recipient = await signUpAndConfirm(uninvitedAddress());
        sent = [];

        const first = await makeFile(owner, 'holder-1');
        await shareWith(owner, recipient.email, [{ uid: first.uid }]);

        const mail = await waitForMail({ to: recipient.email });
        expect(mail.subject).toBe(
            `${owner.username} shared ${first.name} with you`,
        );
        expect(mail.html).toContain(first.name);
        // The button opens Shared with the item picked out — on the full
        // origin, port included, like every other link in the mail.
        expect(openPuterHref(mail.html)).toBe(
            `${env.origin}/?shared=${encodeURIComponent(
                `/${owner.username}/${first.uid}/${first.name}`,
            )}`,
        );
        expect(mail.html).toContain(recipient.username);

        // A second share to the same pair inside the window is one more thing to
        // look at, not one more thing to be interrupted by.
        const second = await makeFile(owner, 'holder-2');
        await shareWith(owner, recipient.email, [{ uid: second.uid }]);
        await sleep(SETTLE_MS);
        expect(mailTo(recipient.email)).toHaveLength(1);

        // Suppressed the announcement, not the share.
        await eventually('both items to be listed', async () => {
            const uids = (await sharedWithMe(recipient.token)).map(
                (item) => item.uid_entry,
            );
            return uids.includes(first.uid) && uids.includes(second.uid);
        });
    });

    it('sends one email for a batch of items, counting them', async () => {
        // A different sender: the quiet window is per (sender, recipient), and
        // the case above has already spent the owner's.
        const sender = env.users.admin;
        const recipient = await signUpAndConfirm(uninvitedAddress());
        sent = [];

        const files = [];
        for (const label of ['batch-1', 'batch-2', 'batch-3']) {
            files.push(await makeFile(sender, label));
        }
        await shareWith(
            sender,
            recipient.email,
            files.map((file) => ({ uid: file.uid })),
        );

        const mail = await waitForMail({ to: recipient.email });
        expect(mail.subject).toBe(`${sender.username} shared 3 items with you`);
        expect(mail.html).toContain('shared 3 items');

        await sleep(SETTLE_MS);
        expect(mailTo(recipient.email)).toHaveLength(1);
    });


    it('holds the window and sends two senders as one digest email', async () => {
        const first = env.users.user;
        const second = env.users.admin;
        const recipient = await signUpAndConfirm(uninvitedAddress());
        sent = [];

        const fromFirst = await makeFile(first, 'digest-a');
        const fromSecond = await makeFile(second, 'digest-b');
        await withDigestWindow(env, DIGEST_WINDOW_SECONDS, async () => {
            await shareWith(first, recipient.email, [{ uid: fromFirst.uid }]);
            await shareWith(second, recipient.email, [{ uid: fromSecond.uid }]);
        });

        // Two people sharing within the window is one email that names them
        // both — not two messages ten seconds apart.
        const mail = await waitForMail({ to: recipient.email });
        await sleep(SETTLE_MS);
        expect(mailTo(recipient.email)).toHaveLength(1);
        expect(mail.subject).toBe(
            `${first.username} and ${second.username} shared 2 items with you`,
        );
        expect(mail.html).toContain(fromFirst.name);
        expect(mail.html).toContain(fromSecond.name);
    });



    it('counts every file when they are shared one call at a time', async () => {
        const owner = env.users.user;
        const recipient = await signUpAndConfirm(uninvitedAddress());
        sent = [];

        // Four separate calls, as the dialog makes them: only the first may
        // interrupt, but all four must reach the digest.
        const files = [];
        for (const label of ['one', 'two', 'three', 'four']) {
            files.push(await makeFile(owner, label));
        }
        await withDigestWindow(env, DIGEST_WINDOW_SECONDS, async () => {
            for (const file of files) {
                await shareWith(owner, recipient.email, [{ uid: file.uid }]);
            }
        });

        const mail = await waitForMail({ to: recipient.email });
        await sleep(SETTLE_MS);
        expect(mailTo(recipient.email)).toHaveLength(1);
        expect(mail.subject).toBe(
            `${owner.username} shared 4 items with you`,
        );
        expect(mail.html).toContain('4 items');
        expect(mail.html).toContain(files[0].name);
        expect(mail.html).toContain('+1 more');
    });

    it('names several files shared in one call', async () => {
        const sender = env.users.admin;
        const recipient = await signUpAndConfirm(uninvitedAddress());
        sent = [];

        const files = [];
        for (const label of ['multi-a', 'multi-b']) {
            files.push(await makeFile(sender, label));
        }
        await shareWith(
            sender,
            recipient.email,
            files.map((file) => ({ uid: file.uid })),
        );

        const mail = await waitForMail({ to: recipient.email });
        // Both names, not just whichever happened to be last.
        for (const file of files) expect(mail.html).toContain(file.name);
    });

    // The name in the mail links to the item. The path is the masked form the
    // recipient is allowed to see, never the owner's real one.
    it('links each named file to itself, by its masked path', async () => {
        const owner = env.users.user;
        const recipient = await signUpAndConfirm(uninvitedAddress());
        sent = [];

        const file = await makeFile(owner, 'deeplink');
        await shareWith(owner, recipient.email, [{ uid: file.uid }]);

        const mail = await waitForMail({ to: recipient.email });
        const masked = `/${owner.username}/${file.uid}/${file.name}`;
        const link = `?shared=${encodeURIComponent(masked)}`;
        expect(mail.html).toContain(link);
        // Linked, not merely mentioned.
        expect(mail.html).toContain(`${link}"`);
        expect(mail.text).toContain(link);
        // The owner's real path is theirs alone; only the mask travels.
        expect(mail.html).not.toContain(`/${owner.username}/deeplink`);
    });

    it('links every file when several are shared at once', async () => {
        const sender = env.users.admin;
        const recipient = await signUpAndConfirm(uninvitedAddress());
        sent = [];

        const files = [];
        for (const label of ['links-a', 'links-b']) {
            files.push(await makeFile(sender, label));
        }
        await shareWith(
            sender,
            recipient.email,
            files.map((file) => ({ uid: file.uid })),
        );

        const mail = await waitForMail({ to: recipient.email });
        const masked = files.map(
            (file) => `/${sender.username}/${file.uid}/${file.name}`,
        );
        for (const path of masked) {
            expect(mail.html).toContain(`?shared=${encodeURIComponent(path)}`);
        }
        // "Open Puter" is one link for the whole mail: Shared, with every item
        // in it picked out — not the origin, which would land them on Home.
        const href = openPuterHref(mail.html);
        expect(href).toBeDefined();
        expect(new URL(href!).searchParams.getAll('shared').sort()).toEqual(
            [...masked].sort(),
        );
        expect(mail.text).toContain(`Open Puter: ${href}`);
    });

    // Nothing to route to yet, so the names stay plain and the call to action
    // is still "create an account".
    it('does not link the files in an invite', async () => {
        const owner = env.users.user;
        const address = uninvitedAddress();
        sent = [];

        const file = await makeFile(owner, 'invite-nolink');
        await shareWith(owner, address, [{ uid: file.uid }]);

        const mail = await waitForMail({ to: address });
        expect(mail.html).toContain(file.name);
        expect(mail.html).not.toContain('?shared=');
    });

    it('honors an account-wide unsubscribe, and offers the link to those who have not', async () => {
        const owner = env.users.user;
        const recipient = await signUpAndConfirm(uninvitedAddress());
        sent = [];

        const first = await makeFile(owner, 'unsub-1');
        await shareWith(owner, recipient.email, [{ uid: first.uid }]);
        const mail = await waitForMail({ to: recipient.email });
        const row = await env.server.stores.user.getByUsername(
            recipient.username,
        );
        expect(mail.html).toContain(`/unsubscribe?user_uuid=${row!.uuid}`);

        // Only the mail stops: the share and the in-app notification stand.
        await env.server.stores.user.update(row!.id, { unsubscribed: 1 });
        await env.server.stores.user.invalidate(row!);
        sent = [];

        const second = await makeFile(owner, 'unsub-2');
        await shareWith(owner, recipient.email, [{ uid: second.uid }]);
        await sleep(SETTLE_MS);
        expect(mailTo(recipient.email)).toHaveLength(0);
        await eventually('the share to be listed anyway', async () =>
            (await sharedWithMe(recipient.token)).some(
                (item) => item.uid_entry === second.uid,
            ),
        );
    });

    it('sends nothing to a recipient who has blocked the sender', async () => {
        const owner = env.users.user;
        const recipient = await signUpAndConfirm(uninvitedAddress());
        sent = [];

        const blocked = await post('/share/blocks', recipient.token, {
            username: owner.username,
        });
        expect(blocked.status).toBe(200);

        const file = await makeFile(owner, 'blocked');
        const res = await shareWith(owner, recipient.email, [{ uid: file.uid }]);

        // Refused per pair, so the envelope carries it, not the status.
        expect(await res.json()).toMatchObject({
            status: 'aborted',
            results: [
                { status: 'error', code: 'recipient_not_accepting_shares' },
            ],
        });

        await sleep(SETTLE_MS);
        expect(sent).toHaveLength(0);
    });
});

describe('share email digest durability', () => {
    let env: PuterTestEnv;
    let sent: SentEmail[];

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            email: {
                from: '"Puter (test)" <no-reply@puter.localhost>',
                host: '127.0.0.1',
                port: 1,
            },
            share_email_notifications: true,
            // A window no test waits out: mail may only leave via the
            // shutdown drain.
            share_notify_limits: { emailBatchSeconds: 600 },
        } as never);
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await env?.shutdown();
    });

    beforeEach(() => {
        sent = [];
        vi.spyOn(env.server.clients.email, 'sendRaw').mockImplementation(
            async (options: {
                to: string;
                subject: string;
                html?: string;
                text?: string;
            }) => {
                sent.push({
                    to: options.to,
                    subject: options.subject,
                    html: options.html ?? '',
                    text: options.text ?? '',
                });
                return null;
            },
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });


    it('sweeps a digest whose timer died with the node that armed it', async () => {
        const owner = env.users.user;
        const invitee = `orphan-${crypto.randomUUID().slice(0, 8)}@puter.local`;

        // An entry with no timer anywhere — what a restart or a rolling deploy
        // leaves behind. Queued far enough in the past to be past its window
        // and the sweep's grace on top of it.
        await env.server.stores.kv.set({
            key: `share:digest:invite:${invitee}:${crypto.randomUUID()}`,
            value: {
                kind: 'invite',
                to: invitee,
                sender: owner.username,
                count: 1,
                names: ['orphan.txt'],
                queuedAt: Date.now() - 60 * 60_000,
            },
        });

        await env.server.services.shareNotification.sweepForTests();

        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe(invitee);
        expect(sent[0].html).toContain('orphan.txt');
    });

    it('leaves an entry whose window has only just closed to its own timer', async () => {
        const owner = env.users.user;
        const invitee = `fresh-${crypto.randomUUID().slice(0, 8)}@puter.local`;

        // Past its window, but only just. Claiming an entry is exclusive only
        // among flushers that can see each other's deletes, so a sweep that
        // pounced the instant a window closed could send a digest another node
        // is at that moment sending too. The grace is what keeps that from
        // being a coin flip.
        await env.server.stores.kv.set({
            key: `share:digest:invite:${invitee}:${crypto.randomUUID()}`,
            value: {
                kind: 'invite',
                to: invitee,
                sender: owner.username,
                count: 1,
                names: ['fresh.txt'],
                queuedAt: Date.now() - 11 * 60_000,
            },
        });

        await env.server.services.shareNotification.sweepForTests();

        expect(sent.filter((mail) => mail.to === invitee)).toHaveLength(0);
    });

    it('holds queued sends durably and drains them once on shutdown', async () => {
        const owner = env.users.user;
        const invitee = `drain-${crypto.randomUUID().slice(0, 8)}@puter.local`;
        const uid = crypto.randomUUID();
        const user = await env.server.stores.user.getByUsername(owner.username);
        await env.server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, 0, ?)',
            [
                uid,
                'drain.txt',
                `/${owner.username}/drain.txt`,
                user!.id,
                Math.floor(Date.now() / 1000),
            ],
        );
        const res = await fetch(new URL('/share', env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${owner.token}`,
            },
            body: JSON.stringify({
                recipients: [invitee],
                items: [{ uid }],
                mode: 'read',
            }),
        });
        expect(res.status).toBe(200);

        // Inside the window nothing has been sent, but the entry is already
        // durable — it does not depend on this process's timer surviving.
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(sent).toHaveLength(0);
        const { res: listed } = await env.server.stores.kv.list({
            as: 'keys',
            pattern: `share:digest:invite:${invitee}:`,
        });
        const keys = Array.isArray(listed)
            ? listed
            : ((listed as { items?: unknown[] })?.items ?? []);
        expect(keys).toHaveLength(1);

        // The drain sends it while the transport is still up; a second drain
        // finds the entries already claimed and sends nothing again.
        await env.server.services.shareNotification.onServerPrepareShutdown();
        await env.server.services.shareNotification.onServerPrepareShutdown();

        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe(invitee);
        expect(sent[0].html).toContain('drain.txt');
    });
});
