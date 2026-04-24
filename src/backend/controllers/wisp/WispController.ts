import type { Request, Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterController } from '../types.js';

/**
 * WISP relay token controller — create and verify short-lived JWT tokens
 * for the WISP network proxy.
 *
 * Config: `config.wisp.server` — WISP relay server address.
 */
export class WispController extends PuterController {
    registerRoutes(router: PuterRouter): void {
        router.post(
            '/wisp/relay-token/create',
            { subdomain: 'api', requireAuth: true },
            this.#create,
        );
        router.post(
            '/wisp/relay-token/verify',
            { subdomain: 'api', requireAuth: false },
            this.#verify,
        );
    }

    /** POST /wisp/relay-token/create — mint a relay token (auth optional). */
    #create = async (req: Request, res: Response): Promise<void> => {
        const actor = req.actor;
        const wispCfg = this.#wispConfig();

        if (actor?.user?.uuid) {
            const token = this.services.token.sign(
                'wisp',
                {
                    $: 'token:wisp',
                    $v: '0.0.0',
                    user_uid: actor.user.uuid,
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
            throw new HttpError(400, 'Missing `token`');
        }

        let decoded: Record<string, unknown>;
        try {
            decoded = this.services.token.verify<Record<string, unknown>>(
                'wisp',
                bodyToken,
            );
            if (decoded.$ !== 'token:wisp') throw new Error('wrong token type');
        } catch {
            throw new HttpError(403, 'Forbidden');
        }

        // Build policy event — extensions can deny via extension.on('wisp.get-policy')
        const isGuest = Boolean(decoded.guest);
        let user: Record<string, unknown> | null = null;
        if (!isGuest && decoded.user_uid) {
            user = await this.stores.user.getByUuid(String(decoded.user_uid));
        }

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
            throw new HttpError(403, 'Forbidden');
        }

        res.json(event.policy);
    };

    #wispConfig(): NonNullable<typeof this.config.wisp> {
        return this.config.wisp ?? {};
    }
}
