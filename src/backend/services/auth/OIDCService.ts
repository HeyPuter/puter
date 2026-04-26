import type { LayerInstances } from '../../types';
import type { puterServices } from '../index';
import type { UserRow } from '../../stores/user/UserStore';
import { PuterService } from '../types';
import { cleanEmail } from '../../util/email.js';
import { generate_identifier } from '../../util/identifier.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';

const GOOGLE_DISCOVERY_URL =
    'https://accounts.google.com/.well-known/openid-configuration';
const GOOGLE_SCOPES = 'openid email profile';
const STATE_EXPIRY_SEC = 600; // 10 minutes
const VALID_OIDC_FLOWS = ['login', 'signup', 'revalidate'] as const;
const REVALIDATION_EXPIRY_SEC = 300; // 5 minutes

interface ProviderConfig {
    client_id: string;
    client_secret: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
    scopes: string;
}

interface OIDCUserInfo {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    [k: string]: unknown;
}

/**
 * OIDC/OAuth2 service — sign-in with Google (extensible to other providers).
 *
 * Delegates to TokenService for JWT state signing, AuthService for session
 * creation, UserStore for user creation.
 *
 * Config shape: `config.oidc.providers.<providerId>.{ client_id, client_secret, ... }`
 */
export class OIDCService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    #googleDiscovery: Record<string, string> | null = null;
    #providers: Record<string, Record<string, string>> = {};

    override onServerStart(): void {
        const oidcConfig = this.config.oidc;
        this.#providers = (oidcConfig?.providers ?? {}) as Record<
            string,
            Record<string, string>
        >;
    }

    // ── Provider config ─────────────────────────────────────────────

    async getProviderConfig(
        providerId: string,
    ): Promise<ProviderConfig | null> {
        const raw = this.#providers[providerId];
        if (!raw || !raw.client_id || !raw.client_secret) return null;

        if (providerId === 'google') {
            const discovery = await this.#fetchGoogleDiscovery();
            if (!discovery) return null;
            return {
                client_id: raw.client_id,
                client_secret: raw.client_secret,
                authorization_endpoint: discovery.authorization_endpoint,
                token_endpoint: discovery.token_endpoint,
                userinfo_endpoint: discovery.userinfo_endpoint,
                scopes: raw.scopes ?? GOOGLE_SCOPES,
            };
        }

        // Custom provider — must have all endpoints configured explicitly
        if (
            raw.authorization_endpoint &&
            raw.token_endpoint &&
            raw.userinfo_endpoint
        ) {
            return {
                client_id: raw.client_id,
                client_secret: raw.client_secret,
                authorization_endpoint: raw.authorization_endpoint,
                token_endpoint: raw.token_endpoint,
                userinfo_endpoint: raw.userinfo_endpoint,
                scopes: raw.scopes ?? 'openid email profile',
            };
        }

        return null;
    }

    async getEnabledProviderIds(): Promise<string[]> {
        const ids: string[] = [];
        for (const id of Object.keys(this.#providers)) {
            const cfg = await this.getProviderConfig(id);
            if (cfg) ids.push(id);
        }
        return ids;
    }

    // ── Auth URL ────────────────────────────────────────────────────

    getCallbackUrl(flow: string): string | null {
        if (!(VALID_OIDC_FLOWS as readonly string[]).includes(flow))
            return null;
        const origin = (this.config.origin ?? '').replace(/\/$/, '');
        return `${origin}/auth/oidc/callback/${flow}`;
    }

    async getAuthorizationUrl(
        providerId: string,
        state: string,
        flow: string,
    ): Promise<string | null> {
        const config = await this.getProviderConfig(providerId);
        if (!config) return null;
        const redirectUri =
            this.getCallbackUrl(flow) ??
            `${this.config.api_base_url ?? ''}/auth/oidc/callback`;
        const params = new URLSearchParams({
            client_id: config.client_id,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: config.scopes,
            state,
        });
        return `${config.authorization_endpoint}?${params.toString()}`;
    }

    // ── State tokens (CSRF) ─────────────────────────────────────────

    signState(payload: Record<string, unknown>): string {
        return this.services.token.sign('oidc-state', payload, {
            expiresIn: STATE_EXPIRY_SEC,
        });
    }

    verifyState(token: string): Record<string, unknown> | null {
        try {
            return this.services.token.verify<Record<string, unknown>>(
                'oidc-state',
                token,
            );
        } catch {
            return null;
        }
    }

    // ── Revalidation tokens ─────────────────────────────────────────

    signRevalidation(userUuid: string): string {
        return this.services.token.sign(
            'oidc-state',
            {
                user_uuid: userUuid,
                purpose: 'revalidate',
            },
            { expiresIn: REVALIDATION_EXPIRY_SEC },
        );
    }

    // ── Token exchange ──────────────────────────────────────────────

    async exchangeCodeForTokens(
        providerId: string,
        code: string,
        redirectUri: string,
    ): Promise<{ access_token: string; [k: string]: unknown } | null> {
        const config = await this.getProviderConfig(providerId);
        if (!config) return null;

        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: config.client_id,
            client_secret: config.client_secret,
        });

        const res = await fetch(config.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (!res.ok) {
            console.warn('[oidc] token exchange failed', {
                status: res.status,
                body: await res.text(),
            });
            return null;
        }

        return (await res.json()) as { access_token: string };
    }

    // ── User info ───────────────────────────────────────────────────

    async getUserInfo(
        providerId: string,
        accessToken: string,
    ): Promise<OIDCUserInfo | null> {
        const config = await this.getProviderConfig(providerId);
        if (!config?.userinfo_endpoint) return null;

        const res = await fetch(config.userinfo_endpoint, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return null;
        return (await res.json()) as OIDCUserInfo;
    }

    // ── User lookup / creation ──────────────────────────────────────

    async findUserByProviderSub(
        provider: string,
        providerSub: string,
    ): Promise<UserRow | null> {
        const link = await this.stores.oidc.getByProviderSub(
            provider,
            providerSub,
        );
        if (!link) return null;
        return this.stores.user.getById(link.user_id as number);
    }

    /**
     * Find an existing Puter user by the email claimed by the OIDC provider.
     *
     * Matches on both the raw `email` column and the canonical `clean_email`
     * column so that `Foo.Bar+tag@gmail.com` (OIDC) resolves to an account
     * that signed up as `foobar@gmail.com`. Primary email is preferred over a
     * clean_email collision.
     */
    async findUserByEmail(email: string): Promise<UserRow | null> {
        if (!email) return null;
        const direct = await this.stores.user.getByEmail(email);
        if (direct) return direct;
        return this.stores.user.getByCleanEmail(cleanEmail(email));
    }

    /**
     * Link an OIDC provider to an existing user. Use when the `sub` wasn't
     * linked yet but we matched the user by email.
     *
     * Does NOT touch the password column — a user who originally signed up
     * with a password keeps password login. Does mark `email_confirmed` if
     * the provider verified the email and the row wasn't already confirmed.
     */
    async linkProviderToUser(
        userId: number,
        providerId: string,
        claims: OIDCUserInfo,
    ): Promise<{ success: boolean; error?: string }> {
        if (claims.email_verified === false) {
            return {
                success: false,
                error: 'Provider did not verify this email address.',
            };
        }

        // Only link to accounts whose email is already confirmed. Unconfirmed
        // accounts have no proven owner, so linking OIDC would hand control
        // to whoever holds the OIDC identity.
        const user = await this.stores.user.getById(userId, { force: true });
        if (!user) {
            return { success: false, error: 'User not found.' };
        }
        if (!user.email_confirmed) {
            return {
                success: false,
                error: 'Account email is not confirmed. Sign in with your password first to confirm it.',
            };
        }

        await this.stores.oidc.link(userId, providerId, claims.sub, null);
        return { success: true };
    }

    /**
     * Create a new Puter user from OIDC claims and link the provider.
     * Returns `{ success, user, error? }`.
     */
    async createUserFromOIDC(
        providerId: string,
        claims: OIDCUserInfo,
    ): Promise<{ success: boolean; user?: UserRow; error?: string }> {
        if (claims.email_verified === false) {
            return {
                success: false,
                error: 'Provider did not verify this email address.',
            };
        }

        // Generate a unique username
        let username: string;
        let attempts = 0;
        do {
            username = generate_identifier();
            attempts++;
            if (attempts > 20)
                return {
                    success: false,
                    error: 'Failed to generate unique username.',
                };
        } while (await this.stores.user.getByUsername(username));

        // Create user — no password, email assumed confirmed by provider
        const { v4: uuidv4 } = await import('uuid');
        const created = await this.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: claims.email ?? null,
            clean_email: claims.email ? cleanEmail(claims.email) : null,
            free_storage: this.config.storage_capacity ?? null,
            requires_email_confirmation: false,
        });

        if (!created) {
            return { success: false, error: 'User creation failed.' };
        }

        // Mark email as confirmed (OIDC provider already verified it).
        await this.stores.user.update(created.id, {
            email_confirmed: 1,
            requires_email_confirmation: 0,
        });

        // Default user group — OIDC users skip the temp group entirely since
        // the email is already verified by the IdP.
        const defaultGroup = this.config.default_user_group;
        if (defaultGroup) {
            try {
                await this.stores.group.addUsers(defaultGroup, [
                    created.username,
                ]);
            } catch (e) {
                console.warn('[oidc] group assignment failed:', e);
            }
        }

        // Provision home directory + default folders. Idempotent.
        try {
            await generateDefaultFsentries(
                this.clients.db,
                this.stores.user,
                created,
            );
        } catch (e) {
            console.warn('[oidc] generateDefaultFsentries failed:', e);
        }

        // Link OIDC provider (after provisioning so a failed link doesn't
        // leave an orphaned user without a home folder).
        await this.stores.oidc.link(created.id, providerId, claims.sub, null);

        // Re-read so callers see email_confirmed / *_uuid / *_id fields
        // written above.
        const user = await this.stores.user.getById(created.id, {
            force: true,
        });
        const resolved = user ?? created;

        // Fire signup events — keys match the password-based signup path so
        // downstream listeners (welcome email, mailchimp sync, etc.) treat
        // both signup routes identically.
        try {
            this.clients.event?.emit(
                'puter.signup.success',
                {
                    user_id: resolved.id,
                    user_uuid: resolved.uuid,
                    email: resolved.email,
                    username: resolved.username,
                },
                {},
            );
        } catch {
            // ignore — event emission shouldn't block signup
        }
        try {
            this.clients.event?.emit(
                'user.save_account',
                { user_id: resolved.id },
                {},
            );
        } catch {
            // ignore
        }

        return { success: true, user: resolved };
    }

    // ── Internals ───────────────────────────────────────────────────

    async #fetchGoogleDiscovery(): Promise<Record<string, string> | null> {
        if (this.#googleDiscovery) return this.#googleDiscovery;
        try {
            const res = await fetch(GOOGLE_DISCOVERY_URL);
            if (!res.ok) return null;
            this.#googleDiscovery = (await res.json()) as Record<
                string,
                string
            >;
            return this.#googleDiscovery;
        } catch (e) {
            console.warn('[oidc] Google discovery fetch failed', e);
            return null;
        }
    }
}
