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

import murmurhash from 'murmurhash';
import { USAGE_DETAIL_SHARD_COUNT } from './consts';
import type { UsageRecord } from './types';

/** A usage type's per-type map, decoded back to the shape callers read. */
export type FlatUsageDetail = Record<string, UsageRecord>;

/**
 * Field names a detail record's top level must never collide with: the scalar
 * fields the totals item and the global/app aggregate items carry alongside
 * detail paths, plus the prototype-pollution vector `createPaths` already
 * refuses at the KV layer. Escaped defensively wherever this module's encoding
 * is used, whether or not that particular item carries all of them.
 */
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
    'units',
    'cost',
    'count',
    'total',
    'allowanceUsed',
    'allowanceUsedBaselined',
    'monthlyChargesApplied',
    'detailPaths',
    '__proto__',
    'constructor',
    'prototype',
]);

/**
 * Escapes one path segment (a usage type's head or kind) so it can sit at the
 * top level of a detail record without colliding with that record's own scalar
 * fields or the object-key vectors the KV store refuses outright.
 *
 * A bijection: prefixes exactly one `~` when the segment is empty, already
 * starts with `~`, or is reserved; otherwise passes through unchanged.
 * `decodeSegment` is the exact inverse — strip one leading `~` when present.
 */
export const encodeSegment = (segment: string): string =>
    segment === '' || segment.startsWith('~') || RESERVED_SEGMENTS.has(segment)
        ? `~${segment}`
        : segment;

/** Inverse of `encodeSegment`. */
export const decodeSegment = (segment: string): string =>
    segment.startsWith('~') ? segment.slice(1) : segment;

/**
 * A usage type (already dot-escaped for KV nesting, see `PERIOD_ESCAPE`) split
 * at its last `:` — head is the model, kind is what about it. A type with no
 * colon keeps its own record directly on the head.
 */
export const splitUsageType = (
    escapedType: string,
): { head: string; kind?: string } => {
    const idx = escapedType.lastIndexOf(':');
    if (idx < 0) return { head: escapedType };
    return {
        head: escapedType.slice(0, idx),
        kind: escapedType.slice(idx + 1),
    };
};

/**
 * The KV path a usage type's detail record lives at within its shard item —
 * `enc(head)` or `enc(head).enc(kind)`. Callers append `.units`/`.cost`/
 * `.count` themselves, matching how every other counter path in this service is
 * built.
 */
export const detailPathOf = (escapedType: string): string => {
    const { head, kind } = splitUsageType(escapedType);
    const encodedHead = encodeSegment(head);
    return kind === undefined
        ? encodedHead
        : `${encodedHead}.${encodeSegment(kind)}`;
};

/**
 * Which of `USAGE_DETAIL_SHARD_COUNT` items a usage type's detail lives in.
 * Hashes the dot-escaped head (before `encodeSegment`'s `~` handling), same
 * hash function `MeteringService` already uses for its global-usage shards, so
 * every kind of one model lands in the same shard.
 */
export const detailShardOf = (escapedType: string): number =>
    murmurhash.v3(splitUsageType(escapedType).head) % USAGE_DETAIL_SHARD_COUNT;

const isUsageRecord = (value: unknown): value is UsageRecord =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (typeof (value as UsageRecord).units === 'number' ||
        typeof (value as UsageRecord).cost === 'number' ||
        typeof (value as UsageRecord).count === 'number');

const addRecord = (
    out: FlatUsageDetail,
    type: string,
    rec: UsageRecord,
): void => {
    const existing = out[type];
    if (existing) {
        existing.units += rec.units || 0;
        existing.cost += rec.cost || 0;
        existing.count += rec.count || 0;
        return;
    }
    out[type] = {
        units: rec.units || 0,
        cost: rec.cost || 0,
        count: rec.count || 0,
    };
};

/**
 * A detail record (hierarchical, or a legacy flat one — same shape either way)
 * back to a flat `{ [escapedType]: {units,cost,count} }` map.
 *
 * Skips top-level values that aren't objects (a totals item's scalar fields,
 * read through this by construction rather than by a branch). A top-level value
 * that already looks like a usage record (has a numeric units/cost/count of its
 * own) is a head with no kind — including every entry of a legacy flat record,
 * which is why one decodes to itself unchanged. That head may _also_ carry kind
 * children alongside its own fields (`foo` and `foo:bar` share a shard item, so
 * both land under the same top-level key), so its object-valued properties are
 * walked as kinds regardless. Reserved-word escaping is what keeps a kind named
 * `units`/`cost`/`count` from being mistaken for the head's own fields.
 * Duplicate resulting types are summed, though the encoding is a bijection and
 * produces none on its own.
 */
export const decodeUsageDetail = (record: unknown): FlatUsageDetail => {
    const out: FlatUsageDetail = {};
    if (!record || typeof record !== 'object' || Array.isArray(record))
        return out;

    for (const [encodedHead, value] of Object.entries(
        record as Record<string, unknown>,
    )) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            continue;
        const head = decodeSegment(encodedHead);
        if (isUsageRecord(value)) addRecord(out, head, value);
        for (const [encodedKind, kindValue] of Object.entries(
            value as Record<string, unknown>,
        )) {
            if (!isUsageRecord(kindValue)) continue;
            addRecord(out, `${head}:${decodeSegment(encodedKind)}`, kindValue);
        }
    }
    return out;
};

/** Merge two decoded detail maps, summing types both sides carry. */
export const addUsageDetail = (
    a: FlatUsageDetail,
    b: FlatUsageDetail,
): FlatUsageDetail => {
    const out: FlatUsageDetail = {};
    for (const [type, rec] of Object.entries(a)) addRecord(out, type, rec);
    for (const [type, rec] of Object.entries(b)) addRecord(out, type, rec);
    return out;
};

/** A record's own numeric top-level fields, `detailPaths` excluded. */
export const scalarsOf = (record: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!record || typeof record !== 'object' || Array.isArray(record))
        return out;
    for (const [key, value] of Object.entries(
        record as Record<string, unknown>,
    )) {
        if (key === 'detailPaths') continue;
        if (typeof value === 'number') out[key] = value;
    }
    return out;
};
