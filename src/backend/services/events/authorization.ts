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

/**
 * Who may subscribe to an anchor, and who may still be delivered from it.
 *
 * Owner-only today. The real rule is an ACL check for `list` on the anchor,
 * with the grant it succeeded under stored on the subscription and re-checked
 * at delivery; both call sites below are shaped for that and neither has to
 * move when it lands. What must not change is the failure: a node the caller
 * cannot reach is answered as absent, because a distinguishable "forbidden"
 * turns subscribe into a way to ask whether a path exists.
 */

export interface AnchorOwnership {
    /** The user the anchor node belongs to. */
    ownerUserId: number;
}

export interface SubscribingActor {
    userId: number;
}

const subjectDoesNotExist = (subject: string): HttpError =>
    new HttpError(404, `No such entry: ${subject}`, {
        legacyCode: 'subject_does_not_exist',
    });

/** Whether this actor may hold a subscription on this anchor. */
export const checkSubscribeAuthorization = (
    actor: SubscribingActor,
    anchor: AnchorOwnership,
): boolean => actor.userId === anchor.ownerUserId;

/** The same decision, as the subscribe path needs it: pass, or 404. */
export const assertSubscribeAuthorized = (
    actor: SubscribingActor,
    anchor: AnchorOwnership,
    subject: string,
): void => {
    if (!checkSubscribeAuthorization(actor, anchor))
        throw subjectDoesNotExist(subject);
};
