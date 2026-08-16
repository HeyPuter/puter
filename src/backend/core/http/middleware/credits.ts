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

import type { RequestHandler } from 'express';
import type { IConfig } from '../../../types';
import {
    assertActorHasCredits,
    type CreditMetering,
} from '../../../services/metering/enforcement.js';
import '../expressAugmentation';

/**
 * Reject an authenticated caller with nothing left of their budget, for routes
 * that opt in with `requireCredits`.
 *
 * Anonymous callers pass: the signed-URL routes authorize on the URL rather
 * than a session, and there is no account to charge or turn away. So do worker
 * sessions, unless configured otherwise — see `creditEnforcementExempt`.
 *
 * The answer comes from a short-lived per-actor cache in the metering service,
 * so this normally costs nothing beyond a map lookup. That is what makes it
 * affordable on routes that are called hundreds of times a minute.
 */
export const requireCreditsGate = (
    metering: CreditMetering | undefined,
    config: IConfig,
): RequestHandler => {
    return (req, _res, next) => {
        assertActorHasCredits(metering, req.actor, config).then(
            () => next(),
            (err) => next(err),
        );
    };
};
