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

import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const THROTTLE_ERROR_NAMES = new Set([
    'ProvisionedThroughputExceededException',
    'ThrottlingException',
    'RequestLimitExceeded',
]);

// A hot key throttles in bursts, so each target logs at most once a minute and
// the next line says how many were folded into it.
const LOG_INTERVAL_MS = 60_000;
const MAX_TRACKED_TARGETS = 1_000;
const MAX_KEYS_PER_LINE = 5;
const MAX_VALUE_LENGTH = 120;

type AnyRecord = Record<string, unknown>;
type KeyNamesFor = (table: string) => string[] | undefined;
interface Target {
    table: string;
    keys: string;
}

const lastLogged = new Map<string, { at: number; folded: number }>();

const logOnce = (target: string, detail?: string): void => {
    const now = Date.now();
    const previous = lastLogged.get(target);
    if (previous && now - previous.at < LOG_INTERVAL_MS) {
        previous.folded += 1;
        return;
    }

    if (!previous && lastLogged.size >= MAX_TRACKED_TARGETS) {
        for (const [key, entry] of lastLogged) {
            if (now - entry.at >= LOG_INTERVAL_MS) lastLogged.delete(key);
        }
        if (lastLogged.size >= MAX_TRACKED_TARGETS) lastLogged.clear();
    }
    lastLogged.set(target, { at: now, folded: 0 });

    const folded = previous?.folded
        ? ` (+${previous.folded} since last logged)`
        : '';
    console.warn(`[ddb] ${target}${detail ? `: ${detail}` : ''}${folded}`);
};

// Inputs reach this middleware marshalled and outputs arrive unmarshalled, so
// a key value can be either shape.
const formatValue = (value: unknown): string => {
    let text: string;
    if (value && typeof value === 'object') {
        const attr = value as { S?: string; N?: string; B?: unknown };
        text =
            attr.S ??
            attr.N ??
            (attr.B !== undefined ? '<binary>' : JSON.stringify(value));
    } else {
        text = String(value);
    }
    return text.length > MAX_VALUE_LENGTH
        ? `${text.slice(0, MAX_VALUE_LENGTH)}...`
        : text;
};

const formatKey = (key: unknown, names?: string[]): string => {
    if (!key || typeof key !== 'object') return '<no key>';
    const record = key as AnyRecord;
    const parts = (names ?? Object.keys(record))
        .filter((name) => name in record)
        .map((name) => `${name}=${formatValue(record[name])}`);
    return parts.length > 0 ? parts.join(' ') : '<no key>';
};

// A put carries the whole item; only its key attributes are logged, never values.
const formatItemKey = (
    table: string,
    item: unknown,
    keyNamesFor: KeyNamesFor,
): string => {
    const names = keyNamesFor(table);
    return names ? formatKey(item, names) : '<key schema unknown>';
};

const formatList = (keys: string[]): string => {
    const shown = keys.slice(0, MAX_KEYS_PER_LINE).join(', ');
    const hidden = keys.length - MAX_KEYS_PER_LINE;
    return hidden > 0 ? `${shown} (+${hidden} more)` : shown;
};

const formatQueryKey = (input: AnyRecord): string => {
    const values = (input.ExpressionAttributeValues ?? {}) as AnyRecord;
    const placeholders =
        String(input.KeyConditionExpression ?? '').match(/:[\w-]+/g) ?? [];
    const parts = placeholders.map(
        (placeholder) =>
            `${placeholder.slice(1)}=${formatValue(values[placeholder])}`,
    );
    const index = input.IndexName ? `index=${input.IndexName} ` : '';
    return index + (parts.length > 0 ? parts.join(' ') : '<no key>');
};

