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

export interface CatalogModel {
    id: string;
    puterId?: string;
    provider?: string;
    costs?: Record<string, number>;
}

/**
 * What a media driver's model routes serve, built once after boot rather than
 * per request (the listing routes are public).
 */
export class ModelCatalog<T extends CatalogModel> {
    /** Ids as `list()` reports them, sorted. */
    readonly names: string[];
    /** One cost line per priced key of each provider model. */
    readonly reportedCosts: Record<string, unknown>[] = [];

    constructor(
        /** What `models()` serves. */
        readonly models: T[],
        /** Every routable model, unlisted ones included; may repeat. */
        routable: Iterable<T>,
        /** `aiImage` or `aiVideo`, for the cost lines' source. */
        driverKey: string,
    ) {
        this.names = models.map((m) => m.puterId || m.id).sort();
        const seen = new Set<string>();
        for (const model of routable) {
            const key = `${model.provider}:${model.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            for (const [costKey, raw] of Object.entries(model.costs ?? {})) {
                if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
                this.reportedCosts.push({
                    usageType: `${key}:${costKey}`,
                    costValue: raw,
                    source: `driver:${driverKey}/${model.provider}`,
                });
            }
        }
    }
}
