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

import type { HttpError } from './HttpError';

const summaries = new Map([
    ['upstream_credits_exhausted', 'AI provider out of credits'],
    ['upstream_rate_limited', 'AI provider rate limit exceeded'],
    ['upstream_auth_failed', 'AI provider authentication failed'],
    ['upstream_timeout', 'AI provider timed out'],
    ['upstream_provider_unavailable', 'AI provider unavailable'],
]);

/** Provider failures are diagnosed by their upstream route and status. */
export function upstreamAlarmSummary(error: HttpError): string | undefined {
    const summary = summaries.get(error.legacyCode ?? error.code ?? '');
    if (!summary) return undefined;

    const fields = error.fields ?? {};
    const attempts = Array.isArray(fields.attempts)
        ? fields.attempts
        : [fields];
    const routes: string[] = [];
    for (const attempt of attempts.slice(0, 3)) {
        if (!attempt || typeof attempt !== 'object') continue;
        const route = attempt as Record<string, unknown>;
        const identifiers = [route.provider, route.model]
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.replace(/\s+/g, ' ').trim().slice(0, 120))
            .filter(Boolean);
        const status = route.status ?? route.upstreamStatus;
        const statusLabel =
            typeof status === 'number' &&
            Number.isInteger(status) &&
            status >= 400 &&
            status <= 599
                ? `HTTP ${status}`
                : '';
        const label = identifiers.join(' / ');
        if (label || statusLabel) {
            routes.push(
                label && statusLabel
                    ? `${label} (${statusLabel})`
                    : label || statusLabel,
            );
        }
    }
    if (attempts.length > 3)
        routes.push(`+${attempts.length - 3} more attempts`);
    return routes.length ? `${summary}: ${routes.join('; ')}` : summary;
}
