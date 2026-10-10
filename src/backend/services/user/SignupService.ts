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

import bcrypt from 'bcrypt';
import type { Request } from 'express';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { EventMetadata } from '../../clients/event/types.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { isOwnedEmailConflict } from '../../stores/user/UserStore.js';
import { cleanEmail, isBlockedEmail } from '../../util/email.js';
import {
    bonusCodeInvalidError,
    checkSignupBonus,
    validateSignupBonus,
} from '../../util/signupBonus.js';
import { isUsernameTaken } from '../../util/username.js';
import {
    generateDefaultFsentries,
    promoteToVerifiedGroup,
    provisionUser,
} from '../../util/userProvisioning.js';
import { PuterService } from '../types.js';

/** What `puter.signup.validate` and the bonus hooks decided about a signup. */
export type SignupGateOutcome =
    | {
          verdict: 'allowed';
          reputation: number | null;
          requiresEmailConfirmation: boolean;
          requiresPhoneVerification: boolean;
          requiresCardVerification: boolean;
      }
    | { verdict: 'bonus_code_invalid' }
    | {
          verdict: 'blocked' | 'no_temp_user';
          message: string | null;
          code: string | null;
          requestCode?: string;
      };

export interface SignupGateInput {
    req: Request;
    /** Set for signups that did not come through the signup form. */
    source?: 'oidc';
    data: Record<string, unknown>;
    email: string;
    isTemp: boolean;
    /** Omitted by sources that never collect one. */
    fingerprint?: string | null;
    bonusCode: string | null;
}

export interface SignupInput {
    req: Request;
    /** The request body as the validate hook sees it, temp defaults filled. */
    body: Record<string, unknown> & {
        username: string;
        email: string;
        password: string;
    };
    isTemp: boolean;
    fingerprint: string | null;
    bonusCode: string | null;
}

/** The trusted client address; `req.ip` honors `trust proxy`. */
export const signupClientIp = (req: Request): string | null =>
    req.ip || req.socket?.remoteAddress || null;

/**
 * Account creation for every signup route (form, temp, OIDC). Callers parse
 * requests and set cookies; the steps and the events listeners rely on live
 * here.
 */
export class SignupService extends PuterService {
    /**
     * Config blocklist (suffix match on the cleaned address), then the
     * `email.validate` hook. Throws 400 on rejection.
     */
    async validateEmail(email: string): Promise<void> {
        if (isBlockedEmail(email, this.config.blockedEmailDomains)) {
            throw new HttpError(400, 'This email is not allowed.', {
                legacyCode: 'email_not_allowed' as never,
            });
        }

        const validateEvent: {
            email: string;
            allow: boolean;
            message: string | null;
        } = {
            email: cleanEmail(email),
            allow: true,
            message: null,
        };
        // A gate that did not run is not a pass.
        const meta: EventMetadata = {};
        try {
            await this.clients.event?.emitAndWait(
                'email.validate',
                validateEvent,
                meta,
            );
        } catch (e) {
            console.warn('[email-validate] hook failed:', e);
            meta.listener_failed = true;
        }
        if (meta.listener_failed || !validateEvent.allow) {
            throw new HttpError(
                400,
                validateEvent.message ??
                    'This email cannot be used. Please try a different email address.',
                { legacyCode: 'bad_request' },
            );
        }
    }

