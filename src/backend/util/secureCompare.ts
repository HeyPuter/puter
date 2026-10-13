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

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Only has to stay unknown to callers for the life of the process.
const COMPARE_KEY = randomBytes(32);

const digest = (value: string | Buffer): Buffer =>
    createHmac('sha256', COMPARE_KEY).update(value).digest();

/**
 * Constant-time equality for secrets, tokens and signatures. Both sides are
 * HMACed to a fixed-length digest first, so neither the inputs' lengths nor
 * where they first differ shows in the timing, and unequal lengths need no
 * early return.
 */
export function secretsEqual(a: string | Buffer, b: string | Buffer): boolean {
    return timingSafeEqual(digest(a), digest(b));
}
