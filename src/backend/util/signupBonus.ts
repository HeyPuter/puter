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
 * Signup bonus codes: the shape a code may take, and the hand-off to whatever
 * extension decides what a code is worth. Core holds no codes and grants
 * nothing.
 *
 * Codes have one canonical form (lower case, separators dropped) so a code
 * typed as `ABC-123` and linked as `abc123` is one code to every counter keyed
 * on it.
 */
import type { EventClient } from '../clients/event/EventClient';
import type { EventMap } from '../clients/event/types';
import { HttpError } from '../core/http/HttpError.js';

const CANONICAL_BONUS_CODE = /^[a-z0-9]{4,64}$/;
/** Raw input is capped before normalizing so a huge string is never scanned. */
const RAW_BONUS_CODE_MAX_LENGTH = 128;

/** The canonical form of `raw`, or null when it can't be a bonus code. */
export function normalizeBonusCode(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.length > RAW_BONUS_CODE_MAX_LENGTH) {
        return null;
    }
    const canonical = raw.toLowerCase().replace(/[\s_-]/g, '');
    return CANONICAL_BONUS_CODE.test(canonical) ? canonical : null;
}

/** Whether a request body field counts as "no bonus code presented". */
export const isAbsentBonusCode = (raw: unknown): boolean =>
    raw === undefined || raw === null || raw === '';

/**
 * One answer for every way a code can fail — unknown, expired, used up — so
 * signup can't be used to tell them apart.
 */
export const bonusCodeInvalidError = (): HttpError =>
    new HttpError(400, 'This bonus code is invalid or no longer available.', {
        legacyCode: 'bonus_code_invalid',
    });

/**
 * Ask listeners what a canonical code grants right now — the preview the signup
 * form shows. Signup asks it too, before its abuse checks, so a dead code is
 * refused before those checks record the attempt against the address.
 */
export async function checkSignupBonus(
    events: EventClient | undefined,
    code: string,
    { ip, fingerprint }: { ip: string | null; fingerprint: string | null },
): Promise<EventMap['puter.signup-bonus.check']> {
    const event: EventMap['puter.signup-bonus.check'] = {
        code,
        ip,
        fingerprint,
        valid: false,
        reason: null,
        display: null,
        requirements: null,
    };
    try {
        await events?.emitAndWait('puter.signup-bonus.check', event, {});
    } catch (e) {
        console.warn('[signup] bonus check hook failed:', e);
    }
    return event;
}

export type SignupBonusContext = Omit<
    EventMap['puter.signup-bonus.validate'],
    'code' | 'accepted'
>;

export type SignupBonusVerdict =
    | { accepted: false }
    | {
          accepted: true;
          requiresPhoneVerification: boolean;
          requiresCardVerification: boolean;
      };

/**
 * Offer a canonical bonus code to listeners for a signup that already passed
 * `puter.signup.validate`. With no listener installed nothing accepts, so a
 * code is refused rather than silently ignored.
 */
export async function validateSignupBonus(
    events: EventClient | undefined,
    code: string,
    context: SignupBonusContext,
): Promise<SignupBonusVerdict> {
    const event: EventMap['puter.signup-bonus.validate'] = {
        ...context,
        code,
        accepted: false,
    };
    try {
        await events?.emitAndWait('puter.signup-bonus.validate', event, {});
    } catch (e) {
        console.warn('[signup] bonus validate hook failed:', e);
    }
    if (event.accepted !== true) return { accepted: false };
    return {
        accepted: true,
        requiresPhoneVerification:
            context.requires_phone_verification ||
            event.requires_phone_verification === true,
        requiresCardVerification:
            context.requires_card_verification ||
            event.requires_card_verification === true,
    };
}