    /**
     * The extension-owned verdict on a signup: a dead bonus code is refused
     * first (before `puter.signup.validate` records the attempt), then the
     * validate hook, then the bonus code's own requirements.
     */
    async runSignupGate(input: SignupGateInput): Promise<SignupGateOutcome> {
        const { req, email, isTemp, bonusCode } = input;
        const clientIp = signupClientIp(req);
        const fingerprint = input.fingerprint ?? null;

        if (
            bonusCode &&
            !(
                await checkSignupBonus(this.clients.event, bonusCode, {
                    ip: clientIp,
                    fingerprint,
                })
            ).valid
        ) {
            return { verdict: 'bonus_code_invalid' };
        }

        // Listeners can block (`allow = false`), require email/phone/card
        // verification, or refuse temp accounts (`no_temp_user`). They run
        // sequentially so multi-signal checks can short-circuit.
        const validateEvent = {
            req,
            ...(input.source ? { source: input.source } : {}),
            data: input.data,
            ip: clientIp,
            user_agent: req?.headers?.['user-agent'] ?? null,
            email,
            // The form `email.validate` was given, so the abuse harness can
            // find the verdict that hook cached for this address.
            clean_email: cleanEmail(email),
            // Temp signups carry a synthetic address and skip email checks.
            is_temp: isTemp,
            allow: true,
            no_temp_user: false,
            requires_email_confirmation: false,
            requires_phone_verification: false,
            requires_card_verification: false,
            message: null as string | null,
            code: null as string | null,
            ...(input.fingerprint !== undefined ? { fingerprint } : {}),
            // Signup-time reputation, persisted on the user row.
            reputation: null as number | null,
            // Keys the abuse decision trail; shown to a blocked user as the
            // Request Code.
            trail_id: undefined as string | undefined,
        };
        const validateMeta: EventMetadata = {};
        try {
            await this.clients.event?.emitAndWait(
                'puter.signup.validate',
                validateEvent,
                validateMeta,
            );
        } catch (e) {
            console.warn('[signup] validate hook failed:', e);
            validateMeta.listener_failed = true;
        }
        // A check that could not run is not a check that passed.
        if (validateMeta.listener_failed || !validateEvent.allow) {
            return {
                verdict: 'blocked',
                message: validateEvent.message,
                code: validateEvent.code,
                requestCode: validateEvent.trail_id,
            };
        }
        if (isTemp && validateEvent.no_temp_user) {
            return {
                verdict: 'no_temp_user',
                message: validateEvent.message,
                code: validateEvent.code,
            };
        }

        // The config switches force a gate on every signup (test/QA).
        let requiresPhoneVerification =
            Boolean(validateEvent.requires_phone_verification) ||
            Boolean(this.config.always_require_phone_verification);
        let requiresCardVerification =
            Boolean(validateEvent.requires_card_verification) ||
            Boolean(this.config.always_require_card_verification);

        if (bonusCode) {
            const verdict = await validateSignupBonus(
                this.clients.event,
                bonusCode,
                {
                    ...(input.source ? { source: input.source } : {}),
                    email,
                    clean_email: cleanEmail(email),
                    ip: clientIp,
                    ...(input.fingerprint !== undefined ? { fingerprint } : {}),
                    reputation: validateEvent.reputation,
                    requires_phone_verification: requiresPhoneVerification,
                    requires_card_verification: requiresCardVerification,
                },
            );
            if (!verdict.accepted) {
                return { verdict: 'bonus_code_invalid' };
            }
            requiresPhoneVerification = verdict.requiresPhoneVerification;
            requiresCardVerification = verdict.requiresCardVerification;
        }

        return {
            verdict: 'allowed',
            reputation: validateEvent.reputation,
            requiresEmailConfirmation: Boolean(
                validateEvent.requires_email_confirmation,
            ),
            requiresPhoneVerification,
            requiresCardVerification,
        };
    }

