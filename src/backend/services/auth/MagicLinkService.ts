import type { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import validator from 'validator';
import { HttpError } from '../../core/http/HttpError.js';
import type { LayerInstances } from '../../types';
import type { puterServices } from '../index';
import type { UserRow } from '../../stores/user/UserStore';
import { isOwnedEmailConflict } from '../../stores/user/UserStore.js';
import { PuterService } from '../types';
import { cleanEmail, isBlockedEmail } from '../../util/email.js';
import { generate_identifier } from '../../util/identifier.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';

const TOKEN_SCOPE = 'magic-link';
const TOKEN_PURPOSE = 'magic-link';
/** How long an emailed link stays valid. */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
/** How long a consumed link's app token waits for the landing page. */
export const MAGIC_LINK_PICKUP_TTL_SECONDS = 2 * 60;

/** Error codes the consume page may surface in a redirect. */
export const MAGIC_LINK_ERRORS = [
    'link_expired',
    'account_suspended',
    'signup_blocked',
    'unauthorized',
] as const;
export type MagicLinkError = (typeof MAGIC_LINK_ERRORS)[number];

interface LinkClaims {
    purpose: string;
    jti: string;
    email: string;
    /**
     * Lookup key the app's landing page collects its token by; minted here so
     * no client has to know it ahead of time.
     */
    session: string;
    return_url: string;
    /** The app the link signs the user in to; null when it is Puter itself. */
    opener_origin: string | null;
}

interface PickupRecord {
    token: string;
    app_uid: string;
}

export class MagicLinkFailure extends Error {
    constructor(public readonly code: MagicLinkError) {
        super(code);
    }
}

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

/**
 * Passwordless sign-in. A window on the GUI origin asks for a link, the user
 * clicks it in their inbox, and the consume page signs them in. The window that
 * asked is abandoned: the sign-in continues on the tab the link opens. Asked
 * for by a third-party site's popup, the link also mints that opener's app
 * token, parks it under a short-lived key, and lands the user back on the site,
 * whose page collects the token by that key. Asked for by Puter's own login
 * window, it signs the user in to Puter and lands them on the desktop. The link
 * is a signed, single-use token.
 */
export class MagicLinkService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    #requestKey(jti: string): string {
        return `magiclink:req:${jti}`;
    }

    #landingKey(session: string): string {
        return `magiclink:landing:${session}`;
    }

    // -- Request ------------------------------------------------------

    /**
     * Validate a link request and email the link. Throws 400 on bad input;
     * never reveals whether the address has an account. Without a mail
     * transport the email client prints the message instead, so a dev box still
     * gets a usable link in its console.
     */
    async request(input: {
        email: unknown;
        returnUrl: unknown;
        openerOrigin: unknown;
    }): Promise<void> {
        const email = typeof input.email === 'string' ? input.email.trim() : '';
        if (!email || !validator.isEmail(email)) {
            throw new HttpError(400, 'Invalid email.', {
                legacyCode: 'bad_request',
            });
        }
        const guiOrigin = (this.config.origin ?? '').replace(/\/$/, '');
        const hasOpener =
            input.openerOrigin !== undefined &&
            input.openerOrigin !== null &&
            input.openerOrigin !== '';
        const openerOrigin = hasOpener ? parseOrigin(input.openerOrigin) : null;
        if (hasOpener && !openerOrigin) {
            throw new HttpError(
                400,
                'opener_origin must be an http(s) origin.',
                {
                    legacyCode: 'bad_request',
                },
            );
        }
        let returnUrl =
            typeof input.returnUrl === 'string' ? input.returnUrl : '';
        if (openerOrigin) {
            // The link lands the user on `return_url` with a sign-in session
            // id, so it must belong to the site that asked — never a third
            // origin.
            if (!returnUrl || parseOrigin(returnUrl) !== openerOrigin) {
                throw new HttpError(
                    400,
                    'return_url must be on the opener origin.',
                    { legacyCode: 'invalid_return_url' },
                );
            }
        } else {
            // Puter's own sign-in lands on the desktop, or on another page of
            // the GUI when one is named.
            if (!returnUrl) returnUrl = `${guiOrigin}/`;
            if (parseOrigin(returnUrl) !== guiOrigin) {
                throw new HttpError(
                    400,
                    'return_url must be on the GUI origin.',
                    { legacyCode: 'invalid_return_url' },
                );
            }
        }
        const jti = uuidv4();
        const session = uuidv4();
        const record = { session };
        await this.clients.redis.set(
            this.#requestKey(jti),
            JSON.stringify(record),
            'EX',
            MAGIC_LINK_TTL_SECONDS,
        );

        const claims: LinkClaims = {
            purpose: TOKEN_PURPOSE,
            jti,
            email,
            session,
            return_url: returnUrl,
            opener_origin: openerOrigin,
        };
        const token = this.services.token.sign(
            TOKEN_SCOPE,
            { ...claims },
            {
                expiresIn: MAGIC_LINK_TTL_SECONDS,
            },
        );
        const link = `${guiOrigin}/auth/magic-link/consume?token=${encodeURIComponent(token)}`;

        const sent = await this.clients.email.send(
            email,
            'magic_link_sign_in',
            {
                link,
                app_host: openerOrigin ? new URL(openerOrigin).host : null,
            },
        );
        if (sent === null) {
            // No transport: the email client already printed the message,
            // but the bare link is what a developer wants to copy.
            console.warn(
                `[magic-link] no email transport configured; sign-in link for ${email}: ${link}`,
            );
        }
    }

    // -- Consume ------------------------------------------------------

    /**
     * Burn the link and resolve the account it signs in. Creates the account
     * when the address is new; confirms it when it was still pending. Throws
     * `MagicLinkFailure` with a code safe to put in a redirect.
     */
    async consume(
        token: unknown,
        req: Request,
    ): Promise<{
        user: UserRow;
        claims: LinkClaims;
    }> {
        if (typeof token !== 'string' || !token) {
            throw new MagicLinkFailure('link_expired');
        }
        let claims: LinkClaims;
        try {
            claims = this.services.token.verify<LinkClaims>(TOKEN_SCOPE, token);
        } catch {
            throw new MagicLinkFailure('link_expired');
        }
        if (claims.purpose !== TOKEN_PURPOSE || !claims.jti) {
            throw new MagicLinkFailure('link_expired');
        }

        const raw = await this.clients.redis.getdel(
            this.#requestKey(claims.jti),
        );
        if (!raw) throw new MagicLinkFailure('link_expired');
        const record = JSON.parse(raw) as { session: string };
        if (record.session !== claims.session) {
            throw new MagicLinkFailure('link_expired');
        }

        const user = await this.#resolveUser(claims.email, req);
        return { user, claims };
    }

    async #resolveUser(email: string, req: Request): Promise<UserRow> {
        const existing = await this.stores.user.findEmailOwner(email, {
            force: true,
        });
        if (existing) {
            if (existing.suspended) {
                throw new MagicLinkFailure('account_suspended');
            }
            if (existing.email_confirmed) return existing;
            return this.#confirmPending(existing, email);
        }
        return this.#createUser(email, req);
    }

    /** Clicking the link proved ownership, so a pending account is confirmed. */
    async #confirmPending(user: UserRow, email: string): Promise<UserRow> {
        await this.stores.user.unconfirmOthersByEmail(
            user.id,
            email,
            cleanEmail(email),
        );
        try {
            await this.stores.user.update(user.id, {
                email_confirmed: 1,
                requires_email_confirmation: 0,
                email_confirm_code: null,
                email_confirm_token: null,
            });
        } catch (e) {
            if (!isOwnedEmailConflict(e)) throw e;
            throw new MagicLinkFailure('unauthorized');
        }
        try {
            this.clients.event?.emit(
                'user.email-confirmed',
                { user_id: user.id, user_uid: user.uuid, email },
                {},
            );
        } catch {
            // Best-effort hook.
        }
        const fresh = await this.stores.user.getById(user.id, { force: true });
        return fresh ?? user;
    }

    async #createUser(email: string, req: Request): Promise<UserRow> {
        if (this.config.disable_user_signup) {
            throw new MagicLinkFailure('signup_blocked');
        }
        if (isBlockedEmail(email, this.config.blockedEmailDomains)) {
            throw new MagicLinkFailure('unauthorized');
        }

        let username: string;
        let attempts = 0;
        do {
            username = generate_identifier();
            if (++attempts > 20) throw new MagicLinkFailure('unauthorized');
        } while (await this.stores.user.getByUsername(username));

        const clientIp = req.ip || req.socket?.remoteAddress || null;
        const userAgent = req.headers?.['user-agent'] ?? null;

        const emailEvent = {
            email: cleanEmail(email),
            allow: true,
            message: null as string | null,
        };
        try {
            await this.clients.event?.emitAndWait(
                'email.validate',
                emailEvent,
                {},
            );
        } catch (e) {
            console.warn('[magic-link] email validate hook failed:', e);
        }
        if (!emailEvent.allow) throw new MagicLinkFailure('unauthorized');

        const validateEvent = {
            req,
            source: 'magic-link' as never,
            data: { username, email },
            ip: clientIp,
            user_agent: userAgent,
            email,
            clean_email: cleanEmail(email),
            is_temp: false,
            allow: true,
            no_temp_user: false,
            requires_email_confirmation: false,
            requires_phone_verification: false,
            requires_card_verification: false,
            reputation: null as number | null,
            message: null as string | null,
            code: null as string | null,
            trail_id: undefined as string | undefined,
        };
        try {
            await this.clients.event?.emitAndWait(
                'puter.signup.validate',
                validateEvent as never,
                {},
            );
        } catch (e) {
            console.warn('[magic-link] validate hook failed:', e);
        }
        if (!validateEvent.allow) throw new MagicLinkFailure('signup_blocked');

        const cfg = this.config as {
            always_require_phone_verification?: boolean;
            always_require_card_verification?: boolean;
        };
        let created: UserRow;
        try {
            created = await this.stores.user.create({
                username,
                uuid: uuidv4(),
                password: null,
                email,
                clean_email: cleanEmail(email),
                free_storage: this.config.storage_capacity ?? null,
                requires_email_confirmation: false,
                email_confirmed: true,
                requires_phone_verification:
                    Boolean(validateEvent.requires_phone_verification) ||
                    Boolean(cfg.always_require_phone_verification),
                requires_card_verification:
                    Boolean(validateEvent.requires_card_verification) ||
                    Boolean(cfg.always_require_card_verification),
                ...(validateEvent.reputation != null
                    ? { reputation: validateEvent.reputation }
                    : {}),
                audit_metadata: {
                    ip: clientIp,
                    ip_fwd: req.headers?.['x-forwarded-for'],
                    user_agent: userAgent,
                    origin: req.headers?.origin,
                },
                signup_ip: clientIp,
                signup_ip_forwarded: clientIp,
                signup_user_agent: userAgent,
                signup_origin: req.headers?.origin,
                signup_server: this.config.serverId,
            });
        } catch (e) {
            if (!isOwnedEmailConflict(e)) throw e;
            // Someone else claimed the address between the lookup and the
            // insert; a second click on the same link would resolve it.
            throw new MagicLinkFailure('link_expired');
        }

        const defaultGroup = this.config.default_user_group;
        if (defaultGroup) {
            try {
                await this.stores.group.addUsers(defaultGroup, [
                    created.username,
                ]);
            } catch (e) {
                console.warn('[magic-link] group assignment failed:', e);
            }
        }
        try {
            await generateDefaultFsentries(
                this.clients.db,
                this.stores.user,
                created,
            );
        } catch (e) {
            console.warn('[magic-link] generateDefaultFsentries failed:', e);
        }

        const user =
            (await this.stores.user.getById(created.id, { force: true })) ??
            created;
        for (const [key, data] of [
            [
                'user.email-confirmed',
                { user_id: user.id, user_uid: user.uuid, email: user.email },
            ],
            [
                'puter.signup.success',
                {
                    user_id: user.id,
                    user_uuid: user.uuid,
                    email: user.email,
                    username: user.username,
                    ip: clientIp,
                },
            ],
            ['user.save_account', { user_id: user.id }],
        ] as const) {
            try {
                this.clients.event?.emit(key as never, data as never, {});
            } catch {
                // Best-effort hooks.
            }
        }
        return user;
    }

    // -- Pickup -------------------------------------------------------

    /**
     * Park an app's token for the app's landing page, which is bound to the
     * app's origin by `/login/wait` and takes its copy exactly once.
     */
    async storeLandingPickup(
        session: string,
        pickup: PickupRecord,
    ): Promise<void> {
        await this.clients.redis.set(
            this.#landingKey(session),
            JSON.stringify(pickup),
            'EX',
            MAGIC_LINK_PICKUP_TTL_SECONDS,
        );
    }

    /**
     * The landing copy, left in place. The caller decides whether it is for
     * them before burning it with `burnLandingPickup`, so a stray poll from
     * another origin cannot take it away from the page it was minted for.
     */
    async peekLandingPickup(session: string): Promise<string | null> {
        const raw = await this.clients.redis.get(this.#landingKey(session));
        if (!raw) return null;
        return (JSON.parse(raw) as PickupRecord).token;
    }

    async burnLandingPickup(session: string): Promise<void> {
        await this.clients.redis.del(this.#landingKey(session));
    }
}
