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

import { describe, expect, it } from 'vitest';
import { unflattenAmounts } from '../../stores/metering/MeteringBufferStore.ts';
import { KV_BATCH_GET_LIMIT } from '../../stores/systemKv/SystemKVStore.ts';
import { USAGE_DETAIL_SHARD_COUNT } from './consts.ts';
import type { UsageRecord } from './types.ts';
import {
    addUsageDetail,
    decodeSegment,
    decodeUsageDetail,
    detailPathOf,
    detailShardOf,
    encodeSegment,
    scalarsOf,
    splitUsageType,
} from './usageDetail.ts';

const AMOUNTS: UsageRecord = { units: 5, cost: 42, count: 3 };

/** Writes `amounts` the way a shard write would, then decodes them back. */
const roundTrip = (escapedType: string): FlatUsageDetailResult =>
    decodeUsageDetail(
        unflattenAmounts({
            [`${detailPathOf(escapedType)}.units`]: AMOUNTS.units,
            [`${detailPathOf(escapedType)}.cost`]: AMOUNTS.cost,
            [`${detailPathOf(escapedType)}.count`]: AMOUNTS.count,
        }),
    );
type FlatUsageDetailResult = Record<string, UsageRecord>;

describe('encodeSegment / decodeSegment', () => {
    it('passes ordinary segments through unchanged', () => {
        expect(encodeSegment('gpt-4o')).toBe('gpt-4o');
        expect(decodeSegment('gpt-4o')).toBe('gpt-4o');
    });

    it('escapes the empty segment', () => {
        expect(encodeSegment('')).toBe('~');
        expect(decodeSegment('~')).toBe('');
    });

    it('escapes a segment that already starts with ~', () => {
        expect(encodeSegment('~x')).toBe('~~x');
        expect(decodeSegment('~~x')).toBe('~x');
    });

    it('escapes every reserved word', () => {
        for (const reserved of [
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
        ]) {
            expect(encodeSegment(reserved)).toBe(`~${reserved}`);
            expect(decodeSegment(`~${reserved}`)).toBe(reserved);
        }
    });
});

describe('splitUsageType', () => {
    it('splits at the last colon', () => {
        expect(splitUsageType('x:y:z')).toEqual({ head: 'x:y', kind: 'z' });
    });

    it('keeps a colon-free type on the head with no kind', () => {
        expect(splitUsageType('manual_adjustment')).toEqual({
            head: 'manual_adjustment',
        });
    });
});

describe('detailPathOf / decodeUsageDetail round-trip', () => {
    it.each([
        '',
        ':',
        'a:',
        ':a',
        '~x',
        'units',
        'a:units',
        'a:constructor',
        'total',
        'x:y:z',
    ])('round-trips %j', (escapedType) => {
        expect(roundTrip(escapedType)).toEqual({ [escapedType]: AMOUNTS });
    });

    it('round-trips an ordinary provider:model:kind type', () => {
        expect(roundTrip('openai:gpt-5-nano:input')).toEqual({
            'openai:gpt-5-nano:input': AMOUNTS,
        });
    });
});

