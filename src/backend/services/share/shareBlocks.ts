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

import { HttpError } from '../../core/http/HttpError.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type { UserBlockStore } from '../../stores/userBlock/UserBlockStore.js';

/**
 * Where "refuse shares from everyone" lives on the user row.
 *
 * A key in the existing `metadata` blob rather than a column of its own: the
 * share path already holds the recipient's row by the time it asks, so reading
 * it costs nothing either way, and a one-bit preference doesn't earn a
 * migration per dialect.
 */
export const BLOCK_ALL_SHARES_KEY = 'blockAllShares';

/** Whether this account refuses shares from everyone. */
export const blocksAllShares = (
    user: Pick<UserRow, 'metadata'> | null,
): boolean => Boolean(user?.metadata?.[BLOCK_ALL_SHARES_KEY]);

/**
 * Whether `holder` refuses shares from `issuerId`: from everyone, or from that
 * sender. The blanket switch is on the row already in hand, so only a holder
 * who cleared it costs the pair lookup.
 */
export const refusesSharesFrom = async (
    userBlock: Pick<UserBlockStore, 'isBlocked'>,
    holder: Pick<UserRow, 'id' | 'metadata'>,
    issuerId: number,
): Promise<boolean> =>
    blocksAllShares(holder) || (await userBlock.isBlocked(holder.id, issuerId));

/**
 * Refusing everyone and refusing this sender read the same: which of the two it
 * is is the recipient's business, not the sender's.
 */
export const recipientNotAcceptingShares = (): HttpError =>
    new HttpError(403, 'recipient is not accepting shares', {
        legacyCode: 'recipient_not_accepting_shares',
    });
