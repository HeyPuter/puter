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

import type { Actor } from '../../core/actor.js';
import type { EventClient } from '../../clients/event/EventClient.js';
import type {
    ResolvedShare,
    ShareService,
} from '../../services/share/ShareService.js';
import { signEntryThumbnail } from '../fs/legacyFsHelpers.js';

/**
 * One share on the wire: only ever the username — never the internal id, and
 * never an email the caller didn't already supply.
 *
 * `thumbnail` is stored as an `s3://bucket/key` URI, so it is swapped for a
 * signed URL rather than emitted: the raw value names internal storage and no
 * client can render it.
 */
export async function toClientShare(
    eventClient: EventClient | undefined,
    share: ResolvedShare,
) {
    const thumbnail =
        share.thumbnail === undefined
            ? undefined
            : await signEntryThumbnail(
                  eventClient,
                  share.entryUid,
                  share.thumbnail,
              );
    return {
        uid: share.uid,
        mode: share.mode,
        path: share.path,
        // A share listing has no fsentry behind it for a client to stat.
        ...(share.name === undefined ? {} : { name: share.name }),
        ...(share.type === undefined ? {} : { type: share.type }),
        ...(thumbnail === undefined ? {} : { thumbnail }),
        ...(share.owner === undefined ? {} : { owner: share.owner.username }),
        ...(share.pending
            ? { pending: true, recipient_email: share.recipientEmail }
            : {}),
        // Set on a share call only, so a listing stays silent about it.
        ...(share.isNew === undefined ? {} : { is_new: share.isNew }),
        uid_entry: share.entryUid,
        is_dir: share.isDir,
        issuer: share.issuer.username,
        holder: share.holder.username,
        created_at: share.createdAt,
        issued_by_app: share.issuedByApp ?? null,
        inherited_from: share.inheritedFrom ?? null,
        modified: share.modified,
        size: share.size,
    };
}

/** Who can reach `uid`, or empty when the caller may not manage it. */
export async function listClientShares(
    shareService: ShareService,
    eventClient: EventClient | undefined,
    actor: Actor,
    uid: string,
) {
    const shares = await shareService.tryListSharesOf(actor, { uid });
    if (shares === null) return [];
    return Promise.all(
        shares.map((share) => toClientShare(eventClient, share)),
    );
}
