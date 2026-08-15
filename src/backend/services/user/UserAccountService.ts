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

import { PuterService } from '../types.js';

/**
 * Home directory plus the seven folders `generateDefaultFsentries` creates. An
 * account with no more than these has never had a file put in it.
 */
const PROVISIONED_FSENTRY_COUNT = 8;

/**
 * Account-lifecycle operations that more than one caller needs: deleting an
 * account and everything hanging off it, and measuring whether an account has
 * ever actually been used.
 *
 * Most `user_id` foreign keys are `ON DELETE SET NULL` rather than `CASCADE`,
 * so "delete the row" is never the whole job — anything reaching for that
 * shortcut leaves orphans behind. Go through `cascadeDelete`.
 */
export class UserAccountService extends PuterService {
    /**
     * Delete a user and the state that belongs to them: their files (S3 objects
     * included), their sessions, and the row itself.
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
        try {
            const rows = (await this.clients.db.read(
                'SELECT `uuid`, `stripe_customer_id` FROM `user` WHERE `id` = ?',
                [userId],
            )) as Array<{ uuid?: string; stripe_customer_id?: string | null }>;
            userUuid = rows[0]?.uuid;
            stripeCustomerId = rows[0]?.stripe_customer_id ?? null;
        } catch (e) {
            console.warn('[cascade-delete-user] identifier lookup failed:', e);
        }

        try {
            await this.services.fs.removeAllForUser(userId);
        } catch (e) {
            // Proceed with user-row delete anyway — orphaned fsentries are
            // better than a resurrected account.
            console.warn('[cascade-delete-user] fs cleanup failed:', e);
        }

        // Sessions FK is SET NULL, so delete explicitly to avoid dangling rows.
        await this.clients.db.write(
            'DELETE FROM `sessions` WHERE `user_id` = ?',
            [userId],
        );
        await this.clients.db.write('DELETE FROM `user` WHERE `id` = ?', [
            userId,
        ]);
        await this.stores.user.invalidateById(userId);

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
                },
                {},
            );
        } catch {
            // ignore — event emission shouldn't block deletion
        }
    }

    /**
     * Evidence that an account has been used for something — the signals that
     * separate "a row a race created and nobody ever touched" from "somebody's
     * account".
     *
     * Deliberately generous about what counts. A false "in use" costs a row
     * that sticks around; a false "unused" destroys somebody's files.
     *
     * `fsentryCount` is compared against the folders provisioned at signup, so
     * an account whose Desktop is still empty reads as untouched.
     */
    async getUsageSignals(userId: number): Promise<{
        userId: number;
        signals: string[];
        inUse: boolean;
        lastActivityTs: string | null;
    }> {
        // Each of these is a capped count, not a real one: the subquery stops at
        // `cap` rows, so a user with a million fsentries costs the same as one
        // with nine. We only ever compare against a small threshold.
        const cappedCount = async (
            table: string,
            column: string,
            cap: number,
        ): Promise<number> => {
            const sql =
                `SELECT COUNT(*) AS n FROM ` +
                `(SELECT 1 FROM \`${table}\` WHERE \`${column}\` = ? LIMIT ${cap}) t`;
            try {
                const rows = (await this.clients.db.read(sql, [
                    userId,
                ])) as Array<Record<string, unknown>>;
                return Number(rows[0]?.n ?? 0);
            } catch (e) {
                // A signal we cannot read is not a signal that is absent —
                // report it as present so the caller errs toward keeping.
                console.warn('[user-usage] signal query failed:', sql, e);
                return cap;
            }
        };

        // Through the store rather than a hand-written column list: several of
        // the columns read below (`stripe_customer_id`, `card_fingerprint`) are
        // prod-only additions that a self-hosted schema may not carry, and
        // naming them in SQL turns their absence into a thrown query instead of
        // an absent signal.
        const [
            row,
            sessionCount,
            appCount,
            subdomainCount,
            oidcCount,
            fsentryCount,
        ] = await Promise.all([
            this.stores.user.getById(userId, { force: true }),
            cappedCount('sessions', 'user_id', 1),
            cappedCount('apps', 'owner_user_id', 1),
            cappedCount('subdomains', 'user_id', 1),
            cappedCount('user_oidc_providers', 'user_id', 1),
            cappedCount('fsentries', 'user_id', PROVISIONED_FSENTRY_COUNT + 1),
        ]);

        const signals: string[] = [];
        if (sessionCount > 0) signals.push('sessions');
        if (appCount > 0) signals.push('apps');
        if (subdomainCount > 0) signals.push('subdomains');
        if (oidcCount > 0) signals.push('oidc-link');
        if (fsentryCount > PROVISIONED_FSENTRY_COUNT) signals.push('files');
        if (row?.stripe_customer_id) signals.push('stripe-customer');
        if (row?.card_fingerprint) signals.push('card-verified');
        if (row?.phone) signals.push('phone-verified');
        if (row?.last_activity_ts) signals.push('activity');

        return {
            userId,
            signals,
            inUse: signals.length > 0,
            lastActivityTs: (row?.last_activity_ts as string | null) ?? null,
        };
    }
}
