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
import {
    assertActorMeetsReputation,
    type ReputationRequirement,
} from '../../reputation.js';
import type { IConfig } from '../../../types';
import '../expressAugmentation';

/**
 * Reject a caller whose account isn't trusted enough for this surface, for
 * routes that opt in with `requireReputation`. Off unless a route asks for it,
 * and off again unless the running config gives the named tier a minimum
 * score.
 *
 * The decision is `assertActorMeetsReputation`, which the driver dispatch path
 * calls directly — `/drivers/call` is one shared route, so a per-driver
 * requirement can't ride on the route chain.
 */
export const requireReputationGate = (
    config: IConfig,
    requirement: ReputationRequirement,
): RequestHandler => {
    return (req, _res, next) => {
        assertActorMeetsReputation(req.actor, requirement, config).then(
            () => next(),
            (err) => next(err),
        );
    };
};
