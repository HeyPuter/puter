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

import type { Request } from 'express';
import { randomInt } from 'node:crypto';
import type {
    EventMap,
    EventMetadata,
    SignInMethod,
} from '../../clients/event/types.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    hasVerifiedCard,
    hasVerifiedPhone,
} from '../../core/http/middleware/gates.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { claimOnce } from '../../util/kvClaim.js';
import {
    lookupPasswordRange,
    passwordRange,
    type PasswordRange,
} from '../../util/pwnedPasswords.js';
import {
    passwordTag,
    toUnixSeconds,
    withoutSecrets,
} from '../../util/userDetails.js';
import { PuterService } from '../types.js';
import { signupClientIp } from '../user/SignupService.js';

const DAY_SECONDS = 24 * 60 * 60;
const DEFAULT_DORMANT_DAYS = 180;
const NEW_SIGN_IN_NOTICE_WINDOW_SECONDS = 60 * 60;
const DEFAULT_PWNED_TIMEOUT_MS = 2000;
const PWNED_BREAKER_FAILURES = 5;
const PWNED_BREAKER_OPEN_MS = 5 * 60_000;
const EXPOSURE_NOTICE_INTERVAL_SECONDS = 30 * DAY_SECONDS;
const EXPOSURE_RECORD_TTL_SECONDS = 365 * DAY_SECONDS;
const LOG_UA_MAX = 200;

/** The request signal an edge proxy raises for a credential it knows leaked. */
export const CREDENTIAL_EXPOSED_SIGNAL = 'credential_exposed';

export type CredentialExposureSource = 'edge' | 'pwned_passwords';

export const credentialExposureKey = (userUuid: string): string =>
    `credential-exposure:${userUuid}`;

// Claimed before an exposure email; one per account per 30 days.
const exposureNoticeKey = (userUuid: string): string =>
    `credential-exposure-notice:${userUuid}`;

// Tag of the password last emailed about. No expiry: an unchanged password is
// never emailed about twice.
const exposureNotifiedKey = (userUuid: string): string =>
    `credential-exposure-notified:${userUuid}`;

// Claimed before a new sign-in email; one per account per hour.
const newSignInNoticeKey = (userUuid: string): string =>
    `signin-notice:${userUuid}`;

/** What the account's known-device record said before this sign-in. */
export interface SignInDevice {
    known: boolean;
    anyRecorded: boolean;
}

export interface SignInInput {
    req: Request;
    user: UserRow;
    /** `signup` covers every sign-in `/signup` or a new OIDC account makes. */
    method: SignInMethod | 'signup';
    /** Started by the caller before the sign-in; null when unknowable. */
    device: Promise<SignInDevice | null>;
    /** Mint the session and record the device. Runs once the sign-in is allowed. */
    openSession: (
        user: UserRow,
    ) => Promise<{ sessionUuid: string; guiToken: string }>;
    /** Run `task` once the response has gone out. */
    afterResponse: (task: () => Promise<void>) => void;
}

export interface SignInResult {
    guiToken: string;
    /** The row with any verification gate this sign-in set. */
    user: UserRow;
}

interface ExposureRecord {
    detectedAt: number;
    sources: CredentialExposureSource[];
    passwordTag: string | null;
}

// What a sign-in listener decides; undone if it then throws.
const ATTEMPT_OUTPUTS = ['allow', 'message', 'code', 'trail_id'] as const;
const VALIDATE_OUTPUTS = [
    ...ATTEMPT_OUTPUTS,
    'requires_phone_verification',
    'requires_card_verification',
] as const;

/**
 * A sign-in a `puter.signin.attempt` or `.validate` listener refused; nothing
 * was minted.
 */
export class SignInRefusedError extends HttpError {
    readonly requestCode: string | undefined;

