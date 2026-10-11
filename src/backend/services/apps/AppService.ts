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
import {
    toAppView,
    type AppClientView,
    type AppRow,
} from '../../util/appView.js';
import { hostedIndexUrlBackingsAreUnavailable } from '../../util/hostedAppBacking.js';
import {
    resolvePrivateLaunchAccess,
    type PrivateLaunchDecision,
} from '../../util/privateLaunchAccess.js';
import { PuterService } from '../types.js';

/** The canonical app row behind an app's `index_url` origin. */
interface CanonicalForIndexUrl {
    origin: string;
    /** Oldest `apps.index_url` match, or a derived uid for unknown origins. */
    expectedUid: string;
    /** Null when `expectedUid` is derived and has no row. */
    canonicalApp: AppRow | null;
}

/** Parsed `protocol//hostname[:port]` origin of an index_url, or null. */
function indexUrlOrigin(indexUrl: unknown): string | null {
    if (!indexUrl || typeof indexUrl !== 'string') return null;
    try {
        const parsed = new URL(indexUrl);
        return `${parsed.protocol}//${parsed.hostname}${
            parsed.port ? `:${parsed.port}` : ''
        }`;
    } catch {
        return null;
    }
}

const accessPermission = (app: AppRow) => `app:uid#${app.uid}:access`;

/**
 * App visibility and client views, for every entry point that hands app rows to
 * a client: the apps and subdomains drivers and the app routes.
 */
export class AppService extends PuterService {
    /**
     * The apps in `apps` the actor may read: unprotected ones, its own app, the
     * ones it owns, and protected ones it holds an access grant for (one
     * batched check).
     */
    async filterReadable(apps: AppRow[], actor: Actor): Promise<AppRow[]> {
        const needsGrant = apps.filter(
            (app) =>
                app.protected &&
                actor.effectiveApp?.uid !== app.uid &&
                actor.user?.id !== app.owner_user_id,
        );
        let grants = new Map<string, boolean>();
        if (needsGrant.length > 0) {
            try {
                grants = await this.services.permission.checkMany(
                    actor,
                    needsGrant.map(accessPermission),
                );
            } catch {
                grants = new Map();
            }
        }
        const denied = new Set(
            needsGrant.filter((app) => !grants.get(accessPermission(app))),
        );
        return apps.filter((app) => !denied.has(app));
    }

    /**
     * Client views for `apps`, aligned with the input, with the launch gates
     * resolved for `actor`. Every lookup is batched across the list.
     */
    async views(
        apps: AppRow[],
        actor: Actor | undefined,
        {
            source = 'appDriver:toClient',
            filetypesByAppId,
        }: {
            /** Reported to `app.privateAccess.resolveLaunch` listeners. */
            source?: string;
            filetypesByAppId?: Map<unknown, string[]>;
        } = {},
    ): Promise<AppClientView[]> {
        if (apps.length === 0) return [];
        const [filetypes, canonicals, hostedUnavailable] = await Promise.all([
            filetypesByAppId ??
                (this.stores.app.getFiletypeAssociationsByIds(
                    apps.map((app) => app.id),
                ) as Promise<Map<unknown, string[]>>),
            this.#resolveCanonicalForIndexUrls(apps),
            hostedIndexUrlBackingsAreUnavailable({
                apps,
                subdomainStore: this.stores.subdomain,
                config: this.config,
            }),
        ]);

        return Promise.all(
            apps.map(async (app, i) => {
                const canonical = canonicals[i];
                const privateAccess = await this.#privateAccess(
                    app,
                    canonical,
                    actor,
                    source,
                );
                return {
                    view: toAppView(app, filetypes.get(app.id) ?? [], {
                        viewerUserId: actor?.user?.id,
                        privateAccess,
                        hostedBackingUnavailable: hostedUnavailable[i],
                    }),
                    createdFromOrigin:
                        canonical?.expectedUid === app.uid
                            ? canonical.origin
                            : null,
                };
            }),
        );
    }

    /**
     * Private-app entitlement. A row whose `index_url` belongs to a different,
     * private canonical app is gated as that app: pre-existing rows squatting
     * on someone's private hosted URL must not leak it. Otherwise only a
     * private row is gated. Undefined means no gate.
     */
    async #privateAccess(
        app: AppRow,
        canonical: CanonicalForIndexUrl | null,
        actor: Actor | undefined,
        source: string,
    ): Promise<PrivateLaunchDecision | undefined> {
        const canonicalMismatchPrivate =
            !!canonical &&
            canonical.expectedUid !== app.uid &&
            !!canonical.canonicalApp?.is_private;
        const gateTarget = canonicalMismatchPrivate
            ? canonical.canonicalApp!
            : app.is_private
              ? app
              : null;
        if (!gateTarget) return undefined;

        const viewerId = actor?.user?.id;
        if (viewerId !== undefined && viewerId === gateTarget.owner_user_id) {
            return { hasAccess: true, checkedBy: 'core/app-owner' };
        }
        return resolvePrivateLaunchAccess({
            app: {
                uid: gateTarget.uid as string,
                name: gateTarget.name as string,
                is_private: true,
            },
            eventClient: this.clients.event,
            userUid: actor?.user?.uuid ?? null,
            source: canonicalMismatchPrivate
                ? `${source}:canonical-private`
                : source,
            args: {},
        });
    }

    /**
     * The canonical app behind each app's `index_url`, aligned with `apps`
     * (null for a missing or unparseable URL). Feeds `created_from_origin` and
     * the canonical-private gate.
     */
    async #resolveCanonicalForIndexUrls(
        apps: AppRow[],
    ): Promise<Array<CanonicalForIndexUrl | null>> {
        const origins = apps.map((app) => indexUrlOrigin(app.index_url));
        const uniqueOrigins = [
            ...new Set(origins.filter((o): o is string => o !== null)),
        ];

        let uidByOrigin = new Map<string, string | null>();
        if (uniqueOrigins.length > 0) {
            try {
                uidByOrigin =
                    await this.services.auth.appUidsFromOrigins(uniqueOrigins);
            } catch {
                uidByOrigin = new Map();
            }
        }

        // The self-match common case needs no fetch: `app` is that row.
        const uidsToFetch = new Set<string>();
        for (let i = 0; i < apps.length; i++) {
            const origin = origins[i];
            if (!origin) continue;
            const expectedUid = uidByOrigin.get(origin);
            if (expectedUid && expectedUid !== apps[i]!.uid) {
                uidsToFetch.add(expectedUid);
            }
        }

        let canonicalAppByUid = new Map<string, AppRow>();
        if (uidsToFetch.size > 0) {
            try {
                canonicalAppByUid = await this.stores.app.getByUids([
                    ...uidsToFetch,
                ]);
            } catch {
                canonicalAppByUid = new Map();
            }
        }

        return apps.map((app, i) => {
            const origin = origins[i];
            if (!origin) return null;
            const expectedUid = uidByOrigin.get(origin);
            if (!expectedUid) return null;
            if (expectedUid === app.uid) {
                return { origin, expectedUid, canonicalApp: app };
            }
            return {
                origin,
                expectedUid,
                canonicalApp: canonicalAppByUid.get(expectedUid) ?? null,
            };
        });
    }
}