    /**
     * A form or temp signup. Returns the account to sign in; throws the 4xx a
     * refused signup answers with.
     */
    async signup(input: SignupInput): Promise<UserRow> {
        const { req, body, isTemp, fingerprint, bonusCode } = input;

        // Runs before the duplicate checks so a disabled endpoint doesn't
        // reveal which usernames or emails exist. Claiming a pre-existing
        // placeholder row is still allowed.
        if (this.config.disable_user_signup) {
            let claimable = false;
            if (!isTemp) {
                const existing = await this.stores.user.findEmailOwner(
                    body.email,
                );
                claimable = Boolean(
                    existing &&
                    !existing.email_confirmed &&
                    existing.password === null,
                );
            }
            if (!claimable) {
                throw new HttpError(403, 'User registration is disabled.', {
                    legacyCode: 'signup_disabled',
                });
            }
        }

        if (await this.stores.user.getByUsername(body.username)) {
            throw new HttpError(
                400,
                'This username already exists in our database. Please use another one.',
                { legacyCode: 'bad_request' },
            );
        }
        // A free username whose home path is occupied would provision a
        // second root there.
        if (
            await this.stores.fsEntry.findHomePathConflict(
                body.username,
                undefined,
                { includeDescendants: true },
            )
        ) {
            throw new HttpError(400, 'This username is not available.', {
                legacyCode: 'bad_request',
            });
        }

        const clientIp = signupClientIp(req);
        const proxyIpChain = req.headers['x-forwarded-for'];

        // The cheap early email check, so an obvious duplicate doesn't pay for
        // the validate hook and a bcrypt round. It runs again against the
        // primary right before the write, and the unique index catches
        // whatever still slips through.
        let pseudoUser = isTemp
            ? null
            : await this.#resolveSignupEmailClaim(body.email);

        const gate = await this.runSignupGate({
            req,
            data: body,
            email: body.email,
            isTemp,
            fingerprint,
            bonusCode,
        });
        if (gate.verdict === 'bonus_code_invalid') {
            throw bonusCodeInvalidError();
        }
        if (gate.verdict !== 'allowed') {
            // The trail id rides in the message so the existing signup-block
            // UI surfaces it as the Request Code.
            if (gate.verdict === 'blocked') {
                throw new HttpError(
                    403,
                    (gate.message ?? 'Signup blocked') +
                        (gate.requestCode
                            ? ` Request Code: ${gate.requestCode}`
                            : ''),
                    {
                        ...(gate.code
                            ? { legacyCode: gate.code as never }
                            : {}),
                    },
                );
            }
            throw new HttpError(
                403,
                gate.message ?? 'Temporary accounts are disabled',
                {
                    legacyCode: 'must_login_or_signup',
                    ...(gate.code ? { legacyCode: gate.code as never } : {}),
                },
            );
        }

        const userUuid = uuidv4();
        const emailConfirmCode = String(crypto.randomInt(100000, 1000000));
        const emailConfirmToken = uuidv4();
        const passwordHash = isTemp
            ? null
            : await bcrypt.hash(body.password, 8);
        const signupSqlTs = new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');

        // The validate hook and bcrypt take long enough for a concurrent
        // signup to take the address or claim the same placeholder row.
        if (!isTemp) {
            pseudoUser = await this.#resolveSignupEmailClaim(body.email, {
                force: true,
                releaseSeat: true,
            });
        }

        let user: UserRow;
        if (pseudoUser) {
            // Guarded: two signups that both read this row as claimable would
            // otherwise both "succeed", the second overwriting the first.
            let claimed: boolean;
            try {
                claimed = await this.stores.user.claimPlaceholder(
                    pseudoUser.id,
                    {
                        username: body.username,
                        password: passwordHash,
                        uuid: userUuid,
                        email_confirm_code: emailConfirmCode,
                        email_confirm_token: emailConfirmToken,
                        email_confirmed: 0,
                        requires_email_confirmation: 1,
                        last_activity_ts: signupSqlTs,
                        ...(gate.reputation != null
                            ? { reputation: gate.reputation }
                            : {}),
                        requires_phone_verification:
                            gate.requiresPhoneVerification ? 1 : 0,
                        requires_card_verification:
                            gate.requiresCardVerification ? 1 : 0,
                    },
                );
            } catch (e) {
                if (
                    await isUsernameTaken(
                        this.stores.user,
                        e,
                        body.username,
                        pseudoUser.id,
                    )
                ) {
                    throw new HttpError(
                        400,
                        'This username already exists in our database. Please use another one.',
                        { legacyCode: 'bad_request' },
                    );
                }
                throw e;
            }
            if (!claimed) {
                throw new HttpError(
                    400,
                    'This email already exists in our database. Please use another one.',
                    { legacyCode: 'bad_request' },
                );
            }
            await promoteToVerifiedGroup(this.stores.group, this.config, {
                ...pseudoUser,
                username: body.username,
            });
            user = (await this.stores.user.getById(pseudoUser.id, {
                force: true,
            }))!;
            // Skipped when an earlier signup already gave the row its folders.
            try {
                await generateDefaultFsentries(
                    this.clients.db,
                    this.stores.user,
                    user,
                );
            } catch (e) {
                console.warn('[signup] generateDefaultFsentries failed:', e);
            }
        } else {
            try {
                user = await provisionUser(
                    {
                        db: this.clients.db,
                        userStore: this.stores.user,
                        groupStore: this.stores.group,
                    },
                    {
                        username: body.username,
                        uuid: userUuid,
                        password: passwordHash,
                        email: isTemp ? null : body.email,
                        clean_email: isTemp ? null : cleanEmail(body.email),
                        free_storage: this.config.storage_capacity ?? null,
                        requires_email_confirmation:
                            !isTemp || gate.requiresEmailConfirmation,
                        email_confirm_code: emailConfirmCode,
                        email_confirm_token: emailConfirmToken,
                        audit_metadata: {
                            ip: clientIp,
                            ip_fwd: proxyIpChain,
                            user_agent: req.headers?.['user-agent'],
                            origin: req.headers?.origin,
                            fingerprint,
                        },
                        signup_ip: clientIp,
                        // The abuse harness and the admin IP lookup key on this
                        // column; the raw chain stays in `audit_metadata`.
                        signup_ip_forwarded: clientIp,
                        signup_user_agent: req.headers?.['user-agent'] ?? null,
                        signup_origin:
                            (req.headers?.origin as string | null) ?? null,
                        signup_server: this.config.serverId,
                        referrer: (body.referrer as string | null) ?? null,
                        last_activity_ts: signupSqlTs,
                        reputation: gate.reputation,
                        // Collected later in the verification dialog.
                        phone: null,
                        requires_phone_verification:
                            gate.requiresPhoneVerification,
                        requires_card_verification:
                            gate.requiresCardVerification,
                    },
                    isTemp
                        ? this.config.default_temp_group
                        : this.config.default_user_group,
                );
            } catch (e) {
                // Lost the race between the re-check above and the insert.
                if (isOwnedEmailConflict(e)) {
                    throw new HttpError(
                        400,
                        'This email already exists in our database. Please use another one.',
                        { legacyCode: 'bad_request' },
                    );
                }
                if (await isUsernameTaken(this.stores.user, e, body.username)) {
                    throw new HttpError(
                        400,
                        'This username already exists in our database. Please use another one.',
                        { legacyCode: 'bad_request' },
                    );
                }
                throw e;
            }
        }

        if (!isTemp && user.requires_email_confirmation) {
            await this.sendConfirmationEmail(
                user,
                'signup',
                (body.send_confirmation_code ?? true)
                    ? { code: emailConfirmCode }
                    : { token: emailConfirmToken },
            );
        }

        this.announceSignup(user, {
            ip: clientIp,
            bonusCode,
            fingerprint,
            // The created/claimed row: a claimed placeholder has credentials.
            isTemp: user.password === null && user.email === null,
            saveAccount: !isTemp,
        });
        return user;
    }

    /**
     * Signup events, keyed the same for every signup route so welcome mail,
     * mailing-list sync and the abuse counters treat them alike. Best-effort.
     */
    announceSignup(
        user: UserRow,
        opts: {
            ip: string | null;
            bonusCode: string | null;
            /** Omitted by sources that never collect one. */
            fingerprint?: string | null;
            isTemp?: boolean;
            /** The provider verified the address, so this is its confirmation. */
            emailConfirmed?: boolean;
            saveAccount: boolean;
        },
    ): void {
        if (opts.emailConfirmed) this.#emitEmailConfirmed(user);
        try {
            this.clients.event?.emit(
                'puter.signup.success',
                {
                    user_id: user.id,
                    user_uuid: user.uuid,
                    email: user.email as string,
                    username: user.username,
                    ...(opts.fingerprint !== undefined
                        ? { fingerprint: opts.fingerprint }
                        : {}),
                    ...(opts.isTemp !== undefined
                        ? { is_temp: opts.isTemp }
                        : {}),
                    // Must match the validate event's address, or per-IP
                    // counters are written under one key and read under another.
                    ip: opts.ip,
                    ...(opts.bonusCode ? { bonus_code: opts.bonusCode } : {}),
                },
                {},
            );
        } catch {
            // ignore — event emission shouldn't block signup
        }
        if (!opts.saveAccount) return;
        try {
            this.clients.event?.emit(
                'user.save_account',
                { user_id: user.id },
                {},
            );
        } catch {
            // ignore
        }
    }

    /**
     * Send the confirmation code (or link) for the account's address. A lost
     * message is alarmed rather than thrown: the account exists either way.
     */
    async sendConfirmationEmail(
        user: UserRow,
        stage: 'signup' | 'resend',
        message: { code: string } | { token: string },
    ): Promise<void> {
        if (!this.clients.email || !user.email) return;
        try {
            const sent =
                'code' in message
                    ? await this.clients.email.send(
                          user.email,
                          'email_verification_code',
                          { code: message.code },
                      )
                    : await this.clients.email.send(
                          user.email,
                          'email_verification_link',
                          {
                              link: `${this.config.origin ?? ''}/confirm-email-by-token?token=${message.token}&user_uuid=${user.uuid}`,
                          },
                      );
            // `null` = dropped for want of a transport; silent otherwise.
            if (sent === null) this.#confirmationEmailFailed(stage, user, null);
        } catch (e) {
            this.#confirmationEmailFailed(stage, user, e);
        }
    }

    /**
     * The account holding `email` that a signup has to contend with. A seat
     * whose address its team typed and nobody confirmed doesn't count; with
     * `releaseSeat` the seat gives the address up so the signup can take it.
     */
    async signupEmailHolder(
        email: string,
        opts: { force?: boolean; releaseSeat?: boolean } = {},
    ): Promise<UserRow | null> {
        let force = opts.force;
        for (;;) {
            const holder = await this.stores.user.findEmailOwner(email, {
                force,
            });
            if (!holder || holder.email_confirmed) return holder;
            if (!(await this.stores.team.getOrgSeat(holder.id))) return holder;
            if (!opts.releaseSeat) return null;
            if (
                !(await this.services.team.releaseUnconfirmedSeatEmail(
                    holder.id,
                ))
            )
                return holder;
            force = true;
        }
    }

    /**
     * Decide whether a signup may take `email`, and hand back the placeholder
     * row it should convert instead of inserting a new one. Throws when a live
     * account owns the address.
     */
    async #resolveSignupEmailClaim(
        email: string,
        opts: { force?: boolean; releaseSeat?: boolean } = {},
    ): Promise<UserRow | null> {
        const existing = await this.signupEmailHolder(email, opts);
        if (!existing) return null;
        // A provisioned account looks exactly like a claimable placeholder,
        // but claiming it hands a stranger that team's membership.
        const orgSeat = await this.stores.team.getOrgSeat(existing.id);
        if (
            existing.email_confirmed ||
            existing.password !== null ||
            orgSeat !== null
        ) {
            throw new HttpError(
                400,
                'This email already exists in our database. Please use another one.',
                { legacyCode: 'bad_request' },
            );
        }
        return existing;
    }

    #emitEmailConfirmed(user: UserRow): void {
        try {
            this.clients.event?.emit(
                'user.email-confirmed',
                {
                    user_id: user.id,
                    user_uid: user.uuid,
                    email: user.email as string,
                },
                {},
            );
        } catch {
            // ignore — a side-channel signal, not load-bearing
        }
    }

    /**
     * Alarm on a confirmation email that did not reach the recipient: a
     * `requires_email_confirmation` account can't be used until it does. `cause
     * === null` is the silent no-transport drop. `sole_gate` reports that no
     * phone/card gate is outstanding either.
     */
    #confirmationEmailFailed(
        stage: 'signup' | 'resend',
        user: UserRow,
        cause: unknown,
    ): void {
        const email = user.email ?? null;
        const detail =
            cause instanceof Error
                ? cause.message
                : cause === null
                  ? 'no transport configured (message dropped)'
                  : String(cause);
        console.warn(
            `[${stage === 'signup' ? 'signup' : 'send-confirm-email'}] ` +
                `confirmation email not delivered: ${detail}`,
        );
        // Best-effort: failing to alarm must not fail the signup.
        try {
            this.clients.alarm?.create(
                `auth:confirmation-email-send-failed:${stage}`,
                'Confirmation email could not be sent — gated accounts cannot be used until it arrives',
                {
                    stage,
                    user_uid: user.uuid ?? null,
                    username: user.username ?? null,
                    email,
                    email_domain: email?.split('@')[1] ?? null,
                    sole_gate:
                        !user.requires_phone_verification &&
                        !user.requires_card_verification,
                    detail,
                    ...(cause instanceof Error ? { error: cause } : {}),
                },
                'warning',
                { dedup: true },
            );
        } catch (e) {
            console.warn(`[${stage}] confirmation-email alarm failed:`, e);
        }
    }
}
