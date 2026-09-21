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

import type { Actor } from '../../core/actor.js';

/**
 * Per-caller identifier passed to an upstream provider so it can bucket abuse
 * signals by account instead of by our whole tenancy. `<userId>[:<appUid>]`, on
 * the app the caller acts as — a token an app issued belongs to that app's
 * bucket, not to the account's.
 *
 * Empty string when there is no user to name, which is what every provider
 * treats as "unattributed".
 */
export const upstreamUserIdentifier = (
    actor: Actor | undefined | null,
): string => {
    const userId = actor?.user?.id;
    if (userId === undefined || userId === null) return '';
    const appUid = actor?.effectiveApp?.uid;
    return appUid ? `${userId}:${appUid}` : `${userId}`;
};
