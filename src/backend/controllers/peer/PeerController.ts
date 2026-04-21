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

    /** POST /turn/ingest-usage — internal-only TURN egress metering.
     *
     * Accepts both `internal_auth_secret` (v2 name) and `turn_meter_secret`
     * (v1 name carried forward by the config migration tool), so existing
     * prod secrets keep working without a rename. Meters each record
     * directly against the owning user via `services.metering.incrementUsage`
     * with a per-byte costOverride — `turn:egress-bytes` doesn't live in
     * the cost map. */
    #ingestUsage = async (req: Request, res: Response): Promise<void> => {
        const cfg = this.#peerConfig() as typeof this.config.peers & {
            turn_meter_secret?: string;
        };
        const expectedSecret =
            cfg.internal_auth_secret ?? cfg.turn_meter_secret;
        const header = req.headers['x-puter-internal-auth'];
        if (!expectedSecret || header !== expectedSecret) {
            throw new HttpError(403, 'Forbidden');
        }

        const { records } = req.body ?? {};
        if (!Array.isArray(records)) {
            throw new HttpError(400, 'Missing `records` array');
        }

        for (const record of records) {
            if (!record || typeof record !== 'object') continue;
            const egressBytes = Number(record.egressBytes ?? 0);
            if (egressBytes <= 0) continue;

            // base64url-encoded hex uuid, no dashes. Decode + re-dash.
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
                    // can't decode — skip this record
                }
            }
            if (!userUuid) continue;

            try {
                const user = await this.stores.user.getByUuid(userUuid);
                if (!user) continue;
                // $0.005 per byte microcents matches the v1 rate (≈$5/GB).
                // Not in COST_MAPS, so pass as costOverride; incrementUsage
                // accepts it as the full cost for `usageAmount` bytes.
                const costInMicrocents = egressBytes * 0.005;
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
                console.error(
                    '[peer] TURN metering failed:',
                    (e as Error).message,
                );
            }
        }

        res.json({ ok: true });
    };

    #peerConfig(): NonNullable<typeof this.config.peers> {
        return this.config.peers ?? {};
    }
}
