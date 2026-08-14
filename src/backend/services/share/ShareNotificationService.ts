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

import type { Actor } from '../../core/actor';
import type { LayerInstances } from '../../types';
import type { puterServices } from '../index';
import { PuterService } from '../types';
import {
    SHARE_NOTIFY_WINDOW_SECONDS,
    type ResolvedShare,
} from './ShareService';

/**
 * Telling people what has been shared with them.
 *
 * Separate from `ShareService` because delivery is its own problem: it grows
 * email, per-pair suppression windows and per-recipient daily caps, none of
 * which the grant path should have to know about. Sharing succeeds or fails on
 * its own; being told about it is best-effort and always off the response
 * path.
 */
export class ShareNotificationService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    /**
     * Announce a batch of successful shares, one notification per recipient.
     *
     * Takes the whole batch rather than a single share so that sharing five
     * items with one person is one notification, not five. Never throws — a
     * share that already landed must not be reported as failed because the
     * announcement didn't.
     *
     * Only shares that created new reach count. A mode change is not something
     * to interrupt someone for, and re-sharing what they already have spends no
     * quota — so the window is what keeps that from becoming a way to spam.
     */
    async notifyShared(actor: Actor, shares: ResolvedShare[]): Promise<void> {
        try {
            const issuerId = actor.user?.id;
            const issuer = actor.user?.username;
            if (typeof issuerId !== 'number') return;

            const counts = new Map<number, number>();
            for (const share of shares) {
                if (!share.isNew || !share.holderId) continue;
                if (share.holderId === issuerId) continue;
                counts.set(
                    share.holderId,
                    (counts.get(share.holderId) ?? 0) + 1,
                );
            }
            if (counts.size === 0) return;

            for (const [holderId, count] of counts) {
                if (!(await this.#claimNotifySlot(issuerId, holderId))) {
                    continue;
                }
                await this.services.notification.notify([holderId], {
                    source: 'sharing',
                    title: `${issuer} shared ${count === 1 ? 'an item' : `${count} items`} with you`,
                    template: 'file-shared-with-you',
                    fields: { username: issuer, count },
                });
            }
        } catch {
            // Best-effort by design; see the class comment.
        }
    }

    /** False when this pair was already notified inside the window. */
    async #claimNotifySlot(
        issuerId: number,
        holderId: number,
    ): Promise<boolean> {
        try {
            const claimed = await this.clients.redis.set(
                `share:notify:${issuerId}:${holderId}`,
                '1',
                'EX',
                SHARE_NOTIFY_WINDOW_SECONDS,
                'NX',
            );
            return claimed === 'OK';
        } catch {
            // Notifying twice beats going silent when the cache is down.
            return true;
        }
    }
}
