/**
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

// Microcents per byte. Egress roughly matches S3 data-transfer-out
// (~$0.12/GiB); cached egress is CloudFront-backed (~$0.10/GiB).
// Ingress and deletes are currently free.
export const FS_COSTS = {
    'filesystem:ingress:bytes': 0,
    'filesystem:delete:bytes': 0,
    'filesystem:egress:bytes': toMicroCents(0.12 / 1024 / 1024 / 1024),
    'filesystem:cached-egress:bytes': toMicroCents(0.1 / 1024 / 1024 / 1024),
} as const;
