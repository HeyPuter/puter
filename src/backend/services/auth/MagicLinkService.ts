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

import crypto from 'node:crypto';
import type { Request } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type { LayerInstances } from '../../types.js';
import { isStorableEmail } from '../../util/email.js';
import type { puterServices } from '../index.js';
import { PuterService } from '../types.js';
import { signupClientIp } from '../user/SignupService.js';

/** How long an emailed link stays valid. */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

const LINK_SCOPE = 'magic-link';
// Every token scope shares one signing key; the purpose says which job.
const LINK_PURPOSE = 'magic-link';

export interface MagicLinkClaims {
    purpose: string;
    jti: string;
    email: string;
    /** The request this link answers, so the window that asked can tell. */
    rid: string;
    /** Sha256 of the requesting browser's binding cookie. */
    bnd: string;
    /** The site the sign-in was requested for; null for Puter itself. */
    app: string | null;
}

export type MagicLinkRedemption =
    | { status: 'confirm'; email: string; appOrigin: string | null }
    | { status: 'redeemed'; claims: MagicLinkClaims };

const sha256 = (value: string): string =>
    crypto.createHash('sha256').update(value).digest('hex');

const sameDigest = (a: string, b: string): boolean => {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

const parseOrigin = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.origin;
    } catch {
        return null;
    }
};

const linkExpired = () =>
    new HttpError(400, 'This sign-in link has expired or was already used.', {
        legacyCode: 'link_expired',
    });

/**
 * Passwordless sign-in by email. A link signs in only the browser that opens
 * it, never the one that asked for it, and a browser other than the requester
 * has to confirm the account first. Accounts with 2FA still need their second
 * factor, and new accounts go through the same signup gate as OIDC.
 */
export class MagicLinkService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    /**
     * Mail a sign-in link to `email`. Answers the same whether or not the
     * address has an account; a suspended account, or a new address while
     * signup is disabled, gets no mail.
     */
    async request(input: {
        email: unknown;
        appOrigin: unknown;
        /** The requesting browser's binding cookie value. */
        browserBinding: string;
    }): Promise<{ requestId: string }> {
        const email = typeof input.email === 'string' ? input.email.trim() : '';
        if (!isStorableEmail(email)) {
            throw new HttpError(400, 'Invalid email.', {
                legacyCode: 'bad_request',
            });
        }
        const hasApp =
            input.appOrigin !== undefined &&
            input.appOrigin !== null &&
            input.appOrigin !== '';
        const appOrigin = hasApp ? parseOrigin(input.appOrigin) : null;
        if (hasApp && !appOrigin) {
            throw new HttpError(400, 'app_origin must be an http(s) origin.', {
                legacyCode: 'bad_request',
            });
        }

        // Blocked and undeliverable addresses get no mail at all.
        await this.services.signup.validateEmail(email);

        const requestId = crypto.randomUUID();
        const holder = await this.stores.user.findEmailOwner(email);
        if (holder?.suspended) return { requestId };
        if (!holder && this.config.disable_user_signup) return { requestId };

        const claims: MagicLinkClaims = {
            purpose: LINK_PURPOSE,
            jti: crypto.randomUUID(),
            email,
            rid: requestId,
            bnd: sha256(input.browserBinding),
            app: appOrigin,
        };
        const token = this.services.token.sign(
            LINK_SCOPE,
            { ...claims },
            { expiresIn: MAGIC_LINK_TTL_SECONDS },
        );
        // In the fragment: never sent to the server, so it stays out of
        // access logs and Referer headers, and a mail scanner that fetches
        // the URL can't spend it.
        const origin = (this.config.origin ?? '').replace(/\/$/, '');
        const link = `${origin}/action/magic-link#${new URLSearchParams({ token })}`;

        const sent = await this.clients.email.send(
            email,
            'magic_link_sign_in',
            {
                link,
                app_host: appOrigin ? new URL(appOrigin).host : null,
            },
        );
        if (sent === null) {
            console.warn(
                `[magic-link] no email transport configured; sign-in link for ${email}: ${link}`,
            );
        }
        return { requestId };
    }

    /**
     * Spend a link. A browser without the requester's binding cookie gets
     * `confirm` first, with the link left unspent, so a link someone else sent
     * can't sign it in unasked.
     */
    async redeem(
        token: unknown,
        opts: { browserBinding: string | null; confirmed: boolean },
    ): Promise<MagicLinkRedemption> {
        if (typeof token !== 'string' || !token) throw linkExpired();
        let claims: MagicLinkClaims;
        try {
            claims = this.services.token.verify<MagicLinkClaims>(
                LINK_SCOPE,
                token,
            );
        } catch {
            throw linkExpired();
        }
        if (
            claims.purpose !== LINK_PURPOSE ||
            typeof claims.jti !== 'string' ||
            typeof claims.email !== 'string' ||
            typeof claims.rid !== 'string' ||
            typeof claims.bnd !== 'string'
        ) {
            throw linkExpired();
        }

        const sameBrowser =
            typeof opts.browserBinding === 'string' &&
            sameDigest(sha256(opts.browserBinding), claims.bnd);
        if (!sameBrowser && !opts.confirmed) {
            return {
                status: 'confirm',
                email: claims.email,
                appOrigin: claims.app ?? null,
            };
        }

        // Fails closed: a link that might have been used already is used.
        const firstUse = await checkRateLimit(
            `magic-link-used:${claims.jti}`,
            1,
            (MAGIC_LINK_TTL_SECONDS + 60) * 1000,
            undefined,
            { failOpen: false },
        );
        if (!firstUse) throw linkExpired();
        return { status: 'redeemed', claims };
    }

    /**
     * The account a redeemed link signs in, created when the address has none.
     * `signup` is what the new-account gate reads from the request.
     */
    async resolveUser(
        email: string,
        req: Request,
        signup: {
            data: Record<string, unknown>;
            fingerprint: string | null;
        },
        attempt = 0,
    ): Promise<UserRow> {
        const holder = await this.services.signup.signupEmailHolder(email, {
            force: true,
            releaseSeat: true,
        });
        if (holder) {
            if (holder.suspended) {
                throw new HttpError(401, 'This account is suspended.', {
                    legacyCode: 'account_suspended',
                });
            }
            // Whoever set an unconfirmed account's password may not own the
            // inbox, and signing the inbox's owner in would share it with them.
            if (!holder.email_confirmed) {
                throw new HttpError(
                    400,
                    'An account with this email exists but the email is not yet confirmed. Please sign in with your password to confirm it first.',
                    { legacyCode: 'email_unconfirmed' },
                );
            }
            return holder;
        }

        const outcome = await this.services.signup.signupVerifiedEmail({
            req,
            source: 'magic_link',
            email,
            data: signup.data,
            fingerprint: signup.fingerprint,
        });
        if (outcome.raced && attempt === 0) {
            return this.resolveUser(email, req, signup, attempt + 1);
        }
        if (!outcome.success || !outcome.user) {
            throw new HttpError(
                403,
                (outcome.error ?? 'Signup blocked') +
                    (outcome.requestCode
                        ? ` Request Code: ${outcome.requestCode}`
                        : ''),
                { legacyCode: 'signup_blocked' },
            );
        }
        this.services.signup.announceSignup(outcome.user, {
            ip: signupClientIp(req),
            bonusCode: null,
            fingerprint: signup.fingerprint,
            emailConfirmed: true,
            saveAccount: true,
        });
        return outcome.user;
    }
}
