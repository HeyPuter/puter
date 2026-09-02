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

import { toMicroCents } from '../../services/metering/utils.js';

/** The plan id a workspace stores in `group.plan_id`. */
export const TEAM_MEMBER_SUBSCRIPTION = 'team-member';

/** One allowance per resource, per account -- no pool to reconcile. */
export const TEAM_MEMBER_POLICY = {
    id: TEAM_MEMBER_SUBSCRIPTION,

    // The name metering enforces on; anything else leaves it undefined.
    monthUsageAllowance: toMicroCents(10),
    // Declarative here; `free_storage` is what FSService actually compares.
    monthlyStorageAllowance: 10 * 1024 * 1024 * 1024,

    // `toMicroCents` takes DOLLARS. Read by the payment integration.
    pricePerAccount: toMicroCents(5),
    // Well below `pricePerAccount`, or disabling would cost more than not.
    storagePricePerGiBMonth: toMicroCents(0.02),
} as const;
