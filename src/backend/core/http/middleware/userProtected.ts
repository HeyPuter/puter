import type { Request, RequestHandler, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { HttpError } from '../HttpError';
import type { IConfig } from '../../../types';
import type { UserStore, UserRow } from '../../../stores/user/UserStore';
import type { OIDCService } from '../../../services/auth/OIDCService';
import type { TokenService } from '../../../services/auth/TokenService';

/**
 * Gate for security-critical account endpoints mounted under `/user-protected/*`.
 *
 * Runs AFTER the built-in `requireUserActor` + `antiCsrf` gates; adds four
 * extra checks:
 *
 *   1. **Session-cookie only** — reject API tokens, GUI tokens, `x-api-key`
 *      headers, query-string tokens. `authProbe` stashes the token it
 *      resolved as `req.token`; if that doesn't match the session cookie
 *      value, the request came in via a non-cookie source and is rejected.
 *   2. **Cache-bypass user refresh** — a suspended account whose session
 *      row is still cached would otherwise pass; re-fetch with
 *      `{ force: true }` and reject anything suspended.
 *   3. **Temp-user block** — temporary accounts (no password + no email)
 *      can only reach `/delete-own-user`. Opt in by constructing with
 *      `{ allowTempUsers: true }` on that route.
 *   4. **Password OR OIDC revalidation cookie** — `req.body.password` is
 *      verified via bcrypt against the user row; otherwise a valid
 *      `puter_revalidation` cookie (signed via `services.token.sign('oidc-state')`)
 *      is required. OIDC-only accounts (no password) MUST use the
 *      revalidation cookie — password path returns `oidc_revalidation_required`
 *      with a `revalidate_url` so the GUI can open the OIDC popup.
 */

const REVALIDATION_COOKIE_NAME = 'puter_revalidation';

interface RevalidationPayload {
    user_uuid: string;
    purpose: string;
}

export interface UserProtectedGateDeps {
    config: IConfig;
    userStore: UserStore;
    oidcService: OIDCService;
    tokenService: TokenService;
}

export interface UserProtectedGateOptions {
    /** Allow temp accounts (no password + no email) through. Default: false. */
    allowTempUsers?: boolean;
}

// Extend Request so the middleware chain can hand the refreshed row off to
// the handler without re-fetching.
declare module 'express-serve-static-core' {
    interface Request {
        userProtected?: { user: UserRow };
    }
}

async function buildRevalidateFields(
    config: IConfig,
    oidcService: OIDCService,
    user: UserRow,
): Promise<Record<string, string> | undefined> {
    const origin = (config.origin ?? '').replace(/\/$/, '');
    const providers = await oidcService.getEnabledProviderIds();
    const provider = providers && providers[0];
    if (!provider || !origin) return undefined;
    return {
        revalidate_url: `${origin}/auth/oidc/${provider}/start?flow=revalidate&user_uuid=${encodeURIComponent(user.uuid)}`,
    };
}

export const createUserProtectedGate = (
    deps: UserProtectedGateDeps,
    options: UserProtectedGateOptions = {},
): RequestHandler[] => {
    const { config, userStore, oidcService, tokenService } = deps;
    const cookieName = config.cookie_name ?? 'puter_token';
    const allowTemp = !!options.allowTempUsers;

    // 1. Session cookie only.
    const requireSessionCookie: RequestHandler = (req, _res, next) => {
        const cookieValue = req.cookies?.[cookieName];
        if (!cookieValue || (req.token && req.token !== cookieValue)) {
            throw new HttpError(401, 'Session cookie required', {
                legacyCode: 'session_required',
            });
        }
        next();
    };

    // 2. Fresh user row (bypass cache to catch just-suspended accounts).
    // `getById` doesn't take options; go through `getByProperty` with
    // `{ force: true }` to force a primary read.
    const refreshUser: RequestHandler = async (
        req: Request,
        _res: Response,
        next: NextFunction,
    ) => {
        const actor = req.actor;
        if (!actor?.user?.id) throw new HttpError(401, 'User required');
        const user = await userStore.getByProperty('id', actor.user.id, {
            force: true,
        });
        if (!user) throw new HttpError(404, 'User not found');
        if (user.suspended)
            throw new HttpError(403, 'Account is suspended', {
                legacyCode: 'account_suspended',
            });
        req.userProtected = { user };
        next();
    };

    // 3. Password (bcrypt) OR valid OIDC revalidation cookie.
    //
    //   - Temp users (no password + no email) pass only when the route was
    //     registered with `allowTempUsers: true` (delete-own-user).
    //   - `req.body.password` → bcrypt match against user row. OIDC-only
    //     accounts bounce with `oidc_revalidation_required` + a
    //     `revalidate_url` helper so the GUI can open the OIDC popup.
    //   - Otherwise accept a valid `puter_revalidation` cookie. Expiry,
    //     `purpose === 'revalidate'`, matching `user_uuid` all required.
    //   - Password account, neither credential → 403 `password_required`.
    const verifyIdentity: RequestHandler = async (
        req: Request,
        _res: Response,
        next: NextFunction,
    ) => {
        const user = req.userProtected?.user;
        if (!user) throw new HttpError(500, 'user-protected state missing');

        const isTemp = user.password === null && user.email === null;
        if (isTemp) {
            if (allowTemp) return next();
            throw new HttpError(403, 'Temporary account', {
                legacyCode: 'temporary_account',
            });
        }

        const bodyPassword =
            typeof req.body?.password === 'string' ? req.body.password : null;
        if (bodyPassword) {
            if (user.password === null) {
                const fields = await buildRevalidateFields(
                    config,
                    oidcService,
                    user,
                );
                throw new HttpError(403, 'OIDC revalidation required', {
                    legacyCode: 'oidc_revalidation_required',
                    fields,
                });
            }
            let match = false;
            try {
                match = await bcrypt.compare(
                    bodyPassword,
                    String(user.password),
                );
            } catch {
                match = false;
            }
            if (!match)
                throw new HttpError(400, 'Password mismatch', {
                    legacyCode: 'password_mismatch',
                });
            return next();
        }

        const cookieValue = req.cookies?.[REVALIDATION_COOKIE_NAME];
        if (cookieValue) {
            try {
                const payload = tokenService.verify<RevalidationPayload>(
                    'oidc-state',
                    cookieValue,
                );
                if (
                    payload?.purpose === 'revalidate' &&
                    payload.user_uuid === user.uuid
                ) {
                    return next();
                }
            } catch {
                // Fall through to the no-credentials branch.
            }
        }

        if (user.password === null) {
            const fields = await buildRevalidateFields(
                config,
                oidcService,
                user,
            );
            throw new HttpError(403, 'OIDC revalidation required', {
                legacyCode: 'oidc_revalidation_required',
                fields,
            });
        }
        throw new HttpError(403, 'Password required', {
            legacyCode: 'password_required',
        });
    };

    return [requireSessionCookie, refreshUser, verifyIdentity];
};
