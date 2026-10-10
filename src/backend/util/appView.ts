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

import type { AppIconHostConfig } from './appIcon.js';
import { getAppIconCdnUrl, getAppIconUrl } from './appIcon.js';
import { buildHostedBackingDenial } from './hostedAppBacking.js';
import type { PrivateLaunchDecision } from './privateLaunchAccess.js';

/** A raw `apps` store row. */
export type AppRow = Record<string, unknown>;

/** Client shape of an app. Never carries internal ids or the owner's id. */
export interface AppView {
    uid: unknown;
    name: unknown;
    title: unknown;
    description: unknown;
    icon: unknown;
    index_url?: unknown;
    background: boolean;
    maximize_on_start: boolean;
    feedback_enabled: boolean;
    godmode: boolean;
    is_private: boolean;
    protected: boolean;
    approved_for_listing: boolean;
    approved_for_opening_items: boolean;
    approved_for_incentive_program: boolean;
    metadata: unknown;
    filetype_associations: string[];
    created_at: unknown;
    privateAccess?: PrivateLaunchDecision;
}

/** Launch decisions for one viewer, resolved by `AppService`. */
export interface AppViewGates {
    viewerUserId?: number | null;
    privateAccess?: PrivateLaunchDecision;
    hostedBackingUnavailable?: boolean;
}

/**
 * Build an app's client view. This is the one place the launch gates strip
 * `index_url`: a private app the viewer may not open, and a puter-hosted app
 * whose backing is gone or reclaimed (its owner still sees the URL).
 */
export function toAppView(
    app: AppRow,
    filetypes: string[],
    gates: AppViewGates = {},
): AppView {
    const view: AppView = {
        uid: app.uid,
        name: app.name,
        title: app.title,
        description: app.description,
        icon: app.icon,
        index_url: app.index_url,
        background: Boolean(app.background),
        maximize_on_start: Boolean(app.maximize_on_start),
        feedback_enabled: Boolean(app.feedback_enabled),
        godmode: Boolean(app.godmode),
        is_private: Boolean(app.is_private),
        protected: Boolean(app.protected),
        approved_for_listing: Boolean(app.approved_for_listing),
        approved_for_opening_items: Boolean(app.approved_for_opening_items),
        approved_for_incentive_program: Boolean(
            app.approved_for_incentive_program,
        ),
        metadata: app.metadata ?? null,
        filetype_associations: filetypes,
        created_at: app.created_at ?? app.timestamp ?? null,
    };

    if (gates.privateAccess) {
        view.privateAccess = gates.privateAccess;
        if (!gates.privateAccess.hasAccess) delete view.index_url;
    }
    // Independent of the private gate; an existing denial is kept.
    if (gates.hostedBackingUnavailable) {
        if (view.privateAccess?.hasAccess !== false) {
            view.privateAccess = buildHostedBackingDenial();
        }
        if (gates.viewerUserId !== app.owner_user_id) delete view.index_url;
    }
    return view;
}

/** An app's view plus what a direct read adds, as `AppService.views` returns it. */
export interface AppClientView {
    view: AppView;
    /** The origin when this row is its origin's canonical app, else null. */
    createdFromOrigin: string | null;
}

/**
 * The `puter-apps` read shape: the gated view, `created_from_origin`, stats,
 * and the owner block when the viewer owns the app.
 */
export function toAppReadView(
    app: AppRow,
    { view, createdFromOrigin }: AppClientView,
    {
        viewer,
        stats,
        iconSize,
    }: {
        viewer?: { id?: number; username?: string; uuid?: string } | null;
        stats?: unknown;
        /** Echoed back; kept for clients that send it. */
        iconSize?: unknown;
    } = {},
): Record<string, unknown> {
    const result: Record<string, unknown> = {
        ...view,
        created_from_origin: createdFromOrigin,
        stats: stats ?? null,
    };
    if (viewer?.id !== undefined && viewer.id === app.owner_user_id) {
        result.owner = { username: viewer.username, uuid: viewer.uuid };
    }
    if (iconSize) result.icon_size = iconSize;
    return result;
}

export interface AppSummaryOptions {
    apiBaseUrl?: string;
    config?: AppIconHostConfig;
    iconSize?: number;
}

/**
 * The summary the desktop launches from directly, without re-reading the app
 * (suggested, recommended, recent and taskbar apps), so every launch-relevant
 * flag belongs here.
 */
export function toAppSummary(
    app: AppRow,
    { apiBaseUrl, config, iconSize }: AppSummaryOptions,
) {
    return {
        uuid: app.uid,
        name: app.name,
        title: app.title,
        icon: getAppIconUrl(app, { apiBaseUrl }, iconSize) ?? app.icon ?? null,
        // Direct subdomain URL for the client to try before `icon`.
        iconCdnUrl: config ? getAppIconCdnUrl(app, config, iconSize) : null,
        godmode: Boolean(app.godmode),
        maximize_on_start: Boolean(app.maximize_on_start),
        index_url: app.index_url,
        feedback_enabled: Boolean(app.feedback_enabled),
        // An app with no owner isn't owned by a Puter user — it's an
        // "external" (origin-bootstrapped) app.
        external: app.owner_user_id == null || app.owner_user_id === '',
    };
}