    constructor(message: string, code: string, requestCode?: string) {
        // The Request Code rides in the message, as a blocked signup's does.
        super(
            403,
            requestCode ? `${message} Request Code: ${requestCode}` : message,
            {
                legacyCode: code,
                ...(requestCode
                    ? { fields: { request_code: requestCode } }
                    : {}),
            },
        );
        this.requestCode = requestCode;
    }
}

// Credentials in a sign-in body that listeners have no use for.
const CREDENTIAL_FIELDS = new Set([
    'password',
    'code',
    'token',
    'reauth_token',
    'otp_jwt_token',
]);

const requestData = (
    req: Request,
    method: SignInMethod,
): Record<string, unknown> => {
    const body: unknown = req.body;
    // An OIDC callback body is the provider's authorization response.
    if (method === 'oidc' || !body || typeof body !== 'object') return {};
    return Object.fromEntries(
        Object.entries(body).filter(([key]) => !CREDENTIAL_FIELDS.has(key)),
    );
};

const refusalOf = (decision: {
    message: unknown;
    code: unknown;
    trail_id: unknown;
}): SignInRefusedError =>
    new SignInRefusedError(
        typeof decision.message === 'string' && decision.message
            ? decision.message
            : 'This sign-in was blocked.',
        typeof decision.code === 'string' && decision.code
            ? decision.code
            : 'signin_blocked',
        typeof decision.trail_id === 'string' && decision.trail_id
            ? decision.trail_id
            : undefined,
    );

/** What the sign-in events report about the request. */
const requestFacts = (req: Request) => ({
    ip: signupClientIp(req),
    userAgent:
        typeof req.headers?.['user-agent'] === 'string'
            ? req.headers['user-agent']
            : null,
    tlsFingerprint: req.tlsFingerprint ?? null,
    fingerprint: req.deviceFingerprint ?? null,
});

interface AccountFacts {
    isOrgSeat: boolean;
    oidcLinked: boolean;
}

const NO_ACCOUNT_FACTS: AccountFacts = { isOrgSeat: false, oidcLinked: false };

// Read once per request and account, so `/login` can issue the reads beside
// its password check rather than before the session.
const accountFactReads = new WeakMap<
    Request,
    Map<string, Promise<AccountFacts>>
>();

const isTemporaryAccount = (user: UserRow): boolean =>
    (user.password ?? null) === null && (user.email ?? null) === null;

// An account with no recorded activity counts from its signup.
const daysSinceActivity = (
    user: UserRow,
    nowSeconds: number,
): number | null => {
    const last =
        toUnixSeconds(user.last_activity_ts) ?? toUnixSeconds(user.timestamp);
    if (last === undefined) return null;
    return Math.max(0, Math.floor((nowSeconds - last) / DAY_SECONDS));
};

