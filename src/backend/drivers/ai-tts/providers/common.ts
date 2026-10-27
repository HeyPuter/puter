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

import type { Actor } from '../../../core/actor.js';
import { HttpError } from '../../../core/http/HttpError.js';
import {
    type AiMeteringService,
    withStreamedAiCharge,
} from '../../util/aiCostFactor.js';
import type { DriverStreamResult } from '../../meta.js';

/**
 * Bounds a synthesis call: the whole reply, or until headers when the audio is
 * streamed on.
 */
export const TTS_UPSTREAM_TIMEOUT_MS = 120_000;

/** Rejects a string argument longer than its published cap with a 400. */
export function assertMaxChars(key: string, value: unknown, max: number): void {
    if (typeof value === 'string' && value.length > max) {
        throw new HttpError(400, `${key} must be at most ${max} characters`, {
            legacyCode: 'input_too_large',
            fields: { key, max },
        });
    }
}

/**
 * Runs `synthesize` under a hold on `text.length × ucentsPerChar` and meters
 * exactly that once its audio starts arriving. Per-character prices are known
 * up front, so the hold and the charge are the same amount.
 */
export function meterPerCharacter(
    metering: AiMeteringService,
    actor: Actor,
    usageType: string,
    ucentsPerChar: number,
    text: string,
    synthesize: () => Promise<DriverStreamResult>,
): Promise<DriverStreamResult> {
    const cost = ucentsPerChar * text.length;
    return withStreamedAiCharge(
        metering,
        actor,
        usageType,
        cost,
        synthesize,
        () => metering.incrementUsage(actor, usageType, text.length, cost),
    );
}

/** The cost-report lines for a `<model or engine> → ucents/char` table. */
export const characterCostReport = (
    provider: string,
    costs: Record<string, number>,
): Record<string, unknown>[] =>
    Object.entries(costs).map(([key, ucentsPerUnit]) => ({
        usageType: `${provider}:${key}:character`,
        ucentsPerUnit,
        unit: 'character',
        source: `driver:aiTts/${provider}`,
    }));
