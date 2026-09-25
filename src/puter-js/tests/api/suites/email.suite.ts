import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

type Folder = 'inbox' | 'sent';
const DIRS: Record<Folder, string> = { inbox: 'objects', sent: 'sent' };

const home = (t: TestContext) => `/${t.env.users.user.username}`;

/**
 * A v7 uuid minted at `ms`, the way the mail writers name objects: the first
 * 48 bits are the timestamp, and `tail` keeps ids in one test distinct.
 */
const uuidAt = (ms: number, tail: string) => {
    const hex = ms.toString(16).padStart(12, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-${tail.padStart(12, '0')}`;
};

const toB64Url = (str: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(str)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

const rfc822 = (fields: { from: string; to: string; subject: string; text: string; date?: string }) =>
    [
        `From: ${fields.from}`,
        `To: ${fields.to}`,
        `Subject: ${fields.subject}`,
        ...(fields.date ? [`Date: ${fields.date}`] : []),
        'Message-ID: <suite@example.com>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        fields.text,
    ].join('\r\n');

/**
 * Files one message the way ingress does: under the folder's day directory,
 * named `{uuidv7}--{base64url(subject)}`. `day` defaults to the uuid's own
 * day. The inbox is shared by every test in the suite, so each test mints
 * ids in its own year to stay out of the others' way.
 */
const seed = async (
    t: TestContext,
    folder: Folder,
    ms: number,
    tail: string,
    subject: string,
    raw: string,
    day = new Date(ms).toISOString().slice(0, 10),
) => {
    const id = uuidAt(ms, tail);
    const path = `${home(t)}/.mail/${DIRS[folder]}/${day}/${id}--${toB64Url(subject.slice(0, 80))}`;
    await t.puter.fs.write(path, raw, { createMissingParents: true });
    return { id, path };
};

const idsOf = (items: Array<{ id: string }>) => items.map((m) => m.id);

/** Every message in `folder`, newest first, across every page. */
const listAll = async (t: TestContext, folder: Folder, limit: number) => {
    const all: Array<{ id: string; subject: string; date: string; size: number; folder: string; path: string }> = [];
    for await (const page of t.puter.email.list({ folder, limit, stream: true })) {
        all.push(...page.items);
    }
    return all;
};

export default suite('email', {
    'list returns messages newest first with the subject read off the name': async (t) => {
        const base = Date.UTC(2020, 0, 10, 12);
        const day1 = Date.UTC(2020, 0, 11, 9);
        const a = await seed(t, 'inbox', base, 'a1', 'First 🎉', rfc822({ from: 'x@example.com', to: 'y@puter.email', subject: 'First 🎉', text: 'a' }));
        const b = await seed(t, 'inbox', base + 60_000, 'a2', 'Second', rfc822({ from: 'x@example.com', to: 'y@puter.email', subject: 'Second', text: 'b' }));
        const c = await seed(t, 'inbox', day1, 'a3', 'Third', rfc822({ from: 'x@example.com', to: 'y@puter.email', subject: 'Third', text: 'c' }));

        const all = await listAll(t, 'inbox', 1000);
        const ours = all.filter((m) => [a.id, b.id, c.id].includes(m.id));
        t.assert.deepEqual(idsOf(ours), [c.id, b.id, a.id]);
        t.assert.deepEqual(ours.map((m) => m.subject), ['Third', 'Second', 'First 🎉']);
        t.assert.equal(ours[0].folder, 'inbox');
        t.assert.equal(ours[0].path, c.path);
        t.assert.equal(ours[0].date, new Date(day1).toISOString());
        t.assert.ok(ours[0].size > 0, 'size comes from the listing');
    },

    'list pages with a cursor across day folders in the sent folder': async (t) => {
        const days = [Date.UTC(2018, 5, 1, 8), Date.UTC(2018, 5, 2, 8), Date.UTC(2018, 5, 3, 8)];
        const seeded: string[] = [];
        for (const [i, day] of days.entries()) {
            for (const j of [0, 1]) {
                const { id } = await seed(t, 'sent', day + j * 1000, `b${i}${j}`, `Sent ${i}${j}`, rfc822({ from: 'me@puter.email', to: 'x@example.com', subject: `Sent ${i}${j}`, text: 's' }));
                seeded.push(id);
            }
        }
        seeded.sort().reverse();

        const paged: string[] = [];
        let cursor: string | null | undefined = null;
        let pages = 0;
        do {
            const page = await t.puter.email.list({ folder: 'sent', limit: 4, cursor });
            t.assert.ok(page.items.length <= 4, 'a page never exceeds its limit');
            paged.push(...idsOf(page.items));
            cursor = page.cursor;
            pages += 1;
        } while (cursor);
        t.assert.ok(pages >= 2, 'six messages at four a page takes more than one page');

        const ours = paged.filter((id) => seeded.includes(id));
        t.assert.deepEqual(ours, seeded);
        t.assert.deepEqual(paged, idsOf(await listAll(t, 'sent', 2)));
    },

    'list rejects offset and a foreign cursor': async (t) => {
        const err = (await t.assert.rejects(async () => t.puter.email.list({ offset: 1 } as never))) as { code?: string };
        t.assert.equal(err.code, 'invalid_request');
        const bad = (await t.assert.rejects(async () => t.puter.email.list({ cursor: 'junk' }))) as { code?: string };
        t.assert.equal(bad.code, 'invalid_request');
    },

    'get parses the message, attachments included': async (t) => {
        const boundary = 'suite-boundary';
        const raw = [
            'From: Ada Lovelace <ada@example.com>',
            'To: Bob <bob@puter.email>',
            'Cc: carol@example.com',
            'Subject: A subject that runs well past the eighty characters the object name is allowed to keep',
            'Date: Sun, 05 Mar 2017 10:00:00 +0000',
            'Message-ID: <get@example.com>',
            'MIME-Version: 1.0',
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset=utf-8',
            '',
            'hello body',
            `--${boundary}`,
            'Content-Type: text/plain; name="note.txt"',
            'Content-Disposition: attachment; filename="note.txt"',
            'Content-Transfer-Encoding: base64',
            '',
            btoa('attached!'),
            `--${boundary}--`,
            '',
        ].join('\r\n');
        const { id, path } = await seed(t, 'inbox', Date.UTC(2017, 2, 5, 10), 'c1', 'A subject that runs well past the eighty characters the object name is allowed to keep', raw);

        const msg = await t.puter.email.get(id);
        t.assert.equal(msg.id, id);
        t.assert.equal(msg.path, path);
        t.assert.equal(msg.subject, 'A subject that runs well past the eighty characters the object name is allowed to keep');
        t.assert.deepEqual(msg.from, { name: 'Ada Lovelace', address: 'ada@example.com' });
        t.assert.deepEqual(msg.to, [{ name: 'Bob', address: 'bob@puter.email' }]);
        t.assert.deepEqual(msg.cc, [{ name: '', address: 'carol@example.com' }]);
        t.assert.equal(msg.messageId, '<get@example.com>');
        t.assert.equal(msg.date, '2017-03-05T10:00:00.000Z');
        t.assert.equal((msg.text ?? '').trim(), 'hello body');
        t.assert.equal(msg.attachments.length, 1);
        t.assert.equal(msg.attachments[0].filename, 'note.txt');
        t.assert.equal(msg.attachments[0].size, 'attached!'.length);
        t.assert.equal(new TextDecoder().decode(msg.attachments[0].content), 'attached!');
    },

    'get with raw returns the bytes that were filed': async (t) => {
        const raw = rfc822({ from: 'x@example.com', to: 'y@puter.email', subject: 'Raw', text: 'raw body' });
        const { id } = await seed(t, 'inbox', Date.UTC(2016, 7, 1, 10), 'd1', 'Raw', raw);
        const blob = await t.puter.email.get({ id, raw: true });
        t.assert.equal(await blob.text(), raw);
    },

    'get finds a message filed under the day before its id says': async (t) => {
        // Filed a moment before midnight, minted a moment after.
        const ms = Date.UTC(2015, 3, 2, 0, 0, 0, 5);
        const raw = rfc822({ from: 'x@example.com', to: 'y@puter.email', subject: 'Straddle', text: 'late' });
        const { id } = await seed(t, 'inbox', ms, 'e1', 'Straddle', raw, '2015-04-01');
        const msg = await t.puter.email.get(id);
        t.assert.equal(msg.subject, 'Straddle');
        t.assert.ok(msg.path.includes('/2015-04-01/'), 'resolved to the folder it was actually filed in');
    },

    'get reads the sent folder when asked': async (t) => {
        const raw = rfc822({ from: 'me@puter.email', to: 'x@example.com', subject: 'Sent copy', text: 'sent' });
        const { id } = await seed(t, 'sent', Date.UTC(2014, 0, 1, 10), 'f1', 'Sent copy', raw);
        const msg = await t.puter.email.get({ id, folder: 'sent' });
        t.assert.equal(msg.folder, 'sent');
        t.assert.equal(msg.subject, 'Sent copy');
        const missing = (await t.assert.rejects(async () => t.puter.email.get(id))) as { code?: string };
        t.assert.equal(missing.code, 'not_found');
    },

    'get of an unknown or malformed id rejects': async (t) => {
        const unknown = (await t.assert.rejects(async () => t.puter.email.get(uuidAt(Date.UTC(2013, 0, 1), 'ff')))) as { code?: string };
        t.assert.equal(unknown.code, 'not_found');
        const malformed = (await t.assert.rejects(async () => t.puter.email.get('not-an-id'))) as { code?: string };
        t.assert.equal(malformed.code, 'invalid_request');
    },
});
