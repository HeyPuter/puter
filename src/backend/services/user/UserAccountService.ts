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

import type {
    FlatPermRef,
    GroupMember,
} from '../../stores/permission/PermissionStore.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { PuterService } from '../types.js';

/** Apps read per page when listing the ones an account owns. */
const OWNED_APPS_PAGE = 500;

/**
 * Account deletion that more than one caller needs: the account and everything
 * hanging off it.
 *
 * Most `user_id` foreign keys cascade, but only inside the database: S3
 * objects, sites, flat permission entries and caches outlive a bare row delete.
 * Audit and analytics tables are `ON DELETE SET NULL`, so their history stays.
 * Go through `cascadeDelete`.
 */
export class UserAccountService extends PuterService {
    /**
     * Delete a user and the state that belongs to them: their files (S3 objects
     * included), their sites, their sessions, and the row itself.
     *
     * Irreversible. Filesystem teardown failures are logged and stepped over —
     * an orphaned fsentry is a smaller problem than an account that half
     * survives its own deletion.
     */
    async cascadeDelete(userId: number): Promise<void> {
        // Capture the identifiers downstream teardown needs before the row is
        // gone — the marketplace extension cancels the user's Stripe
        // subscriptions off `user.delete`, keyed by uuid / customer id.
        let userUuid: string | undefined;
        let stripeCustomerId: string | null = null;
        // Cache keys the row answers under, captured while it still exists.
        let cachedIdentity: UserRow | null = null;
        try {
            // Read from the primary, uncached; the row carries every column,
            // so a schema without `stripe_customer_id` still yields the rest.
            cachedIdentity = await this.stores.user.getById(userId, {
                cached: false,
                force: true,
            });
            userUuid = cachedIdentity?.uuid;
            stripeCustomerId =
                (cachedIdentity?.stripe_customer_id as string | null) ?? null;
        } catch (e) {
            console.warn('[cascade-delete-user] identifier lookup failed:', e);
        }

        // Same reason, one table over: the membership row cascades on delete.
        const seat =
            (await this.services.team?.captureSeatForBilling(userId)) ?? null;

        // The SQL rows cascade with the user; the flat entries are keyed on the
        // holder, so without this the access outlives the issuer.
        let issuedRefs: FlatPermRef[] = [];
        try {
            issuedRefs =
                await this.stores.permission.listUserUserPermRefsIssuedBy(
                    userId,
                );
        } catch (e) {
            console.warn(
                '[cascade-delete-user] issued-grant lookup failed:',
                e,
            );
        }

        try {
            await this.services.fs.removeAllForUser(userId);
        } catch (e) {
            // Proceed with user-row delete anyway — orphaned fsentries are
            // better than a resurrected account.
            console.warn('[cascade-delete-user] fs cleanup failed:', e);
        }

        try {
            await this.#deleteSubdomains(userId);
        } catch (e) {
            console.warn('[cascade-delete-user] subdomain cleanup failed:', e);
        }

        // The user's apps cascade away with the row, with no `app.changed`, so
        // `user.delete` names them for what was tied to them.
        let appUids: string[] = [];
        try {
            appUids = await this.#ownedAppUids(userId);
        } catch (e) {
            console.warn('[cascade-delete-user] owned-app lookup failed:', e);
        }
        // Record them first so a hosted origin doesn't hand their uids to the
        // subdomain's next owner.
        await this.stores.app.recordDeletedForOwner(userId);
        // Other users' sites and workers tied to those apps cascade too.
        const appSites = await this.stores.subdomain.listAppCascade({
            ownerUserId: userId,
        });

        // Handles the account holds cascade with the row and nothing is told,
        // so what their owners subscribed to through them would stay active
        // and silent. Retiring them first ends those subscriptions.
        try {
            await this.services.kvShare.retireForDeletedHolder(userId);
        } catch (e) {
            console.warn('[cascade-delete-user] kv share retire failed:', e);
        }

        // Revoked first so open sockets and relays hear about it; the FK is
        // SET NULL, so the rows are then deleted explicitly.
        await this.services.auth.revokeAllSessionsForUserId(userId);
        await this.stores.session.deleteAllForUser(userId);
        // Its group grants cascade too, so their members' readings change.
        let granted: GroupMember[] = [];
        try {
            granted =
                await this.stores.permission.listIssuedGroupMembers(userId);
        } catch (e) {
            console.warn('[cascade-delete-user] granted-group read failed:', e);
        }
        let holderUuids: string[] = [];
        try {
            const holders = await this.stores.user.getByIds([
                ...new Set(issuedRefs.map((ref) => ref.holderUserId)),
            ]);
            holderUuids = [...holders.values()].map((user) => user.uuid);
        } catch (e) {
            console.warn('[cascade-delete-user] grant holder read failed:', e);
        }

        // Group reads go to the primary while the memberships cascade away.
        await this.stores.permission.markGroupMembershipChanged([
            userId,
            ...granted.map((member) => member.id),
        ]);
        await this.stores.user.deleteById(userId, cachedIdentity);
        // Its issued grant rows cascaded; holders' cached copies still name it.
        await this.stores.permission.markUserUserPermsChanged(
            issuedRefs.map((ref) => ref.holderUserId),
        );
        await this.stores.subdomain.forgetCascadeDeleted(appSites);

        if (issuedRefs.length > 0) {
            try {
                await this.stores.permission.delFlatUserPerms(issuedRefs);
            } catch (e) {
                console.warn(
                    '[cascade-delete-user] issued-grant flat purge failed:',
                    e,
                );
            }
        }

        // Grants the account held live in the flat view under its id, which
        // nothing else removes.
        try {
            await this.stores.permission.purgeFlatUserPermsHeldBy(userId);
        } catch (e) {
            console.warn(
                '[cascade-delete-user] held-grant flat purge failed:',
                e,
            );
        }
        // Last: a check before the purges would cache the flat entries' answer.
        await this.stores.permission.bumpCacheGenerations(
            [userUuid, ...granted.map((m) => m.uuid), ...holderUuids]
                .filter((uuid): uuid is string => Boolean(uuid))
                .map((uuid) => `user:${uuid}`),
        );

        // Fire-and-forget: let listeners purge external state tied to the
        // account (Stripe subscriptions are cancelled immediately, without
        // proration). Emitted after the row delete — listeners key off the
        // payload, not the DB row.
        try {
            this.clients.event?.emit(
                'user.delete',
                {
                    user_id: userId,
                    user_uuid: userUuid,
                    stripe_customer_id: stripeCustomerId,
                    appUids,
                },
                {},
            );
        } catch {
            // ignore — event emission shouldn't block deletion
        }
        // Tells prod to stop charging the owner for this seat.
        this.services.team?.emitSeatDeleted(seat);
        // The membership row cascaded away, so anything keyed on it is stale.
        if (seat) {
            try {
                await this.services.team?.forgetSeat(seat);
            } catch (e) {
                console.warn(
                    '[cascade-delete-user] seat cache cleanup failed:',
                    e,
                );
            }
        }
    }

