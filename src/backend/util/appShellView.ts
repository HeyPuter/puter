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

/**
 * The app projection baked into the rendered GUI shell for `/app/:name`.
 *
 * This is a _preview_ — page metadata and enough app identity for the boot
 * script to know what it is about to open. It is deliberately not the launch
 * authority: the GUI re-reads the app through the apps driver before it
 * launches anything, and that read is where the private-app entitlement gate
 * and the hosted-backing guard run.
 *
 * Because of that split, this projection omits `index_url` entirely rather than
 * gating it. Nothing in the shell can launch from it, so shipping a launch URL
 * in server-rendered HTML — to an anonymous reader, cached by intermediaries,
 * visible in view-source — buys nothing and risks leaking a private app's
 * hosting URL. Omitting it also keeps this function free of I/O: gating
 * `index_url` is what forced the origin-canonicalization and
 * subdomain-ownership lookups, and those are pure cost on a request whose job
 * is to return HTML.
 *
 * Raw store rows must never reach the shell: they carry `owner_user_id`,
 * moderation flags, and the private `index_url`.
 */

/** A raw `apps` store row. */
type AppRow = Record<string, unknown>;

/** The safe field subset embedded in the shell. */
export interface AppShellView {
    uid: unknown;
    name: unknown;
    title: unknown;
    description: unknown;
    icon: unknown;
    background: boolean;
    maximize_on_start: boolean;
    godmode: boolean;
    is_private: boolean;
    protected: boolean;
    approved_for_listing: boolean;
    approved_for_opening_items: boolean;
    approved_for_incentive_program: boolean;
    metadata: unknown;
    created_at: unknown;
}

/**
 * Project a raw app row down to the fields the shell may embed.
 *
 * Pure and synchronous by design — see the module note above. Returns null for
 * a missing row so callers can pass a lookup result straight through.
 */
export function toAppShellView(
    app: AppRow | null | undefined,
): AppShellView | null {
    if (!app) return null;

    return {
        uid: app.uid,
        name: app.name,
        title: app.title,
        description: app.description,
        icon: app.icon,
        background: Boolean(app.background),
        maximize_on_start: Boolean(app.maximize_on_start),
        godmode: Boolean(app.godmode),
        is_private: Boolean(app.is_private),
        protected: Boolean(app.protected),
        approved_for_listing: Boolean(app.approved_for_listing),
        approved_for_opening_items: Boolean(app.approved_for_opening_items),
        approved_for_incentive_program: Boolean(
            app.approved_for_incentive_program,
        ),
        metadata: app.metadata ?? null,
        created_at: app.created_at ?? app.timestamp,
    };
}
