import type { Request, Response } from 'express';
import { Controller, Post } from '../../core/http/decorators.js';
import type { EntriDriver } from '../../drivers/entri/EntriDriver.js';
import { PuterController } from '../types.js';

/**
 * Receives Entri webhook callbacks for DNS propagation confirmation.
 *
 * When a user initiates custom-domain setup via `entri.getConfig()`, the
 * subdomain row is marked `domain = 'in-progress:<domain>'`. After DNS
 * propagates, Entri POSTs here, and we flip the domain to its real value.
 *
 * Mounted at `subdomain: '*'` so Entri's servers reach us regardless of
 * what Host header they send.
 */
@Controller('/entri')
export class EntriController extends PuterController {
    @Post('/webhook', { subdomain: '*' })
    async webhook (req: Request, res: Response): Promise<void> {
        const entri = this.drivers.entri as unknown as EntriDriver | undefined;
        if ( ! entri?.handleWebhook ) {
            res.status(503).json({ error: 'Entri driver not registered' });
            return;
        }

        const signature = typeof req.headers['entri-signature'] === 'string'
            ? req.headers['entri-signature']
            : undefined;

        const result = await entri.handleWebhook(req.body ?? {}, signature);
        if ( ! result.ok ) {
            res.status(401).json({ error: result.message ?? 'Invalid' });
            return;
        }
        res.status(200).send('ok');
    }
}