describe('decodeUsageDetail', () => {
    it('decodes a legacy flat record to itself', () => {
        const legacy = {
            'openai:gpt-4o': { units: 5, cost: 10, count: 1 },
            'kv:read': { units: 2, cost: 1, count: 1 },
            manual_adjustment: { units: 100, cost: 100, count: 1 },
        };
        expect(decodeUsageDetail(legacy)).toEqual(legacy);
    });

    it('skips top-level scalar fields', () => {
        expect(
            decodeUsageDetail({
                total: 100,
                allowanceUsed: 50,
                'kv:read': { units: 2, cost: 1, count: 1 },
            }),
        ).toEqual({ 'kv:read': { units: 2, cost: 1, count: 1 } });
    });

    it('sums duplicate resulting types', () => {
        // Two encoded heads that decode to the same type — pathological
        // input, not something this module's own encoding would produce.
        expect(
            decodeUsageDetail({
                a: { units: 1, cost: 1, count: 1 },
                '~a': { units: 2, cost: 2, count: 2 },
            }),
        ).toEqual({ a: { units: 3, cost: 3, count: 3 } });
    });

    it('is empty for null, non-object, or array input', () => {
        expect(decodeUsageDetail(null)).toEqual({});
        expect(decodeUsageDetail(undefined)).toEqual({});
        expect(decodeUsageDetail(5)).toEqual({});
        expect(decodeUsageDetail([])).toEqual({});
    });

    it('keeps a head-only type readable alongside its own kind children', () => {
        // `foo` and `foo:bar` share a shard item (same head, same top-level
        // key), so the head's own units/cost/count sit beside a `bar` child —
        // exactly what two separate shard writes merge into on the server.
        const record = {
            foo: {
                units: 10,
                cost: 10,
                count: 1,
                bar: { units: 20, cost: 20, count: 1 },
            },
        };
        expect(decodeUsageDetail(record)).toEqual({
            foo: { units: 10, cost: 10, count: 1 },
            'foo:bar': { units: 20, cost: 20, count: 1 },
        });
    });

    it('round-trips a head-only write and a kind write to the same head', () => {
        const flat = {
            ...(unflattenAmounts({
                [`${detailPathOf('foo')}.units`]: 10,
                [`${detailPathOf('foo')}.cost`]: 10,
                [`${detailPathOf('foo')}.count`]: 1,
            }) as { foo: object }),
        };
        const kindWrite = unflattenAmounts({
            [`${detailPathOf('foo:bar')}.units`]: 20,
            [`${detailPathOf('foo:bar')}.cost`]: 20,
            [`${detailPathOf('foo:bar')}.count`]: 1,
        }) as { foo: { bar: object } };
        const merged = {
            foo: {
                ...flat.foo,
                bar: kindWrite.foo.bar,
            },
        };
        expect(decodeUsageDetail(merged)).toEqual({
            foo: { units: 10, cost: 10, count: 1 },
            'foo:bar': { units: 20, cost: 20, count: 1 },
        });
    });
});

describe('addUsageDetail', () => {
    it('sums matching types and keeps types unique to one side', () => {
        const a = { 'openai:gpt-4o:input': { units: 1, cost: 2, count: 1 } };
        const b = {
            'openai:gpt-4o:input': { units: 3, cost: 4, count: 2 },
            'kv:read': { units: 5, cost: 0, count: 1 },
        };
        expect(addUsageDetail(a, b)).toEqual({
            'openai:gpt-4o:input': { units: 4, cost: 6, count: 3 },
            'kv:read': { units: 5, cost: 0, count: 1 },
        });
    });

    it('does not mutate its inputs', () => {
        const a = { x: { units: 1, cost: 1, count: 1 } };
        const b = { x: { units: 1, cost: 1, count: 1 } };
        addUsageDetail(a, b);
        expect(a.x).toEqual({ units: 1, cost: 1, count: 1 });
        expect(b.x).toEqual({ units: 1, cost: 1, count: 1 });
    });
});

describe('scalarsOf', () => {
    it('keeps numeric top-level fields, drops detailPaths', () => {
        expect(
            scalarsOf({
                total: 100,
                allowanceUsed: 50,
                detailPaths: 12,
                'kv:read': { units: 1, cost: 1, count: 1 },
            }),
        ).toEqual({ total: 100, allowanceUsed: 50 });
    });

    it('is empty for null or non-object input', () => {
        expect(scalarsOf(null)).toEqual({});
        expect(scalarsOf('x')).toEqual({});
    });
});

describe('detailShardOf', () => {
    // Golden values, computed once from the actual murmurhash implementation
    // (`node -e "console.log(require('murmurhash').v3('openai:gpt-5-nano') % 100)"`)
    // — a hash-function change should fail this, not the shard-count assertion.
    it.each([
        ['openai:gpt-5-nano:input', 29],
        ['openai:gpt-5-nano', 57],
        ['anthropic:claude-sonnet-4_dot_5:output', 82],
        ['kv:read', 74],
        ['', 0],
        ['a', 50],
        ['together:meta-llama/Meta-Llama-3_dot_1-405B-Instruct-Turbo:units', 4],
    ])('shards %s to %i', (escapedType, expected) => {
        expect(detailShardOf(escapedType)).toBe(expected);
    });

    it('only depends on the head, not the kind', () => {
        expect(detailShardOf('openai:gpt-5-nano:input')).toBe(
            detailShardOf('openai:gpt-5-nano:output'),
        );
    });

    it('stays within the KV store batch-get limit', () => {
        expect(USAGE_DETAIL_SHARD_COUNT).toBeLessThanOrEqual(
            KV_BATCH_GET_LIMIT,
        );
    });
});
