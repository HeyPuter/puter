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
import { COUNTRY_SMS_PRICES } from './countries.js';

const PRELUDE_API_BASE = 'https://api.prelude.dev/v2';
const REQUEST_TIMEOUT_MS = 8000;
/** OTP length — matches the 6-box code UI. Prelude allows 4–8. */
const PRELUDE_CODE_SIZE = 6;
/**
 * Channel Prelude prioritizes for delivery. RCS is far cheaper than SMS, so we
 * prefer it by default; Prelude routes to the next reachable channel (SMS) when
 * RCS isn't available on the destination. (Requires an RCS agent provisioned in
 * the Prelude account to actually use RCS — otherwise it just falls through to
 * SMS.) Override with `config.prelude.preferredChannel`.
 */
const DEFAULT_PREFERRED_CHANNEL: PreludeChannel = 'rcs';

/** Delivery channels Prelude can prioritize via `options.preferred_channel`. */
export type PreludeChannel =
    | 'sms'
    | 'rcs'
    | 'whatsapp'
    | 'viber'
    | 'zalo'
    | 'telegram';
/**
 * Channels Prelude reports in a verification's `channels` array — the ordered
 * delivery sequence, first entry first. Superset of `PreludeChannel`: 'silent'
 * and 'voice' can appear as delivery methods but can't be preferred.
 */
export type PreludeDeliveryChannel = PreludeChannel | 'silent' | 'voice';
/**
 * Default per-SMS cost ceiling (EUR). Countries whose Prelude SMS rate exceeds
 * this — or that have no SMS channel — are not offered phone verification. The
 * cap covers every realistic revenue market (priciest are Germany €0.0598 and
 * Saudi Arabia €0.0638) while excluding the expensive, high-fraud long tail.
 * Override per-deployment with `config.prelude.maxSmsCostEur`.
 */
const DEFAULT_MAX_SMS_COST_EUR = 0.07;

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

    /** Per-SMS cost ceiling in EUR (config override or the default cap). */
    get maxSmsCostEur(): number {
        return this.config.prelude?.maxSmsCostEur ?? DEFAULT_MAX_SMS_COST_EUR;
    }

    /**
     * Whether SMS verification should be offered for a country. False when the
     * country is unknown, has no SMS channel, or its rate exceeds the cost cap.
     * @param iso ISO-3166 alpha-2 (e.g. 'US') — from the parsed phone number.
     */
    isCountrySupported(iso: string | undefined): boolean {
        if (!iso) return false; // couldn't determine country → can't price it
        const price = COUNTRY_SMS_PRICES[iso.toUpperCase()];
        if (!price || price.sms == null) return false;
        return price.sms <= this.maxSmsCostEur;
    }

    async createVerification(
        target: string,
        signals: {
            ip?: string;
            device_id?: string;
            user_agent?: string;
            dispatch_id?: string;
        } = {},
    ): Promise<{
        id?: string;
        status: PreludeCreateStatus;
        channels?: PreludeDeliveryChannel[];
    }> {
        // Match the 6-box code UI (UIWindowPhoneVerificationRequired). Without
        // code_size Prelude uses the dashboard default (4). preferred_channel
        // prioritizes RCS (cheaper); Prelude falls back to SMS when unavailable.
        const options: Record<string, unknown> = {
            code_size: PRELUDE_CODE_SIZE,
            preferred_channel:
                this.config.prelude?.preferredChannel ??
                DEFAULT_PREFERRED_CHANNEL,
            locale: 'en-US',
        };
        // Branding lives in the Prelude dashboard (the message text is a
        // template); these just select a Puter-branded template / sender when
        // configured. See IPreludeConfig.
        const { templateId, senderId } = this.config.prelude ?? {};
        if (templateId) options.template_id = templateId;
        if (senderId) options.sender_id = senderId;

        const body: Record<string, unknown> = {
            target: { type: 'phone_number', value: target },
            options,
        };
        // Only attach signals we actually have — Prelude treats the object as
        // optional and an empty one adds nothing.
        const sig: Record<string, string> = {};
        if (signals.ip) sig.ip = signals.ip;
        if (signals.device_id) sig.device_id = signals.device_id;
        if (signals.user_agent) sig.user_agent = signals.user_agent;
        if (Object.keys(sig).length > 0) body.signals = sig;
        // dispatch_id is a top-level field, not a member of `signals`.
        if (signals.dispatch_id) body.dispatch_id = signals.dispatch_id;
        return this.#post('/verification', body) as Promise<{
            id?: string;
            status: PreludeCreateStatus;
            channels?: PreludeDeliveryChannel[];
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
