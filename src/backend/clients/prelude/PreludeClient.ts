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

import type { IConfig } from '../../types';
import { PuterClient } from '../types';

const PRELUDE_API_BASE = 'https://api.prelude.dev/v2';
const REQUEST_TIMEOUT_MS = 8000;

/** Status returned by Prelude when creating/retrying a verification. */
export type PreludeCreateStatus =
    | 'success'
    | 'retry'
    | 'challenged'
    | 'blocked'
    | 'shadow_blocked';

/** Status returned by Prelude when checking a code. */
export type PreludeCheckStatus =
    | 'success'
    | 'failure'
    | 'expired_or_not_found'
    | 'transaction_missing'
    | 'transaction_mismatch';

/**
 * Prelude Verify v2 client (https://docs.prelude.so/verify/v2). Sends and checks
 * SMS one-time codes — Prelude generates, delivers, and validates the code, so
 * we never store one ourselves. No-ops with a warning when no API key is
 * configured (so dev environments don't crash); `isConfigured()` lets callers
 * surface a clean "phone verification unavailable" error instead.
 */
export class PreludeClient extends PuterClient {
    private apiKey: string | null = null;

    constructor(config: IConfig) {
        super(config);
        this.apiKey = config.prelude?.apiKey ?? null;
    }

    override onServerStart(): void {
        if (!this.apiKey) {
            console.warn(
                '[prelude] no apiKey configured — SMS phone verification is disabled',
            );
        }
    }

    /** True when an API key is configured and verification can be attempted. */
    isConfigured(): boolean {
        return !!this.apiKey;
    }

    /** ISO region used to parse local-format numbers (config-driven). */
    get defaultCountry(): string | undefined {
        return this.config.prelude?.defaultCountry;
    }

    /**
     * Create (or retry) a verification: Prelude sends an OTP to `target`.
     * @param target E.164 phone number, e.g. "+14155550123".
     * @param signals Optional anti-fraud signals (the signup IP).
     */
    async createVerification(
        target: string,
        signals: { ip?: string } = {},
    ): Promise<{ id?: string; status: PreludeCreateStatus }> {
        const body: Record<string, unknown> = {
            target: { type: 'phone_number', value: target },
        };
        if (signals.ip) body.signals = { ip: signals.ip };
        return this.#post('/verification', body) as Promise<{
            id?: string;
            status: PreludeCreateStatus;
        }>;
    }

    /**
     * Check a code the user entered against the active verification for `target`.
     * @returns `{ status }` — `'success'` means verified.
     */
    async checkVerification(
        target: string,
        code: string,
    ): Promise<{ status: PreludeCheckStatus }> {
        return this.#post('/verification/check', {
            target: { type: 'phone_number', value: target },
            code,
        }) as Promise<{ status: PreludeCheckStatus }>;
    }

    async #post(
        path: string,
        body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        if (!this.apiKey) {
            throw new Error('Prelude is not configured');
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(`${PRELUDE_API_BASE}${path}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const json = (await res.json().catch(() => ({}))) as Record<
                string,
                unknown
            >;
            if (!res.ok) {
                throw new Error(
                    `Prelude ${path} failed: ${res.status} ${
                        (json as { message?: string })?.message ?? ''
                    }`.trim(),
                );
            }
            return json;
        } finally {
            clearTimeout(timer);
        }
    }
}
