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

import type { Readable } from 'node:stream';
import type { FSService } from '../fs/FSService.js';
import { resolveHomeRegion } from '../fs/homeRegion.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import type { UserRow, UserStore } from '../../stores/user/UserStore.js';
import * as uuid from 'uuid';

/**
 * The user mailbox, shared by everything that fills one: external ingress,
 * user-to-user sends and transactional sends.
 *
 * `<username>@<puter domain>` names an account, and that account's mail lives
 * under `/<username>/.mail` as `message/rfc822` objects - one folder per UTC
 * day, each object named `<uuidv7>--<base64url(subject)>` so a listing can sort
 * by time and show the subject without opening anything. The SDK's mailbox
 * reader is written against this layout, so it is defined once here.
 */

export const PUTER_EMAIL_DOMAINS = [
    'puter.email',
    'puterstaging.email',
] as const;

export const MAIL_CONTENT_TYPE = 'message/rfc822';

/** Ceiling on one stored message, inbound or outbound. */
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

export type MailFolder = 'objects' | 'sent' | 'outbox';

const SUBJECT_NAME_CHARS = 80;

export const isPuterEmailAddress = (address: string): boolean =>
    (PUTER_EMAIL_DOMAINS as readonly string[]).includes(
        address.split('@')[1]?.toLowerCase() ?? '',
    );

/** The username a Puter address names. The domain is not checked here. */
export const puterEmailUsername = (address: string): string =>
    address.split('@')[0];

/** Every address that resolves to `username`. */
export const puterEmailAddressesOf = (username: string): string[] =>
    PUTER_EMAIL_DOMAINS.map((domain) => `${username}@${domain}`);

/**
 * A temp account has neither a password nor an email - the same test
 * `userProtected` and AuthController use. Read it off a stored user row, never
 * off `actor.user`: the actor's copy has `password` stripped, so the check
 * there would pass every account.
 */
export const isTempUser = (user: { password?: unknown; email?: unknown }) =>
    !user.password && !user.email;

export const mailboxPath = (username: string): string => `/${username}/.mail`;

export const mailFolderPath = (
    username: string,
    folder: MailFolder,
    day: string,
): string => `${mailboxPath(username)}/${folder}/${day}`;

/** `YYYY-MM-DD` in UTC: the day folder a message is filed under. */
export const mailDay = (date: Date = new Date()): string =>
    date.toISOString().slice(0, 10);

/** Object name for one message; only the start of the subject survives. */
export const mailObjectName = (subject: unknown): string => {
    const text = typeof subject === 'string' ? subject : '';
    const encoded = Buffer.from(
        text.slice(0, SUBJECT_NAME_CHARS),
        'utf8',
    ).toString('base64url');
    return `${uuid.v7()}--${encoded}`;
};

/**
 * The account behind a Puter address, or null when nothing can receive there:
 * no such user, or a temp account (unverified and free to mint, so it has no
 * mailbox in either direction). Callers report both as one thing, so mailing an
 * address never tells one user which accounts are temp.
 */
export async function findMailboxOwner(
    users: Pick<UserStore, 'getByUsername'>,
    address: string,
): Promise<UserRow | null> {
    const user = await users.getByUsername(puterEmailUsername(address));
    return user && !isTempUser(user) ? user : null;
}

/** Whether the account has set its mailbox up: `~/.mail` exists. */
export async function hasMailbox(
    fsEntries: Pick<FSEntryStore, 'getEntryByPath'>,
    owner: Pick<UserRow, 'username'>,
): Promise<boolean> {
    const entry = await fsEntries.getEntryByPath(mailboxPath(owner.username));
    return entry?.isDir === true;
}

export interface InboxMessage {
    /** Header subject, for the object name. */
    subject?: unknown;
    content: Buffer | Readable;
    /** Exact byte count; storage needs it before the first byte. */
    size: number;
    /** Defaults to today. */
    day?: string;
    /** Defaults to a fresh name from `subject`. */
    name?: string;
}

/**
 * File one message in the owner's inbox. Written into the owner's home region
 * rather than wherever the request landed, so the mailbox reads locally.
 */
export async function storeInboxMessage(
    fs: Pick<FSService, 'write'>,
    owner: UserRow,
    message: InboxMessage,
): Promise<FSEntry> {
    const day = message.day ?? mailDay();
    const name = message.name ?? mailObjectName(message.subject);
    const { fsEntry } = await fs.write(
        owner.id,
        {
            fileMetadata: {
                path: `${mailFolderPath(owner.username, 'objects', day)}/${name}`,
                size: message.size,
                contentType: MAIL_CONTENT_TYPE,
                createMissingParents: true,
                overwrite: false,
                dedupeName: false,
            },
            fileContent: message.content,
        },
        undefined,
        undefined,
        resolveHomeRegion(owner),
    );
    return fsEntry;
}

/**
 * File an already-stored message in the owner's inbox by copying it, so the
 * bytes are never read back. `copy` has no `createMissingParents`, so the day
 * folder is made first; `mkdir` is idempotent.
 */
export async function copyIntoInbox(
    fs: Pick<FSService, 'mkdir' | 'copy'>,
    owner: UserRow,
    message: { source: FSEntry; name: string; day?: string },
): Promise<FSEntry> {
    const parent = await fs.mkdir(owner.id, {
        path: mailFolderPath(
            owner.username,
            'objects',
            message.day ?? mailDay(),
        ),
        createMissingParents: true,
    });
    return await fs.copy(owner.id, {
        source: message.source,
        destinationParent: parent,
        newName: message.name,
    });
}
