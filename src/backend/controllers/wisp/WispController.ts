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

import type { Request, Response } from 'express';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    assertNotSuspended,
    assertVerifiedAccount,
} from '../../core/http/middleware/gates.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterController } from '../types.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';

/**
 * WISP relay token controller — create and verify short-lived JWT tokens for
 * the WISP network proxy.
 *
 * Config: `config.wisp.server` — WISP relay server address.
 */
export class WispController extends PuterController {
    registerRoutes(router: PuterRouter): void {
        router.post(
            '/wisp/relay-token/create',
            {
                subdomain: 'api',
                requireAuth: true,
                // Auth is optional in practice (the handler tolerates an
                // anonymous actor), so the key falls back to a fingerprint
                // when there is no user to key on.
                rateLimit: {
                    scope: 'wisp-token-create',
                    limit: 60,
                    window: 60_000,
                    key: 'user',
                    bySubscription: {
                        [DEFAULT_FREE_SUBSCRIPTION]: 30,
                        [DEFAULT_TEMP_SUBSCRIPTION]: 10,
                    },
                },
            },
            this.#create,
        );
        router.post(
            '/wisp/relay-token/verify',
            {
                subdomain: 'api',
                requireAuth: false,
            },
            this.#verify,
        );
    }

    /** POST /wisp/relay-token/create — mint a relay token (auth optional). */
    #create = async (req: Request, res: Response): Promise<void> => {
        const actor = req.actor;
        const wispCfg = this.#wispConfig();

        if (actor?.user?.uuid) {
            const sessionUid = await this.#sessionUidFor(actor);
            const token = this.services.token.sign(
                'wisp',
                {
                    $: 'token:wisp',
                    $v: '0.0.0',
                    user_uid: actor.user.uuid,
                    ...(sessionUid ? { session_uid: sessionUid } : {}),
                },
                { expiresIn: '1d' },
            );
            res.json({ token, server: wispCfg.server ?? null });
        } else {
            const token = this.services.token.sign(
                'wisp',
                {
                    $: 'token:wisp',
                    $v: '0.0.0',
                    guest: true,
                },
                { expiresIn: '1d' },
            );
            res.json({ token, server: wispCfg.server ?? null });
        }
    };

    /** POST /wisp/relay-token/verify — verify a relay token and apply policy. */
    #verify = async (req: Request, res: Response): Promise<void> => {
        const bodyToken = req.body?.token;
        if (!bodyToken || typeof bodyToken !== 'string') {
            throw new HttpError(400, 'Missing `token`', {
                legacyCode: 'token_missing',
            });
        }

        let decoded: Record<string, unknown>;
        try {
            decoded = this.services.token.verify<Record<string, unknown>>(
                'wisp',
                bodyToken,
            );
            if (decoded.$ !== 'token:wisp')
                throw new HttpError(403, 'wrong token type', {
                    legacyCode: 'invalid_token',
                });
        } catch {
            throw new HttpError(403, 'Forbidden', {
                legacyCode: 'invalid_token',
            });
        }

        const isGuest = Boolean(decoded.guest);
        const user = isGuest ? null : await this.#liveUserFor(decoded);

        // Build policy event — extensions can deny via extension.on('wisp.get-policy')
        const event: Record<string, unknown> = {
            allow: true,
            policy: { allow: true },
            guest: isGuest,
            user,
        };
        // emitAndWait so async listeners can fetch policy data before
        // mutating `event.allow` / `event.policy`; plain emit would return
        // control before any awaited work completed.
        await this.clients.event.emitAndWait('wisp.get-policy', event, {});

        if (!event.allow) {
            throw new HttpError(403, 'Forbidden', { legacyCode: 'forbidden' });
        }

        res.json(event.policy);
    };

    /**
     * The session a relay token lives no longer than. An access token's is its
     * own session row; the actor doesn't carry it.
     */
    async #sessionUidFor(actor: Actor): Promise<string | undefined> {
        if (actor.session?.uid) return actor.session.uid;
        if (!actor.accessToken) return undefined;
        const row = await this.stores.session.findActiveByAccessTokenUid(
            actor.accessToken.uid,
        );
        return row?.uuid;
    }

    /**
     * The token's user, held to the same account gates as minting. A token
     * without `session_uid` (minted before the claim existed, or by a legacy
     * access token with no session row) gets the account checks only.
     */
    async #liveUserFor(
        decoded: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const forbidden = () =>
            new HttpError(403, 'Forbidden', { legacyCode: 'forbidden' });
        if (!decoded.user_uid) throw forbidden();
        const user = await this.stores.user.getByUuid(String(decoded.user_uid));
        if (!user) throw forbidden();
        assertNotSuspended(user);
        assertVerifiedAccount(user);
        if (
            decoded.session_uid &&
            !(await this.stores.session.getByUuid(String(decoded.session_uid)))
        ) {
            throw forbidden();
        }
        return user;
    }

    #wispConfig(): NonNullable<typeof this.config.wisp> {
        return this.config.wisp ?? {};
    }
}
