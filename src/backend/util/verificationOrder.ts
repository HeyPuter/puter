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
 * Whether the account clears card and phone verification before confirming its
 * email, and is only sent the confirmation email once it gets there. Decided by
 * the signup gate and recorded in the account's metadata.
 */
export const isEmailGateLast = (
    user: { metadata?: Record<string, unknown> | null } | null | undefined,
): boolean => user?.metadata?.emailGateLast === true;

/**
 * The phone gate is set on an account that already has a number: the code goes
 * to that number, so passing proves the owner still has it.
 */
export const isPhoneOnFileStep = (
    user:
        | {
              phone?: unknown;
              requires_phone_verification?: boolean | number | null;
          }
        | null
        | undefined,
): boolean =>
    Boolean(user?.phone) && Boolean(user?.requires_phone_verification);

type EmailPendingUser =
    | {
          requires_email_confirmation?: boolean | number | null;
          email_confirmed?: boolean | number | null;
      }
    | null
    | undefined;

/** The account is still waiting on the code for its address. */
export const isEmailPending = (user: EmailPendingUser): boolean =>
    Boolean(user?.requires_email_confirmation && !user?.email_confirmed);

/**
 * Metadata key: the number on file when a dormant sign-in first asked for the
 * email code.
 */
export const PHONE_AT_DORMANT_SIGN_IN = 'phoneAtDormantSignIn';

/**
 * Whether the account's number is the one it had before its dormant sign-in, so
 * proving it shows the caller is who held the account back then. False when
 * nothing was recorded.
 */
export const hasPhoneFromBeforeDormancy = (
    user:
        | { phone?: unknown; metadata?: Record<string, unknown> | null }
        | null
        | undefined,
): boolean =>
    typeof user?.phone === 'string' &&
    user.phone !== '' &&
    user.metadata?.[PHONE_AT_DORMANT_SIGN_IN] === user.phone;

/** KV key set for an hour once the number on file is proven again. */
export const phoneOnFileProvenKey = (userId: number): string =>
    `phone-on-file-proven:${userId}`;
export const PHONE_ON_FILE_PROVEN_TTL_SECONDS = 60 * 60;
