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

import { HttpError } from '../core/http/HttpError.js';
import type { FSEntryStore } from '../stores/fs/FSEntryStore.js';
import type { UserStore } from '../stores/user/UserStore.js';
import { isUniqueViolation } from './dbError.js';
import { generate_identifier } from './identifier.js';
import { isReservedUsername } from './reservedUsernames.js';

export const USERNAME_REGEX = /^\w{1,}$/;
export const USERNAME_MAX_LENGTH = 45;
const GENERATE_ATTEMPTS = 20;

interface UsernameStores {
    user: Pick<UserStore, 'getByUsername'>;
    fsEntry: Pick<FSEntryStore, 'findHomePathConflict'>;
}

export type UsernameRejection = 'format' | 'length' | 'reserved';

/** Which account-name rule `username` breaks, or null when it breaks none. */
export const usernameRejection = (
    username: string,
): UsernameRejection | null => {
    if (!USERNAME_REGEX.test(username)) return 'format';
    if (username.length > USERNAME_MAX_LENGTH) return 'length';
    if (isReservedUsername(username)) return 'reserved';
    return null;
};

/** Throws the 400 signup answers for a name that breaks a rule. */
export const assertValidUsername = (username: string): void => {
    const rejection = usernameRejection(username);
    if (rejection === 'format') {
        throw new HttpError(
            400,
            'Username can only contain letters, numbers and underscore (_).',
            { legacyCode: 'bad_request' },
        );
    }
    if (rejection === 'length') {
        throw new HttpError(
            400,
            `Username cannot be longer than ${USERNAME_MAX_LENGTH} characters.`,
            { legacyCode: 'bad_request' },
        );
    }
    if (rejection === 'reserved') {
        throw new HttpError(400, 'This username is not available.', {
            legacyCode: 'username_already_in_use',
        });
    }
};

/**
 * What already holds `username`: another account, or rows at or under its home
 * path (which would give a new account a second root there). `ownId` is the
 * account claiming it, excluded from both checks.
 */
export const usernameConflict = async (
    stores: UsernameStores,
    username: string,
    ownId?: number,
): Promise<'account' | 'home' | null> => {
    const holder = await stores.user.getByUsername(username);
    if (holder && holder.id !== ownId) return 'account';
    const homeTaken = await stores.fsEntry.findHomePathConflict(
        username,
        ownId,
        { includeDescendants: true },
    );
    return homeTaken ? 'home' : null;
};

/** A random free username, or null after a bounded number of misses. */
export const generateUsername = async (
    stores: UsernameStores,
): Promise<string | null> => {
    for (let i = 0; i < GENERATE_ATTEMPTS; i++) {
        const candidate = generate_identifier();
        if (!(await usernameConflict(stores, candidate))) return candidate;
    }
    return null;
};

/**
 * Whether a failed write to user `ownId` (none for an insert) lost `username`
 * to another account. The primary is read because the winner may not have
 * replicated yet.
 */
export const isUsernameTaken = async (
    userStore: Pick<UserStore, 'getByUsername'>,
    err: unknown,
    username: string,
    ownId?: number,
): Promise<boolean> => {
    if (!isUniqueViolation(err)) return false;
    const holder = await userStore.getByUsername(username, { force: true });
    return Boolean(holder && holder.id !== ownId);
};