// Quotes and control characters would let a header forge log fields.
const forLog = (value: string): string =>
    value.replace(/["\\\u0000-\u001f\u007f]/g, ' ').slice(0, LOG_UA_MAX);

/** "Chrome 131 on Mac OS 10.15.7", else the trimmed header. */
const describeDevice = (req: Request, userAgent: string | null): string => {
    const ua = req.ua;
    const browser = [ua?.browser.name, ua?.browser.major]
        .filter(Boolean)
        .join(' ');
    const os = [ua?.os.name, ua?.os.version].filter(Boolean).join(' ');
    if (browser && os) return `${browser} on ${os}`;
    if (browser || os) return browser || os;
    return userAgent ? userAgent.slice(0, 120) : 'Unknown device';
};

/**
 * The bookkeeping of every interactive sign-in (password, second factor, OIDC,
 * signup's auto sign-in) and the credential-exposure checks a verified password
 * triggers.
 */
export class SignInService extends PuterService {
    #pwnedFailures = 0;
    #pwnedSkipUntil = 0;

    /**
     * Run a sign-in: validate it with listeners, set the verification gates it
     * earns, open its session, then log it, announce it and notify the owner.
     * Throws {@link SignInRefusedError} when a listener refuses it.
     */
    async signIn(input: SignInInput): Promise<SignInResult> {
        const { req, method } = input;
        let user = input.user;
        const { ip, userAgent, tlsFingerprint, fingerprint } =
            requestFacts(req);
        const isTemp = isTemporaryAccount(user);

        // A signup's sign-in has nothing to validate and no history.
        const signInMethod = method === 'signup' ? null : method;
        const { dormantDays, inactive } = signInMethod
            ? this.#inactivity(user)
            : { dormantDays: null, inactive: false };
        const validating = signInMethod !== null && this.#validating();

        // Only listeners and a dormant sign-in need these, so the common
        // sign-in pays for none of them.
        const [facts, earlyDevice] = await Promise.all([
            signInMethod
                ? this.#accountFacts(req, user, signInMethod)
                : NO_ACCOUNT_FACTS,
            validating ? input.device : null,
        ]);
        const isDormant = inactive && !facts.isOrgSeat;

        let requiresPhone = false;
        let requiresCard = false;
        if (validating && signInMethod) {
            const event: EventMap['puter.signin.validate'] = {
                req,
                // A copy, so no listener edits the row written below.
                user: withoutSecrets(user),
                method: signInMethod,
                ip,
                user_agent: userAgent,
                tls_fingerprint: tlsFingerprint,
                fingerprint,
                data: requestData(req, signInMethod),
                dormant_days: dormantDays,
                is_dormant: isDormant,
                known_device: earlyDevice?.known ?? false,
                credential_exposed:
                    req.requestSignals?.includes(CREDENTIAL_EXPOSED_SIGNAL) ??
                    false,
                account: {
                    has_verified_phone: hasVerifiedPhone(user),
                    has_verified_card: hasVerifiedCard(user),
                    otp_enabled: Boolean(user.otp_enabled),
                    oidc_linked: facts.oidcLinked,
                    email_confirmed: Boolean(user.email_confirmed),
                    is_org_seat: facts.isOrgSeat,
                    is_temp: isTemp,
                },
                allow: true,
                message: null,
                code: null,
                requires_phone_verification: false,
                requires_card_verification: false,
                trail_id: undefined,
            };
            await this.#decide(
                'puter.signin.validate',
                event,
                VALIDATE_OUTPUTS,
                `validate listener failed user=${user.uuid}`,
            );
            requiresPhone = event.requires_phone_verification === true;
            requiresCard = event.requires_card_verification === true;
        }

        // A dormant account proves its address again before it can be used,
        // unless no mail transport is configured and the code could never arrive.
        const emailCode =
            isDormant &&
            user.email &&
            !user.email_confirmed &&
            this.config.email
                ? String(randomInt(100000, 1000000))
                : null;
        user = await this.#setGates(user, {
            requiresPhone,
            requiresCard,
            emailCode,
        });

        const { sessionUuid, guiToken } = await input.openSession(user);
        const device = earlyDevice ?? (await input.device);
        const knownDevice = device?.known ?? false;

        console.log(
            `[auth] sign-in user=${user.uuid} method=${method} ip=${ip ?? '-'} ` +
                `tls=${tlsFingerprint ?? '-'} known_device=${knownDevice ? 1 : 0} ` +
                `dormant_days=${dormantDays ?? '-'} ua="${forLog(userAgent ?? '')}"`,
        );
        this.clients.event?.emit(
            'puter.signin',
            {
                user_id: user.id,
                user_uuid: user.uuid,
                username: user.username,
                method,
                ip,
                user_agent: userAgent,
                tls_fingerprint: tlsFingerprint,
                fingerprint,
                dormant_days: dormantDays,
                is_dormant: isDormant,
                known_device: knownDevice,
                session_uuid: sessionUuid,
            },
            {},
        );

        if (emailCode) {
            const gated = user;
            input.afterResponse(async () => {
                await this.services.signup.sendConfirmationEmail(
                    gated,
                    'sign-in',
                    { code: emailCode },
                );
            });
        }
        const newDevice = Boolean(
            device && !device.known && device.anyRecorded,
        );
        if (method !== 'signup' && user.email && (newDevice || isDormant)) {
            const signedIn = user;
            input.afterResponse(() =>
                this.#sendNewSignInNotice(req, signedIn, { ip, userAgent }),
            );
        }
        return { guiToken, user };
    }

    /**
     * Ask `puter.signin.attempt` listeners about a password sign-in before its
     * account is looked up, so a refusal reads the same for every account.
     * Throws {@link SignInRefusedError} when one refuses; one that fails has no
     * opinion.
     */
    async checkAttempt(req: Request): Promise<void> {
        if (!this.clients.event?.hasListeners('puter.signin.attempt')) return;
        const { ip, userAgent, tlsFingerprint, fingerprint } =
            requestFacts(req);
        const event: EventMap['puter.signin.attempt'] = {
            req,
            ip,
            user_agent: userAgent,
            tls_fingerprint: tlsFingerprint,
            fingerprint,
            data: requestData(req, 'password'),
            allow: true,
            message: null,
            code: null,
            trail_id: undefined,
        };
        await this.#decide(
            'puter.signin.attempt',
            event,
            ATTEMPT_OUTPUTS,
            `attempt listener failed ip=${ip ?? '-'}`,
        );
    }

    /**
     * Start the account reads this sign-in's checks will need, so the caller
     * can issue them beside its own first step.
     */
    preloadAccountFacts(
        req: Request,
        user: UserRow,
        method: SignInMethod,
    ): void {
        void this.#accountFacts(req, user, method);
    }

    /**
     * Derive what the exposure checks need from a password that just verified,
     * so the plaintext stays with the caller. Returns the check to run once the
     * response is out, or null when none applies.
     */
    prepareCredentialCheck(
        req: Request,
        user: UserRow,
        password: string,
    ): (() => Promise<void>) | null {
        const flagged =
            req.requestSignals?.includes(CREDENTIAL_EXPOSED_SIGNAL) ?? false;
        const range =
            this.config.pwnedPasswords?.enabled === true
                ? passwordRange(password)
                : null;
        if (!flagged && !range) return null;
        return async () => {
            const sources: CredentialExposureSource[] = flagged ? ['edge'] : [];
            if (range && (await this.#isPwned(range))) {
                sources.push('pwned_passwords');
            }
            if (sources.length > 0) {
                await this.recordCredentialExposure(user, sources);
            }
        };
    }

    /**
     * Record that the account's current password is exposed. The owner is
     * emailed at most once per password and once per 30 days, however many
     * sources report it; the notice is claimed before it is sent. Never blocks
     * a sign-in.
     */
    async recordCredentialExposure(
        user: UserRow,
        sources: CredentialExposureSource[],
    ): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        const tag = passwordTag(user);

        let notified = false;
        if (
            this.clients.email &&
            user.email &&
            (await this.#claimExposureNotice(user, tag))
        ) {
            try {
                const origin = this.config.origin ?? '';
                notified =
                    (await this.clients.email.send(
                        user.email,
                        'credential_exposure_notification',
                        {
                            username: user.username,
                            security_link: `${origin}/dashboard#security`,
                        },
                        { stream: 'auth' },
                    )) !== null;
            } catch (e) {
                console.warn('[auth] credential exposure notice failed:', e);
            }
        }

        const record: ExposureRecord = {
            detectedAt: now,
            sources,
            passwordTag: tag,
        };
        try {
            await this.stores.kv.set({
                key: credentialExposureKey(user.uuid),
                value: record,
                expireAt: now + EXPOSURE_RECORD_TTL_SECONDS,
            });
        } catch (e) {
            console.warn('[auth] credential exposure record failed:', e);
        }

        console.log(
            `[auth] credential exposed user=${user.uuid} source=${sources.join(',')} notified=${notified ? 1 : 0}`,
        );
        if (sources.includes('edge')) {
            try {
                this.clients.alarm?.create(
                    `auth:credential-exposed:${user.uuid}`,
                    'Sign-in with a password the edge proxy reports as exposed',
                    { username: user.username, user_uuid: user.uuid },
                    'critical',
                    { dedup: true },
                );
            } catch (e) {
                console.warn('[auth] credential exposure alarm failed:', e);
            }
        }
        for (const source of sources) {
            this.clients.event?.emit(
                'puter.signin.credential_exposed',
                {
                    user_id: user.id,
                    user_uuid: user.uuid,
                    username: user.username,
                    source,
                    notified,
                },
                {},
            );
        }
    }

    /**
     * Whether this sign-in may email the owner about an exposed password: not
     * yet emailed about this one, and it wins the account's 30-day claim. The
     * password is marked emailed before anything is sent, so a send that fails
     * is not retried; anything unreadable sends nothing.
     */
    async #claimExposureNotice(
        user: UserRow,
        tag: string | null,
    ): Promise<boolean> {
        try {
            const { res } = await this.stores.kv.get({
                key: exposureNotifiedKey(user.uuid),
            });
            if (tag !== null && res === tag) return false;
        } catch (e) {
            console.warn('[auth] credential exposure marker unreadable:', e);
            return false;
        }
        const claimed = await claimOnce(
            this.stores.kv,
            exposureNoticeKey(user.uuid),
            EXPOSURE_NOTICE_INTERVAL_SECONDS,
        );
        if (!claimed || tag === null) return claimed;
        try {
            await this.stores.kv.set({
                key: exposureNotifiedKey(user.uuid),
                value: tag,
            });
            return true;
        } catch (e) {
            console.warn('[auth] credential exposure marker failed:', e);
            return false;
        }
    }

    /**
     * Range lookup with an in-process breaker: after repeated failures it skips
     * lookups for a while. Fails open.
     */
    async #isPwned(range: PasswordRange): Promise<boolean> {
        if (Date.now() < this.#pwnedSkipUntil) return false;
        const result = await lookupPasswordRange(
            range,
            this.config.pwnedPasswords?.timeoutMs ?? DEFAULT_PWNED_TIMEOUT_MS,
        );
        if ('hit' in result) {
            this.#pwnedFailures = 0;
            return result.hit;
        }
        this.#pwnedFailures++;
        console.warn(`[auth] pwned-passwords lookup failed: ${result.failed}`);
        if (this.#pwnedFailures >= PWNED_BREAKER_FAILURES) {
            this.#pwnedFailures = 0;
            this.#pwnedSkipUntil = Date.now() + PWNED_BREAKER_OPEN_MS;
            console.warn('[auth] pwned-passwords lookups paused');
        }
        return false;
    }

    #validating(): boolean {
        return (
            this.clients.event?.hasListeners('puter.signin.validate') ?? false
        );
    }

    #inactivity(user: UserRow): {
        dormantDays: number | null;
        inactive: boolean;
    } {
        const dormantDays = daysSinceActivity(
            user,
            Math.floor(Date.now() / 1000),
        );
        const threshold = this.config.dormantSignInDays ?? DEFAULT_DORMANT_DAYS;
        return {
            dormantDays,
            inactive:
                !isTemporaryAccount(user) &&
                threshold > 0 &&
                dormantDays !== null &&
                dormantDays >= threshold,
        };
    }

    // The seat and OIDC-link reads, only when a listener or a dormant sign-in
    // needs them. Never rejects.
    #accountFacts(
        req: Request,
        user: UserRow,
        method: SignInMethod,
    ): Promise<AccountFacts> {
        let reads = accountFactReads.get(req);
        if (!reads) {
            reads = new Map();
            accountFactReads.set(req, reads);
        }
        let read = reads.get(user.uuid);
        if (!read) {
            const validating = this.#validating();
            const { inactive } = this.#inactivity(user);
            read = (async () => {
                const [isOrgSeat, oidcLinked] = await Promise.all([
                    validating || inactive ? this.#isOrgSeat(user) : false,
                    validating ? this.#hasOidcLink(user, method) : false,
                ]);
                return { isOrgSeat, oidcLinked };
            })();
            reads.set(user.uuid, read);
        }
        return read;
    }

    /**
     * Run a sign-in event's listeners and throw their refusal. A listener that
     * fails has no opinion: its outputs are undone, the others count.
     */
    async #decide<K extends 'puter.signin.attempt' | 'puter.signin.validate'>(
        key: K,
        event: EventMap[K],
        outputs: readonly string[],
        failureLog: string,
    ): Promise<void> {
        const meta: EventMetadata = {};
        try {
            await this.clients.event.emitAndWait(key, event, meta, {
                revertOnFailure: outputs,
            });
        } catch (e) {
            meta.listener_failed = true;
            console.warn(`[auth] ${key} hook failed:`, e);
        }
        if (meta.listener_failed) console.warn(`[auth] sign-in ${failureLog}`);
        if (event.allow === false) throw refusalOf(event);
    }

    // Seats are provisioned by a team, which answers for them. An unreadable
    // seat counts as one, so a failing store never gates an account.
    async #isOrgSeat(user: UserRow): Promise<boolean> {
        try {
            return Boolean(await this.stores.team?.getOrgSeat(user.id));
        } catch (e) {
            console.warn('[auth] seat lookup failed at sign-in:', e);
            return true;
        }
    }

    async #hasOidcLink(user: UserRow, method: SignInMethod): Promise<boolean> {
        if (method === 'oidc') return true;
        try {
            const links = await this.stores.oidc.listByUserId(user.id);
            return Array.isArray(links) && links.length > 0;
        } catch (e) {
            console.warn('[auth] OIDC link lookup failed at sign-in:', e);
            return false;
        }
    }

    /** Set (never clear) the gates this sign-in earned; one write, or none. */
    async #setGates(
        user: UserRow,
        gates: {
            requiresPhone: boolean;
            requiresCard: boolean;
            emailCode: string | null;
        },
    ): Promise<UserRow> {
        const patch: Record<string, unknown> = {};
        if (gates.requiresPhone && !user.requires_phone_verification) {
            patch.requires_phone_verification = true;
        }
        if (gates.requiresCard && !user.requires_card_verification) {
            patch.requires_card_verification = true;
        }
        if (gates.emailCode) {
            if (!user.requires_email_confirmation) {
                patch.requires_email_confirmation = true;
            }
            patch.email_confirm_code = gates.emailCode;
        }
        if (Object.keys(patch).length === 0) return user;
        await this.stores.user.update(user.id, patch);
        return { ...user, ...patch };
    }

    async #sendNewSignInNotice(
        req: Request,
        user: UserRow,
        { ip, userAgent }: { ip: string | null; userAgent: string | null },
    ): Promise<void> {
        if (!this.clients.email || !user.email) return;
        const claimed = await claimOnce(
            this.stores.kv,
            newSignInNoticeKey(user.uuid),
            NEW_SIGN_IN_NOTICE_WINDOW_SECONDS,
        );
        if (!claimed) return;
        try {
            const origin = this.config.origin ?? '';
            await this.clients.email.send(
                user.email,
                'new_sign_in_notification',
                {
                    username: user.username,
                    time: `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
                    ip: ip ?? 'unknown',
                    device: describeDevice(req, userAgent),
                    security_link: `${origin}/dashboard#security`,
                    reset_link: `${origin}/action/password-recovery`,
                },
                { stream: 'auth' },
            );
        } catch (e) {
            console.warn('[auth] new sign-in notice failed:', e);
        }
    }
}
