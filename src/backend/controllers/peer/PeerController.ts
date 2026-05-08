/**
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
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterController } from '../types.js';
import { PEER_COSTS } from './costs.js';

/**
 * Encode a UUID (or `app-<uuid>` UID) as base64url with no padding.
 * Strips an `app-` prefix and dashes, then reinterprets the hex bytes.
 */
const uuidToBase64url = (uuid: string): string =>
    Buffer.from(uuid.replace(/^app-/, '').replaceAll('-', ''), 'hex').toString(
        'base64url',
    );

/**
 * Decode a base64url-encoded hex UUID back to dashed form.
 * Returns null if the input doesn't decode to exactly 16 bytes.
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
 * app-under-user actors. Cloudflare echoes this back in usage records,
 * letting us attribute egress to the originating user (and app, if any).
 */
const actorToTurnIdentifier = (actor: Actor): string => {
    const userPart = uuidToBase64url(actor.user.uuid);
    if (!actor.app) return userPart;
    return `${userPart}:${uuidToBase64url(actor.app.uid)}`;
};

/**
 * Peer controller — WebRTC signalling info + TURN credential generation.
 *
 * Config shape:
 *   config.peers.signaller_url  — WebRTC signaller URL
 *   config.peers.fallback_ice   — fallback ICE server list
 *   config.peers.turn.cloudflare_turn_service_id
 *   config.peers.turn.cloudflare_turn_api_token
 *   config.peers.turn.ttl       — credential TTL (default 86400)
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
            { subdomain: 'api' },
            this.#signallerInfo,
        );
        router.post(
            '/peer/generate-turn',
            { subdomain: 'api', requireAuth: true },
            this.#generateTurn,
        );
        router.post(
            '/turn/ingest-usage',
            { subdomain: 'api' },
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

    /** POST /peer/generate-turn — generate TURN credentials via Cloudflare. */
    #generateTurn = async (req: Request, res: Response): Promise<void> => {
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
        const serviceId = cfg.turn.cloudflare_turn_service_id;
        const apiToken = cfg.turn.cloudflare_turn_api_token;
        const ttl = cfg.turn.ttl;

        const customIdentifier = actorToTurnIdentifier(req.actor);

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
        res.json({ ttl, iceServers: data.iceServers });
    };

    /** POST /turn/ingest-usage — internal-only TURN egress metering.
     * an external service that knows the usage information from cloudflare will send it to us here.
     * Meters each record directly against the owning user via `services.metering.incrementUsage`
     * multiplied by turn:egress-bytes cost. */
    #ingestUsage = async (req: Request, res: Response): Promise<void> => {
        const cfg = this.config.peers;
        if (!cfg || !cfg.internal_auth_secret) {
            throw new HttpError(403, 'Forbidden', { legacyCode: 'forbidden' });
        }
        const expectedSecret = cfg.internal_auth_secret;
        const header = req.headers['x-puter-internal-auth'];
        if (!expectedSecret || header !== expectedSecret) {
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
                const actor = {
                    user: {
                        uuid: user.uuid,
                        id: user.id,
                        username: user.username,
                    },
                };
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
