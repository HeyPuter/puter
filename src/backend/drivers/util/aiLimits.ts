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

import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import type { DriverConcurrentConfig, DriverRateLimitConfig } from '../meta.js';

// ── Shared AI driver limits ─────────────────────────────────────────
//
// Every AI driver — chat, image, video, TTS, speech↔speech, speech→text,
// OCR — shares this policy envelope. Tuning the numbers in one place
// keeps the tiers consistent across modalities; if any single driver
// needs to diverge later it can shadow these fields locally.
//
// The base `limit` is what subscribed (paid / unlimited) tiers see —
// `bySubscription` only carves out tighter caps for the free tiers, so
// any plan id that isn't enumerated (a Stripe plan, the dev-only
// `unlimited`, etc.) automatically falls through to the generous base.
//
// Concurrency is enforced *across* the AI surface per user — the key
// includes the interface name, so a user generating an image can still
// kick off a chat completion in parallel. The caps below apply
// per-(iface, method, user) bucket.

export const AI_RATE_LIMIT: DriverRateLimitConfig = {
    default: {
        limit: 200, // subscribed / paid tier
        window: 10_000,
        bySubscription: {
            [DEFAULT_FREE_SUBSCRIPTION]: 60, // verified registered user
            [DEFAULT_TEMP_SUBSCRIPTION]: 40, // temp / anonymous-email user
        },
    },
};

export const AI_CONCURRENT: DriverConcurrentConfig = {
    default: {
        limit: 20, // subscribed / paid tier
        bySubscription: {
            [DEFAULT_FREE_SUBSCRIPTION]: 6, // verified registered user
            [DEFAULT_TEMP_SUBSCRIPTION]: 4, // temp / anonymous-email user
        },
    },
};
