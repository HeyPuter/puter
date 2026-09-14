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

// OpenAI's `safety_identifier` (Chat Completions and Responses; Azure mirrors
// the same contract) is documented at 64 characters. Z.AI's `user_id` is
// documented at 6-128, so ZAIProvider passes a larger `maxLength`. Meta's and
// xAI's APIs don't document a limit for this field; 64 is reused there as a
// safe default, not a verified vendor cap. The same value is also sent as
// the deprecated `user` field and, where forwarded, `prompt_cache_key` —
// neither documents a length limit of its own.
export const AI_USER_IDENTIFIER_MAX_LENGTH = 64;

// Below this remaining budget, a truncated app uid loses enough of its
// distinguishing suffix that two different apps could collide; below the
// threshold we drop the app suffix entirely rather than risk that.
const MIN_APP_UID_BUDGET = 8;

/**
 * Builds Puter's stable, non-sequential AI actor identifier.
 *
 * The user's UUID is always preserved in full. When an app is present,
 * maxLength limits the app-bearing form; the app token may be truncated or
 * omitted when there is insufficient room. The user-only form is always
 * returned in full.
 *
 * Reads only `effectiveApp` (never the bare `app`) so an actor literal built
 * without `makeActor` — whose `effectiveApp` was never derived — degrades to
 * the user-only identifier instead of silently attributing to the wrong app.
 */
export const aiUserIdentifier = (
    actor?: Actor | null,
    maxLength: number = AI_USER_IDENTIFIER_MAX_LENGTH,
): string | undefined => {
    if (!actor || isSystemActor(actor)) return undefined;
    const userUuid = actor.user?.uuid;
    if (!userUuid) return undefined;
    const base = `puter-${userUuid}`;
    const appUid = actor.effectiveApp?.uid;
    if (!appUid || maxLength <= base.length + 1) return base;
    const appBudget = maxLength - base.length - 1;
    if (appBudget < MIN_APP_UID_BUDGET) return base;
    return `${base}-${appUid.slice(0, appBudget)}`;
};
