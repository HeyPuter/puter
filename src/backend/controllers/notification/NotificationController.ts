import type { Request, Response } from 'express';
import { Controller, Post } from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { NotificationService } from '../../services/notification/NotificationService.js';
import { PuterController } from '../types.js';

/**
 * GUI-facing notification endpoints. These supplement the
 * `puter-notifications` driver (which handles CRUD via `/drivers/call`)
 * with two small mutation routes that the puter desktop client calls
 * directly.
 *
 * Both routes emit `outer.gui.notif.ack` via the NotificationService
 * so other open tabs for the same user see the state change immediately.
 */
@Controller('/notif')
export class NotificationController extends PuterController {
    /**
     * POST /notif/mark-ack — user dismissed a notification.
     * Sets `acknowledged` timestamp; pushes ack event to sockets.
     */
    @Post('/mark-ack', { subdomain: 'api', requireAuth: true })
    async markAck (req: Request, res: Response): Promise<void> {
        const uid = req.body?.uid;
        if ( typeof uid !== 'string' || uid.length === 0 ) {
            throw new HttpError(400, '`uid` must be a non-empty string');
        }
        const userId = req.actor?.user?.id;
        if ( ! userId ) throw new HttpError(401, 'Unauthorized');

        const notifService = this.services.notification as unknown as NotificationService | undefined;
        if ( notifService?.markAcknowledged ) {
            await notifService.markAcknowledged(uid, userId);
        } else {
            // Fallback: direct store call if service isn't wired
            await (this.stores as Record<string, unknown> as { notification: { markAcknowledged: (uid: string, userId: number) => Promise<boolean> } }).notification.markAcknowledged(uid, userId);
        }
        res.json({});
    }

    /**
     * POST /notif/mark-read — user saw a notification.
     * Sets `shown` timestamp; pushes ack event to sockets.
     */
    @Post('/mark-read', { subdomain: 'api', requireAuth: true })
    async markRead (req: Request, res: Response): Promise<void> {
        const uid = req.body?.uid;
        if ( typeof uid !== 'string' || uid.length === 0 ) {
            throw new HttpError(400, '`uid` must be a non-empty string');
        }
        const userId = req.actor?.user?.id;
        if ( ! userId ) throw new HttpError(401, 'Unauthorized');

        const notifService = this.services.notification as unknown as NotificationService | undefined;
        if ( notifService?.markShown ) {
            await notifService.markShown(uid, userId);
        } else {
            await (this.stores as Record<string, unknown> as { notification: { markShown: (uid: string, userId: number) => Promise<boolean> } }).notification.markShown(uid, userId);
        }
        res.json({});
    }
}
