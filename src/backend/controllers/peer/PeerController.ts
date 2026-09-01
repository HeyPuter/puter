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

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { makeActor, type Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import { computeNetworkFingerprint } from '../../core/http/middleware/rateLimit.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterController } from '../types.js';
import { PEER_COSTS } from './costs.js';
import {
    readClaimedGrantIdentifier,
    signGuestGrant,
    verifyGuestGrant,
} from './guestGrant.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';

/** Grant lifetime when config doesn't say. Long enough for a sitting. */
const DEFAULT_GRANT_TTL = 3600;

/**
 * Guest credential lifetime when config doesn't say, and never longer than the
 * host's own `turn.ttl`. Shorter than a host credential on purpose: a guest
 * credential is handed to someone with no account behind it, so the window in
 * which a leaked one can relay traffic on the host's tab stays small.
 */
const DEFAULT_GUEST_CREDENTIAL_TTL = 3600;

/**
 * Constant-time secret comparison for the internal-auth header. HMAC both sides
 * under a random per-process key to a fixed 32-byte digest first: this avoids
 * leaking length via an early-return and sidesteps `timingSafeEqual`'s
 * equal-length requirement for arbitrary-length inputs. The key need not
 * persist — it only has to be unknown to the attacker for the duration of the
 * comparison.
 */
const COMPARE_KEY = randomBytes(32);
const secretsEqual = (a: string, b: string): boolean => {
    const ha = createHmac('sha256', COMPARE_KEY).update(a).digest();
    const hb = createHmac('sha256', COMPARE_KEY).update(b).digest();
    return timingSafeEqual(ha, hb);
};

/**
 * Encode a UUID (or `app-<uuid>` UID) as base64url with no padding. Strips an
 * `app-` prefix and dashes, then reinterprets the hex bytes.
 */
const uuidToBase64url = (uuid: string): string =>
    Buffer.from(uuid.replace(/^app-/, '').replaceAll('-', ''), 'hex').toString(
        'base64url',
    );

/**
 * Decode a base64url-encoded hex UUID back to dashed form. Returns null if the
 * input doesn't decode to exactly 16 bytes.
 */
const base64urlToUuid = (encoded: string): string | null => {
    try {
        const hex = Buffer.from(encoded, 'base64url').toString('hex');
        if (hex.length !== 32) return null;
        return [
            hex.slice(0, 8),
            hex.slice(8, 12),
            hex.slice(12, 16),
            hex.slice(16, 20),
            hex.slice(20),
        ].join('-');
    } catch {
        return null;
    }
};

/**
 * Build the customIdentifier sent to Cloudflare for credential generation.
 * Shape: `<user-b64>` for user actors, `<user-b64>:<app-b64>` for
 * app-under-user actors. Cloudflare echoes this back in usage records, letting
 * us attribute egress to the originating user (and app, if any).
 */
const actorToTurnIdentifier = (actor: Actor): string => {
    const userPart = uuidToBase64url(actor.user.uuid);
    if (!actor.app) return userPart;
    return `${userPart}:${uuidToBase64url(actor.app.uid)}`;
};

/**
 * Peer controller — WebRTC signalling info + TURN credential generation.
 *
 * Two ways to get relay credentials: an authenticated caller mints its own
 * (`/peer/generate-turn`), or a host mints a grant (`/peer/turn-grant`) that
 * people it invited redeem without an account (`/peer/guest-turn`). Both paths
 * end at the same upstream call and stamp the same `customIdentifier`, so relay
 * usage is attributed to a real account either way — for a guest, the host's.
 *
 * Config shape, all under `config.peers`:
 *
 * - `signaller_url` — WebRTC signaller URL
 * - `fallback_ice` — fallback ICE server list
 * - `turn.cloudflare_turn_service_id`, `turn.cloudflare_turn_api_token`
 * - `turn.ttl` — credential TTL (default 86400)
 * - `guest_turn.grant_secret` — HMAC key for guest grants; absent disables the
 *   guest routes
 * - `guest_turn.grant_ttl`, `guest_turn.credential_ttl`
 */
export class PeerController extends PuterController {
    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(PEER_COSTS).map(([usageType, ucentsPerUnit]) => ({
            usageType,
            ucentsPerUnit,
            unit: 'byte',
            source: 'controller:peer',
        }));
    }

    registerRoutes(router: PuterRouter): void {
        router.get(
            '/peer/signaller-info',
            {
                subdomain: 'api',
                // Public config read — the signaller URL and the fallback
                // ICE list, both deploy constants. Unauthenticated, so the
                // key is the address, and one address covers every client
                // on that network; a peer session starts with this call, so
                // the bucket has to hold a whole network's sessions. Nothing
                // here is secret or expensive, so the ceiling only bounds a
                // client stuck re-reading it.
                rateLimit: {
                    scope: 'peer-signaller-info',
                    limit: 3_000,
                    window: 60_000,
                    key: 'ip',
                },
            },
            this.#signallerInfo,
        );
        router.post(
            '/peer/generate-turn',
            {
                subdomain: 'api',
                requireAuth: true,
                // Every call reaches the upstream TURN API and mints
                // credentials against a paid allocation, so this is a
                // spend limit as much as an abuse limit.
                rateLimit: {
                    scope: 'peer-generate-turn',
                    limit: 30,
                    window: 60_000,
                    key: 'user',
                    bySubscription: {
                        [DEFAULT_FREE_SUBSCRIPTION]: 10,
                        [DEFAULT_TEMP_SUBSCRIPTION]: 5,
                    },
                },
            },
            this.#generateTurn,
        );
        router.post(
            '/peer/turn-grant',
            {
                subdomain: 'api',
                requireAuth: true,
                // Issuing a grant costs nothing upstream — it's one HMAC — but
                // each one lets a crowd of guests mint credentials against
                // this account, so it carries the same per-account ceiling as
                // minting credentials directly. One grant serves a whole
                // session; a host at this limit is re-issuing in a loop.
                rateLimit: {
                    scope: 'peer-turn-grant',
                    limit: 30,
                    window: 60_000,
                    key: 'user',
                    bySubscription: {
                        [DEFAULT_FREE_SUBSCRIPTION]: 10,
                        [DEFAULT_TEMP_SUBSCRIPTION]: 5,
                    },
                },
            },
            this.#createTurnGrant,
        );
        router.post(
            '/peer/guest-turn',
            {
                subdomain: 'api',
                // Deliberately unauthenticated: the grant in the body is the
                // credential, and it names the account that pays. Keyed on the
                // host the grant claims rather than the caller, so one host's
                // guests share one bucket and no host can be relayed for by
                // more guests per minute than this — the only ceiling on guest
                // spend we can apply before the bytes are already spent.
                // A grant that doesn't parse can't name a bucket, so those
                // requests fall back to the caller's own network.
                rateLimit: {
                    scope: 'peer-guest-turn',
                    limit: 60,
                    window: 60_000,
                    key: (req: Request) => {
                        const claimed = readClaimedGrantIdentifier(
                            (req.body as { grant?: unknown } | undefined)
                                ?.grant,
                        );
                        return claimed
                            ? `host:${claimed}`
                            : `net:${computeNetworkFingerprint(req)}`;
                    },
                },
            },
            this.#guestTurn,
        );
        router.post(
            '/turn/ingest-usage',
            {
                subdomain: 'api',
                // Shared-secret authenticated, so this only bounds how
                // fast someone can guess the secret.
                rateLimit: {
                    scope: 'turn-ingest',
                    limit: 60,
                    window: 60_000,
                    key: 'ip',
                },
            },
            this.#ingestUsage,
        );
    }

    /** GET /peer/signaller-info — public, no auth required. */
    #signallerInfo = (_req: Request, res: Response): void => {
        res.json({
            url: this.config.peers?.signaller_url ?? null,
            fallbackIce: this.config.peers?.fallback_ice ?? [],
        });
    };

    /** Upstream TURN settings, or 503 when this deployment has none configured. */
    #requireTurnConfig = (): {
        serviceId: string;
        apiToken: string;
        ttl: number;
    } => {
        const cfg = this.config.peers;
        if (
            !cfg ||
            !cfg.turn ||
            !cfg.turn.cloudflare_turn_service_id ||
            !cfg.turn.cloudflare_turn_api_token ||
            !cfg.turn.ttl
        ) {
            throw new HttpError(503, 'TURN not configured', {
                legacyCode: 'response_timeout',
            });
        }
        return {
            serviceId: cfg.turn.cloudflare_turn_service_id,
            apiToken: cfg.turn.cloudflare_turn_api_token,
            ttl: cfg.turn.ttl,
        };
    };

    /**
     * The signing key for guest grants, or 503 when this deployment hasn't set
     * one. No key means no guest access — never a fallback to another secret,
     * which would let a credential minted for one purpose be spent on another.
     */
    #requireGuestGrantSecret = (): string => {
        const secret = this.config.peers?.guest_turn?.grant_secret;
        if (!secret) {
            throw new HttpError(503, 'Guest TURN access is not configured', {
                legacyCode: 'response_timeout',
            });
        }
        return secret;
    };

    /**
     * Mint relay credentials upstream, attributed to `customIdentifier`. The
     * one place that talks to the credential API, so every caller — host or
     * guest — produces identically shaped, identically attributed usage.
     */
    #mintIceServers = async (
        customIdentifier: string,
        ttl: number,
    ): Promise<unknown> => {
        const { serviceId, apiToken } = this.#requireTurnConfig();

        const cfRes = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${serviceId}/credentials/generate-ice-servers`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ttl, customIdentifier }),
            },
        );

        if (!cfRes.ok) {
            const body = await cfRes.text();
            console.warn(
                '[peer] Cloudflare TURN credential generation failed',
                cfRes.status,
                body,
            );
            throw new HttpError(500, 'TURN credential generation failed', {
                legacyCode: 'internal_error',
            });
        }

        const data = (await cfRes.json()) as { iceServers?: unknown };
        return data.iceServers;
    };

    /** POST /peer/generate-turn — generate TURN credentials via Cloudflare. */
    #generateTurn = async (req: Request, res: Response): Promise<void> => {
        const { ttl } = this.#requireTurnConfig();
        const iceServers = await this.#mintIceServers(
            actorToTurnIdentifier(req.actor),
            ttl,
        );
        res.json({ ttl, iceServers });
    };

    /**
     * POST /peer/turn-grant — issue a grant the caller can hand to guests.
     *
     * The grant names the caller as the account guest relay usage is billed to,
     * so it is only as shareable as the caller wants their allowance to be:
     * anyone holding it can mint guest credentials until it expires.
     */
    #createTurnGrant = (req: Request, res: Response): void => {
        const secret = this.#requireGuestGrantSecret();
        // Refuse to hand out a ticket this deployment couldn't redeem.
        this.#requireTurnConfig();

        const { grant, expiresAt } = signGuestGrant({
            customIdentifier: actorToTurnIdentifier(req.actor),
            ttlSeconds:
                this.config.peers?.guest_turn?.grant_ttl ?? DEFAULT_GRANT_TTL,
            secret,
        });

        res.json({ grant, expiresAt });
    };

    /**
     * POST /peer/guest-turn — redeem a host's grant for relay credentials.
     *
     * Attribution comes from the grant alone; any session the caller happens to
     * carry is ignored, so the account named in the grant is the account
     * charged whether the guest is signed in or not.
     */
    #guestTurn = async (req: Request, res: Response): Promise<void> => {
        const secret = this.#requireGuestGrantSecret();
        const { ttl: hostTtl } = this.#requireTurnConfig();

        const verified = verifyGuestGrant({
            grant: (req.body as { grant?: unknown } | undefined)?.grant,
            secret,
        });
        if (verified.status !== 'ok') {
            if (verified.status === 'malformed') {
                throw new HttpError(400, 'Missing or malformed grant', {
                    code: 'peer_grant_malformed',
                });
            }
            // Expiry is readable from the grant the caller already holds, so
            // saying so tells them nothing they didn't know and lets the app
            // ask the host for a fresh one instead of retrying a dead ticket.
            if (verified.status === 'expired') {
                throw new HttpError(403, 'Guest grant has expired', {
                    code: 'peer_grant_expired',
                });
            }
            throw new HttpError(403, 'Guest grant is not valid', {
                code: 'peer_grant_invalid',
            });
        }

        const ttl = Math.min(
            hostTtl,
            this.config.peers?.guest_turn?.credential_ttl ??
                DEFAULT_GUEST_CREDENTIAL_TTL,
        );
        const iceServers = await this.#mintIceServers(
            verified.customIdentifier,
            ttl,
        );
        res.json({ ttl, iceServers });
    };

    /**
     * POST /turn/ingest-usage — internal-only TURN egress metering. an external
     * service that knows the usage information from cloudflare will send it to
     * us here. Meters each record directly against the owning user via
     * `services.metering.incrementUsage` multiplied by turn:egress-bytes cost.
     */
    #ingestUsage = async (req: Request, res: Response): Promise<void> => {
        const cfg = this.config.peers;
        if (!cfg || !cfg.internal_auth_secret) {
            throw new HttpError(403, 'Forbidden', { legacyCode: 'forbidden' });
        }
        const expectedSecret = cfg.internal_auth_secret;
        const header = req.headers['x-puter-internal-auth'];
        if (
            !expectedSecret ||
            typeof header !== 'string' ||
            !secretsEqual(header, expectedSecret)
        ) {
            throw new HttpError(403, 'Forbidden', { legacyCode: 'forbidden' });
        }

        const { records } = req.body ?? {};
        if (!Array.isArray(records)) {
            throw new HttpError(400, 'Missing `records` array', {
                legacyCode: 'bad_request',
            });
        }

        for (const record of records) {
            if (!record || typeof record !== 'object') continue;
            const egressBytes = Number(record.egressBytes ?? 0);
            if (egressBytes <= 0) continue;

            const userUuid = record.userId
                ? base64urlToUuid(String(record.userId))
                : null;
            if (!userUuid) continue;

            try {
                const user = await this.stores.user.getByUuid(userUuid);
                if (!user) continue;
                const costInMicrocents =
                    egressBytes * PEER_COSTS['turn:egress-bytes'];
                const actor = makeActor({
                    user: {
                        uuid: user.uuid,
                        id: user.id,
                        username: user.username,
                    },
                });
                await this.services.metering.incrementUsage(
                    actor,
                    'turn:egress-bytes',
                    egressBytes,
                    costInMicrocents,
                );
            } catch (e) {
                console.warn(
                    '[peer] TURN metering failed:',
                    (e as Error).message,
                );
            }
        }

        res.json({ ok: true });
    };
}
