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

import { ORG_SEAT_FREE_SUBSCRIPTION } from '../../services/metering/consts.js';
import { REGISTERED_USER_FREE } from './registeredUserFreePolicy.js';

/** Half the free plan, so a team cannot mint full free tiers by provisioning. */
export const ORG_SEAT_FREE = {
    id: ORG_SEAT_FREE_SUBSCRIPTION,
    monthUsageAllowance: Math.floor(
        REGISTERED_USER_FREE.monthUsageAllowance / 2,
    ),
    monthlyStorageAllowance: Math.floor(
        REGISTERED_USER_FREE.monthlyStorageAllowance / 2,
    ),
};