    /** The uids of every app this user owns, a page at a time. */
    async #ownedAppUids(userId: number): Promise<string[]> {
        const uids: string[] = [];
        let afterId: number | undefined;
        for (;;) {
            const apps = (await this.stores.app.list({
                ownerUserId: userId,
                afterId,
                limit: OWNED_APPS_PAGE,
            })) as Array<{ id: number; uid: string }>;
            uids.push(...apps.map((app) => app.uid));
            if (apps.length < OWNED_APPS_PAGE) return uids;
            afterId = apps[apps.length - 1]!.id;
        }
    }

    /**
     * Delete the user's sites one by one, emitting `subdomain.delete` for each
     * as the driver does. The FK cascade would drop the rows silently, leaving
     * cached lookups and deployed scripts behind.
     */
    async #deleteSubdomains(userId: number): Promise<void> {
        let afterId: number | undefined;
        for (;;) {
            const rows = (await this.stores.subdomain.listByUserId(userId, {
                afterId,
            })) as Array<{ id: number; uuid: string; subdomain: string }>;
            if (rows.length === 0) return;
            for (const row of rows) {
                await this.stores.subdomain.deleteByUuid(String(row.uuid), {
                    userId,
                });
                try {
                    this.clients.event.emit(
                        'subdomain.delete',
                        {
                            subdomain: row.subdomain,
                            uid: String(row.uuid),
                            userId,
                        },
                        {},
                    );
                } catch {
                    // Non-critical.
                }
            }
            afterId = rows[rows.length - 1]!.id;
        }
    }
}