const describeBatchWrite = (
    requestItems: unknown,
    keyNamesFor: KeyNamesFor,
): Target[] =>
    Object.entries((requestItems ?? {}) as AnyRecord).map(
        ([table, requests]) => ({
            table,
            keys: formatList(
                ((requests ?? []) as AnyRecord[]).map((request) => {
                    const put = request.PutRequest as AnyRecord | undefined;
                    if (put) return formatItemKey(table, put.Item, keyNamesFor);
                    const del = request.DeleteRequest as AnyRecord | undefined;
                    return formatKey(del?.Key);
                }),
            ),
        }),
    );

const describeBatchGet = (requestItems: unknown): Target[] =>
    Object.entries((requestItems ?? {}) as AnyRecord).map(([table, entry]) => ({
        table,
        keys: formatList(
            ((entry as { Keys?: unknown[] })?.Keys ?? []).map((key) =>
                formatKey(key),
            ),
        ),
    }));

const describeRequest = (
    commandName: string,
    input: AnyRecord,
    keyNamesFor: KeyNamesFor,
): Target[] => {
    const table = String(input.TableName ?? '');
    switch (commandName) {
        case 'GetItemCommand':
        case 'UpdateItemCommand':
        case 'DeleteItemCommand':
            return [{ table, keys: formatKey(input.Key) }];
        case 'PutItemCommand':
            return [
                { table, keys: formatItemKey(table, input.Item, keyNamesFor) },
            ];
        case 'QueryCommand':
            return [{ table, keys: formatQueryKey(input) }];
        case 'BatchWriteItemCommand':
            return describeBatchWrite(input.RequestItems, keyNamesFor);
        case 'BatchGetItemCommand':
            return describeBatchGet(input.RequestItems);
        default:
            return [{ table, keys: '<no key>' }];
    }
};

const throttleReasons = (error: unknown): string => {
    const err = error as {
        name?: string;
        ThrottlingReasons?: { reason?: string }[];
        throttlingReasons?: { reason?: string }[];
    };
    const reasons = (err.ThrottlingReasons ?? err.throttlingReasons ?? [])
        .map((entry) => entry.reason)
        .filter(Boolean);
    return reasons.length > 0 ? reasons.join(', ') : String(err.name);
};

/**
 * Log the table and key of every throttled attempt, including the ones the SDK
 * retries through, plus batch items DynamoDB hands back unprocessed. Sits
 * inside the retry loop because the CloudWatch throttle metrics count attempts,
 * and most throttled attempts succeed on retry.
 */
export const attachThrottleLogging = (
    client: DynamoDBClient,
    region: string,
    keyNamesFor: KeyNamesFor,
): void => {
    client.middlewareStack.addRelativeTo(
        <TArgs extends { input: unknown }, TResult extends { output: unknown }>(
            next: (args: TArgs) => Promise<TResult>,
            context: { commandName?: string },
        ) =>
            async (args: TArgs): Promise<TResult> => {
                const commandName = context.commandName ?? '';
                const operation = commandName.replace(/Command$/, '');
                try {
                    const result = await next(args);
                    const output = result.output as {
                        UnprocessedItems?: unknown;
                        UnprocessedKeys?: unknown;
                    };
                    const leftovers = [
                        ...describeBatchWrite(
                            output?.UnprocessedItems,
                            keyNamesFor,
                        ),
                        ...describeBatchGet(output?.UnprocessedKeys),
                    ];
                    for (const { table, keys } of leftovers) {
                        logOnce(
                            `unprocessed ${operation} ${table} ${keys} in ${region}`,
                        );
                    }
                    return result;
                } catch (error) {
                    if (THROTTLE_ERROR_NAMES.has((error as Error)?.name)) {
                        const targets = describeRequest(
                            commandName,
                            args.input as AnyRecord,
                            keyNamesFor,
                        );
                        for (const { table, keys } of targets) {
                            logOnce(
                                `throttled ${operation} ${table} ${keys} in ${region}`,
                                throttleReasons(error),
                            );
                        }
                    }
                    throw error;
                }
            },
        {
            name: 'throttleKeyLogger',
            relation: 'after',
            toMiddleware: 'retryMiddleware',
        },
    );
};
