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

import { HttpError } from '../../core/http/HttpError.js';

/** Value of `provider` that widens a list method out to every provider. */
const ALL_PROVIDERS = 'all';

export interface ProviderCatalog {
    /** Shown in errors, e.g. `TTS provider not found`. */
    label: string;
    /** Canonical ids, in the order the default falls back through. */
    ids: readonly string[];
    /** The documented default when a caller names no provider. */
    defaultId: string;
    /** Every name a caller may use (canonical ids included) → canonical id. */
    aliases: Readonly<Record<string, string>>;
}

/**
 * The providers one AI driver routes between, built once at boot: alias
 * resolution, the default, and the instances this deployment configured.
 */
export class ProviderRegistry<P> {
    readonly #providers = new Map<string, P>();

    constructor(readonly catalog: ProviderCatalog) {}

    register(id: string, provider: P): void {
        this.#providers.set(id, provider);
    }

    get(id: string): P | undefined {
        return this.#providers.get(id);
    }

    /** Configured provider ids, in registration order. */
    names(): string[] {
        return [...this.#providers.keys()];
    }

    /** The canonical id for a caller-supplied name, if it is one. */
    normalize(value: unknown): string | undefined {
        if (typeof value !== 'string') return undefined;
        const key = value.trim().toLowerCase();
        return Object.hasOwn(this.catalog.aliases, key)
            ? this.catalog.aliases[key]
            : undefined;
    }

    /**
     * The provider a call names, or a 400 when it names an unknown one. With
     * none named, the first hint that is a provider name wins (an `engine`
     * shorthand, the legacy driver alias the call came in through), then the
     * default.
     */
    resolve(requested: unknown, ...hints: unknown[]): string {
        if (requested !== undefined && requested !== null && requested !== '') {
            const named = this.normalize(requested);
            if (!named) {
                throw new HttpError(
                    400,
                    `${this.catalog.label} provider not found: ${String(requested)}. Available: ${this.catalog.ids.join(', ')}`,
                    { legacyCode: 'bad_request' },
                );
            }
            return named;
        }
        for (const hint of hints) {
            const named = this.normalize(hint);
            if (named) return named;
        }
        return this.defaultId();
    }

    /**
     * The documented default, falling back through the canonical order to
     * whatever is configured, so a deployment without the default still
     * serves.
     */
    defaultId(): string {
        const { ids, defaultId } = this.catalog;
        return (
            [defaultId, ...ids].find((id) => this.#providers.has(id)) ??
            this.names()[0] ??
            defaultId
        );
    }

    /** Whether a list call asked for every provider (`provider: 'all'`). */
    static isAll(value: unknown): boolean {
        return (
            typeof value === 'string' &&
            value.trim().toLowerCase() === ALL_PROVIDERS
        );
    }

    /** `list` run on every configured provider at once, concatenated in order. */
    async collect<T>(list: (provider: P, id: string) => Promise<T[]>) {
        const lists = await Promise.all(
            [...this.#providers].map(([id, p]) => list(p, id)),
        );
        return lists.flat();
    }
}

/**
 * The API key from the first config block that has one. Every AI driver reads
 * the same fields, so a key works whichever driver a provider is used through.
 */
export function readProviderKey(
    ...cfgs: Array<Record<string, unknown> | undefined>
): string | undefined {
    for (const cfg of cfgs) {
        if (!cfg) continue;
        for (const field of ['apiKey', 'secret_key', 'api_key', 'key']) {
            const value = cfg[field];
            if (typeof value === 'string' && value) return value;
        }
    }
    return undefined;
}
