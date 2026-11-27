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
import { HttpError } from './HttpError';
import { upstreamAlarmSummary } from './upstreamAlarmSummary';

describe('upstreamAlarmSummary', () => {
    it.each([
        ['upstream_credits_exhausted', 'AI provider out of credits'],
        ['upstream_rate_limited', 'AI provider rate limit exceeded'],
        ['upstream_auth_failed', 'AI provider authentication failed'],
        ['upstream_timeout', 'AI provider timed out'],
        ['upstream_provider_unavailable', 'AI provider unavailable'],
    ])(
        'summarizes %s without copying the upstream message',
        (legacyCode, expected) => {
            expect(
                upstreamAlarmSummary(
                    new HttpError(500, 'private upstream details', {
                        legacyCode,
                    }),
                ),
            ).toBe(expected);
        },
    );

    it('includes the provider, model, and actual upstream status from chat attempts', () => {
        const error = new HttpError(500, 'AI provider authentication failed', {
            legacyCode: 'upstream_auth_failed',
            fields: {
                attempts: [
                    {
                        provider: 'infron',
                        model: 'infron:stepfun/step-3.5-flash',
                        status: 403,
                        error: 'private details',
                    },
                ],
            },
        });
        expect(upstreamAlarmSummary(error)).toBe(
            'AI provider authentication failed: infron / infron:stepfun/step-3.5-flash (HTTP 403)',
        );
    });

    it('includes provider/status fields from non-chat drivers', () => {
        expect(
            upstreamAlarmSummary(
                new HttpError(503, 'credits', {
                    code: 'upstream_credits_exhausted',
                    fields: { provider: 'image-provider', upstreamStatus: 402 },
                }),
            ),
        ).toBe('AI provider out of credits: image-provider (HTTP 402)');
    });

    it('bounds the number of attempts and the length of each identifier', () => {
        const attempts = Array.from({ length: 20 }, () => ({
            provider: 'p'.repeat(200),
            model: 'm'.repeat(200),
            status: 429,
        }));
        const summary = upstreamAlarmSummary(
            new HttpError(429, 'rate limit', {
                legacyCode: 'upstream_rate_limited',
                fields: { attempts },
            }),
        );
        expect(summary).toContain('+17 more attempts');
        expect(summary).not.toContain('p'.repeat(121));
        expect(summary?.match(/HTTP 429/g)).toHaveLength(3);
        expect(summary!.length).toBeLessThan(900);
    });

    it('ignores malformed attempts, identifiers and statuses', () => {
        const summary = upstreamAlarmSummary(
            new HttpError(500, 'auth', {
                legacyCode: 'upstream_auth_failed',
                fields: {
                    attempts: [
                        null,
                        'invalid',
                        {
                            provider: { secret: 'value' },
                            model: ' model\n name ',
                            status: '403',
                        },
                    ],
                },
            }),
        );
        expect(summary).toBe('AI provider authentication failed: model name');
        expect(
            upstreamAlarmSummary(
                new HttpError(500, 'auth', {
                    legacyCode: 'upstream_auth_failed',
                    fields: { attempts: 'invalid', upstreamStatus: 200 },
                }),
            ),
        ).toBe('AI provider authentication failed');
    });

    it.each([
        'internal_error',
        'upstream_failed',
        'upstream_bad_request',
        'upstream_new_failure',
        undefined,
    ])(
        'keeps full diagnostics for unrecognized or request-related errors (%s)',
        (legacyCode) => {
            expect(
                upstreamAlarmSummary(
                    new HttpError(500, 'unexpected', { legacyCode }),
                ),
            ).toBeUndefined();
        },
    );
});
