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

/** Usernames no account may choose, compared lowercase. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
    'admin',
    'administrator',
    'root',
    'system',
    'puter',
    'www',
    'api',
    'support',
    'help',
    'info',
    'contact',
    'mail',
    'email',
    // Role mailboxes (RFC 2142): a username is also its mailbox's local part.
    'abuse',
    'postmaster',
    'hostmaster',
    'webmaster',
    'security',
    'noc',
    // Inbound mail to these is feedback or bounces, never a person's.
    'fbl',
    'noreply',
    'no-reply',
    'null',
    'undefined',
    'test',
    'guest',
    'anonymous',
    'user',
    'users',
]);

const registered = new Set<string>();

/**
 * Reserve names at runtime, e.g. any name a privilege check matches on, so the
 * name can't be claimed once its current holder renames or is deleted.
 */
export const reserveUsernames = (names: Iterable<string>): void => {
    for (const name of names) registered.add(name.toLowerCase());
};

export const isReservedUsername = (username: string): boolean => {
    const lower = username.toLowerCase();
    return RESERVED_USERNAMES.has(lower) || registered.has(lower);
};
