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

import type { PagerSeverity, SeverityRule } from '../../types';

/** Ascending urgency. A transport takes everything at or above its floor. */
const RANK: Record<PagerSeverity, number> = {
    info: 0,
    warning: 1,
    error: 2,
    critical: 3,
};

const SEVERITIES = Object.keys(RANK) as PagerSeverity[];

export function isPagerSeverity(value: unknown): value is PagerSeverity {
    return typeof value === 'string' && value in RANK;
}

/** True when `severity` is urgent enough for a transport whose floor is `min`. */
export function meetsMinSeverity(
    severity: PagerSeverity,
    min: PagerSeverity,
): boolean {
    return RANK[severity] >= RANK[min];
}

/**
 * True when `severity` is quiet enough for a transport whose ceiling is `max`.
 * A ceiling is what keeps a chat transport from repeating everything the pager
 * already delivered.
 */
export function withinMaxSeverity(
    severity: PagerSeverity,
    max: PagerSeverity,
): boolean {
    return RANK[severity] <= RANK[max];
}

/**
 * Look up the operator override for an alarm id. Exact ids win over prefix
 * patterns (`cronMonitor:*`); among patterns the longest prefix wins, so a
 * specific rule can carve an exception out of a broad one.
 */
export function resolveSeverityOverride(
    id: string,
    overrides: Record<string, SeverityRule> | undefined,
): SeverityRule | undefined {
    if (!overrides) return undefined;

    const exact = overrides[id];
    if (exact !== undefined) return validRule(id, exact);

    let bestLength = -1;
    let best: SeverityRule | undefined;
    for (const [pattern, rule] of Object.entries(overrides)) {
        if (!pattern.endsWith('*')) continue;
        const prefix = pattern.slice(0, -1);
        if (!id.startsWith(prefix)) continue;
        if (prefix.length <= bestLength) continue;
        bestLength = prefix.length;
        best = rule;
    }
    return best === undefined ? undefined : validRule(id, best);
}

/**
 * A typo in the override map would otherwise silently mute or escalate an
 * alarm, so an unrecognized value is dropped with a warning instead.
 */
function validRule(id: string, rule: SeverityRule): SeverityRule | undefined {
    if (rule === 'mute' || isPagerSeverity(rule)) return rule;
    console.warn(
        `[alarm] ignoring invalid severity override "${rule}" for ${id} ` +
            `(expected mute or one of ${SEVERITIES.join(', ')})`,
    );
    return undefined;
}
