import type { Request, Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterController } from '../types.js';

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
    registerRoutes(router: PuterRouter): void {
        router.get(
            '/peer/signaller-info',
            { subdomain: 'api' },
            this.#signallerInfo,
        );
        router.post(
            '/peer/generate-turn',
            { subdomain: 'api' },
            this.#generateTurn,
        );
        router.post(
            '/turn/ingest-usage',
            { subdomain: '*' },
            this.#ingestUsage,
        );
    }

    /** GET /peer/signaller-info — public, no auth required. */
    #signallerInfo = (_req: Request, res: Response): void => {
        const cfg = this.#peerConfig();
        res.json({
            url: cfg.signaller_url ?? null,
            fallbackIce: cfg.fallback_ice ?? [],
        });
    };

    /** POST /peer/generate-turn — generate TURN credentials via Cloudflare. */
    #generateTurn = async (req: Request, res: Response): Promise<void> => {
        const cfg = this.#peerConfig();
        const turnCfg = cfg.turn;
        if (
            !turnCfg?.cloudflare_turn_service_id ||
            !turnCfg?.cloudflare_turn_api_token
        ) {
            throw new HttpError(503, 'TURN not configured');
        }

        const serviceId = turnCfg.cloudflare_turn_service_id;
        const apiToken = turnCfg.cloudflare_turn_api_token;
        const ttl = Number(turnCfg.ttl ?? 86400);

        const cfRes = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${serviceId}/credentials/generate`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ttl }),
            },
        );

        if (!cfRes.ok) {
            const body = await cfRes.text();
            console.warn(
                '[peer] Cloudflare TURN credential generation failed',
                cfRes.status,
                body,
            );
            throw new HttpError(502, 'TURN credential generation failed');
        }

        const data = (await cfRes.json()) as { iceServers?: unknown };
        res.json({ ttl: ttl * 1000, iceServers: data.iceServers ?? [] });
    };

    /** POST /turn/ingest-usage — internal-only TURN egress metering. */
    #ingestUsage = async (req: Request, res: Response): Promise<void> => {
        const cfg = this.#peerConfig();
        const internalSecret = cfg.internal_auth_secret;
        const header = req.headers['x-puter-internal-auth'];
        if (!internalSecret || header !== internalSecret) {
            throw new HttpError(403, 'Forbidden');
        }

        const { records } = req.body ?? {};
        if (!Array.isArray(records)) {
            throw new HttpError(400, 'Missing `records` array');
        }

        // Record TURN egress bytes as metering events
        for (const record of records) {
            if (!record || typeof record !== 'object') continue;
            const egressBytes = Number(record.egressBytes ?? 0);
            if (egressBytes <= 0) continue;

            // Decode user ID from base64url
            let userUuid: string | null = null;
            if (record.userId) {
                try {
                    const buf = Buffer.from(String(record.userId), 'base64url');
                    const hex = buf.toString('hex');
                    if (hex.length === 32) {
                        userUuid = [
                            hex.slice(0, 8),
                            hex.slice(8, 12),
                            hex.slice(12, 16),
                            hex.slice(16, 20),
                            hex.slice(20),
                        ].join('-');
                    }
                } catch {
                    // can't decode — skip
                }
            }

            if (userUuid) {
                // Best-effort metering — fire and forget
                this.clients.event.emit(
                    'turn.egress',
                    {
                        user_uuid: userUuid,
                        egress_bytes: egressBytes,
                        timestamp: record.timestamp,
                    },
                    {},
                );
            }
        }

        res.json({ ok: true });
    };

    #peerConfig(): NonNullable<typeof this.config.peers> {
        return this.config.peers ?? {};
    }
}
