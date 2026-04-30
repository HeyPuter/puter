import type { Request, Response } from 'express';
import { Controller, Post } from '../../core/http/decorators.js';
import type { BroadcastService } from '../../services/broadcast/BroadcastService.js';
import { PuterController } from '../types.js';

/**
 * Receive signed broadcast webhooks from peer Puter instances.
 *
 * The route is intentionally a thin shell: parse the four custom
 * `X-Broadcast-*` headers, hand the raw body + parsed body off to
 * `BroadcastService.verifyAndEmit()`, and translate its structured
 * result into HTTP. All the cryptography, replay protection, and
 * event-bus dispatch live in the service so they're reusable from
 * tests / direct callers.
 *
 * Mounted with `subdomain: '*'` (any host) because peers reach the
 * webhook through the ALB DNS, not the public `api.<domain>` subdomain,
 * so the host header can be an internal ALB hostname rather than
 * `api.<domain>` or `<domain>`. Authentication is via the HMAC +
 * peer-id + nonce triple, not the host.
 *
 * `req.rawBody` is captured by the global JSON parser and is what the
 * HMAC verifies against — do NOT switch this route to a custom body
 * parser without preserving the raw bytes.
 */
@Controller('/broadcast')
export class BroadcastController extends PuterController {
    @Post('/webhook', { subdomain: '*' })
    async webhook(req: Request, res: Response): Promise<void> {
        const broadcast = this.services.broadcast as unknown as
            | BroadcastService
            | undefined;
        if (!broadcast) {
            res.status(503).json({
                error: { message: 'Broadcast service not registered' },
            });
            return;
        }

        const headerOnce = (name: string): string | undefined => {
            const value = req.headers[name];
            if (Array.isArray(value)) return value[0];
            return value;
        };

        const result = await broadcast.verifyAndEmit(req.rawBody, req.body, {
            peerId: headerOnce('x-broadcast-peer-id'),
            timestamp: headerOnce('x-broadcast-timestamp'),
            nonce: headerOnce('x-broadcast-nonce'),
            signature: headerOnce('x-broadcast-signature'),
        });

        if (result.ok) {
            res.status(200).json({ ok: true, ...(result.info ?? {}) });
            return;
        }
        res.status(result.status ?? 400).json({
            error: { message: result.message ?? 'Bad request' },
        });
    }
}
