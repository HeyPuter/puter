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
import { isSystemActor } from '../../core/actor.js';

// OpenAI and Meta both document `safety_identifier` at 64 characters; Azure
// mirrors OpenAI's contract. xAI documents no cap, so 64 is a safe default
// there. Z.AI's `user_id` allows 6-128, so ZAIProvider passes a larger cap.
const DEFAULT_MAX_LENGTH = 64;

// A truncated app uid shorter than this could collide with another app's, so
// the suffix is dropped instead of squeezed.
const MIN_APP_UID_BUDGET = 8;

/**
 * Stable, non-sequential identifier for the acting user (and app) to send to AI
 * vendors as `user` / `safety_identifier` / `prompt_cache_key`:
 * `puter-<user-uuid>[-<app-uid>]`.
 *
 * The user uuid is never truncated; only the app suffix is cut or dropped to
 * fit `maxLength`. The app comes from `effectiveApp` so access-token requests
 * are attributed to the issuing app. Returns undefined for the system actor.
 *
 * The same value doubles as the default `prompt_cache_key`: OpenAI recommends
 * one key per user whose cache accounting should stay separate, and per-user
 * volume stays under the per-key routing budget. A shared prefix therefore
 * isn't cache-shared across users of one app; that's a deliberate trade.
 */
export const upstreamUserIdentifier = (
    actor?: Actor | null,
    maxLength: number = DEFAULT_MAX_LENGTH,
): string | undefined => {
    if (!actor || isSystemActor(actor)) return undefined;
    const userUuid = actor.user?.uuid;
    if (!userUuid) return undefined;
    const base = `puter-${userUuid}`;
    const appUid = actor?.effectiveApp?.uid;
    if (!appUid) return base;
    const appBudget = maxLength - base.length - 1;
    if (appBudget < MIN_APP_UID_BUDGET) return base;
    return `${base}-${appUid.slice(0, appBudget)}`;
};
