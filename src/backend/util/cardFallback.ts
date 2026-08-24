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

/**
 * SMS-to-card fallback: the shared rule for whether a phone-gated user has run
 * out of SMS attempts and may verify a card instead.
 *
 * Two consumers need the same answer, so it lives here rather than inside the
 * controller: `/send-confirm-phone` (which counts attempts and opens the
 * fallback) and `/whoami` (which tells a reloading GUI the fallback is already
 * open — the send route can't, because by then every send is rejected by its
 * own rate limit before any handler runs).
 */
import type { IConfig } from '../types';

/**
 * `/send-confirm-phone` route rate limit: how many verification texts one
 * account can ask for per window. This is also the definition of "out of SMS
 * attempts" — the fallback opens on the last send this allows, because requests
 * past it are rejected in middleware and never reach a handler.
 */
export const SEND_PHONE_RATE_LIMIT = 10;
export const SEND_PHONE_RATE_WINDOW_MS = 60 * 60_000;

/**
 * How long the fallback stays open once it opens. Deliberately much longer than
 * the attempt counter's window: the counter exists to detect exhaustion, and
 * once detected the user needs time to finish the card flow (and to come back
 * to it) without racing the counter's expiry.
 */
export const CARD_FALLBACK_OPEN_TTL_SECONDS = 24 * 60 * 60;

/** Attempt counter, TTL-tied to the send rate-limit window. */
export const phoneAttemptsKey = (userId: number): string =>
    `phone-verify-attempts:${userId}`;

/** Eligibility flag, the only thing the card endpoints read. */
export const cardFallbackFlagKey = (userId: number): string =>
    `card-fallback-open:${userId}`;

/** The user fields the rule reads. */
export interface PhoneGatedUser {
    id?: number | null;
    requires_phone_verification?: boolean | number | null;
}

/** Reads one system-KV key; resolves whatever was stored (or null/undefined). */
export type ReadKvFlag = (key: string) => Promise<unknown>;

/**
 * How many SMS send attempts open the fallback. Defaults to the full send
 * allowance — the fallback is meant to appear only once SMS has actually run
 * out for this user, not as a competing option alongside a working SMS flow.
 *
 * A lower `after_attempts` is honoured (it makes the card path reachable
 * without burning ten texts, which is what QA wants), and any value above the
 * send allowance is clamped down to it: requests past the route limit are
 * rejected in middleware and never reach the attempt counter, so a higher
 * threshold could never be crossed.
 */
export function cardFallbackAfterAttempts(
    config: Pick<IConfig, 'phone_verification_card_fallback'>,
): number {
    const cfg = config.phone_verification_card_fallback;
    return Math.min(
        typeof cfg?.after_attempts === 'number' && cfg.after_attempts > 0
            ? cfg.after_attempts
            : SEND_PHONE_RATE_LIMIT,
        SEND_PHONE_RATE_LIMIT,
    );
}

/**
 * What the fallback needs to know about the rest of the system to decide
 * whether it should be on by default.
 */
export interface CardFallbackDeps {
    /** Whether SMS verification can work at all — i.e. a provider is set up. */
    smsConfigured: () => boolean;
    /**
     * Asks whichever extension owns card verification whether the card gate is
     * on. Resolves null when nothing is listening (no payments extension), so
     * "installed but off" and "not installed" stay distinguishable.
     */
    probeCardVerification: () => Promise<boolean | null>;
}

/**
 * Memoized answer to the card-gate probe. The probe is side-effect free, but it
 * is asked on a polled endpoint, so cache it briefly rather than fanning out an
 * event per request. Only the _default_ is cached: an explicit `enabled: false`
 * short-circuits below without ever consulting this, so the operator's kill
 * switch still takes effect immediately.
 */
const CARD_STATUS_TTL_MS = 60_000;
let cardStatusCache: { at: number; enabled: boolean | null } | null = null;

/** Drops the memoized probe answer. For tests, and for a config reload. */
export function resetCardVerificationStatusCache(): void {
    cardStatusCache = null;
}

async function cardVerificationEnabled(
    deps: CardFallbackDeps,
): Promise<boolean | null> {
    const now = Date.now();
    if (cardStatusCache && now - cardStatusCache.at < CARD_STATUS_TTL_MS) {
        return cardStatusCache.enabled;
    }
    let enabled: boolean | null = null;
    try {
        enabled = await deps.probeCardVerification();
    } catch (e) {
        // Treat a broken probe as "no card gate": offering a card path that may
        // not work is worse than not offering one.
        console.warn('[card-verification] status probe failed:', e);
    }
    cardStatusCache = { at: now, enabled };
    return enabled;
}

/**
 * Whether the SMS-to-card fallback is switched on.
 *
 * `enabled` is a tri-state. Set explicitly, it wins either way — that is the
 * opt-out. Left unset, the fallback follows the pair it bridges: on wherever
 * both halves actually work, off otherwise. Without that conjunction the offer
 * could show up on a deployment with no card gate behind it, where taking it
 * strands the user on a dialog that can only fail.
 */
export async function isCardFallbackEnabled(
    config: Pick<IConfig, 'phone_verification_card_fallback'>,
    deps: CardFallbackDeps,
): Promise<boolean> {
    const configured = config.phone_verification_card_fallback?.enabled;
    if (typeof configured === 'boolean') return configured;
    if (!deps.smsConfigured()) return false;
    return (await cardVerificationEnabled(deps)) === true;
}

/**
 * Whether this user may verify a card in place of the phone gate right now.
 *
 * Reads only the eligibility flag, never the raw attempt counter: the counter
 * expires with the send rate-limit window, so deriving eligibility from it
 * would revoke the offer mid-flow. The cheap disqualifiers (not phone-gated,
 * feature off) come first, so an ordinary `/whoami` never reaches the KV read.
 * Every KV failure fails closed.
 */
export async function isCardFallbackEligible(
    config: Pick<IConfig, 'phone_verification_card_fallback'>,
    user: PhoneGatedUser,
    readFlag: ReadKvFlag,
    deps: CardFallbackDeps,
): Promise<boolean> {
    if (!user.requires_phone_verification) return false;
    if (typeof user.id !== 'number') return false;
    if (!(await isCardFallbackEnabled(config, deps))) return false;
    try {
        return (await readFlag(cardFallbackFlagKey(user.id))) === true;
    } catch (e) {
        console.warn('[card-verification] fallback flag read failed:', e);
        return false;
    }
}
