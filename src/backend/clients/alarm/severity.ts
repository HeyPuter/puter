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
 * The rule keyed by an alarm id, or by a prefix pattern ending in `*`
 * (`cronMonitor:*`). Exact ids win over patterns; among patterns the longest
 * prefix wins, so a specific rule can carve an exception out of a broad one.
 */
export function matchIdRule<T>(
    id: string,
    rules: Record<string, T> | undefined,
): T | undefined {
    if (!rules) return undefined;
    if (Object.hasOwn(rules, id)) return rules[id];

    let bestLength = -1;
    let best: T | undefined;
    for (const [pattern, rule] of Object.entries(rules)) {
        if (!pattern.endsWith('*')) continue;
        const prefix = pattern.slice(0, -1);
        if (!id.startsWith(prefix)) continue;
        if (prefix.length <= bestLength) continue;
        bestLength = prefix.length;
        best = rule;
    }
    return best;
}

/** The operator override for an alarm id; see {@link matchIdRule}. */
export function resolveSeverityOverride(
    id: string,
    overrides: Record<string, SeverityRule> | undefined,
): SeverityRule | undefined {
    const rule = matchIdRule(id, overrides);
    return rule === undefined ? undefined : validRule(id, rule);
}

/** Call groups end up in storage keys and query strings. */
export const CALL_GROUP_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The call group config assigns an alarm id; see {@link matchIdRule}. */
export function resolveCallGroup(
    id: string,
    rules: Record<string, string> | undefined,
): string | undefined {
    const group = matchIdRule(id, rules);
    if (group === undefined) return undefined;
    if (typeof group === 'string' && CALL_GROUP_PATTERN.test(group))
        return group;
    console.warn(
        `[alarm] ignoring invalid call group "${group}" for ${id} ` +
            '(expected letters, digits, _ or -, up to 64)',
    );
    return undefined;
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
