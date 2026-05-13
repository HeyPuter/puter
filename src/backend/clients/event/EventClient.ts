/**
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

import { extensionStore } from '../../extensions';
import { PuterClient } from '../types';
import { EventListener, EventMap, ListenKey, MatchingEvents } from './types';

export class EventClient extends PuterClient {
    #eventListeners: Partial<Record<ListenKey, EventListener[]>> = {};

    onServerStart() {
        this.emit('serverStart', {}, {});
    }
    onServerPrepareShutdown() {
        this.emit('serverPrepareShutdown', {}, {});
    }
    onServerShutdown() {
        this.emit('serverShutdown', {}, {});
    }

    /**
     * Dispatch an event to every matching subscriber.
     *
     * Match semantics: emit walks every dot-separated prefix of `key`,
     * looking up `<prefix>.*` listeners for prefixes shorter than the full
     * key, and exact-key listeners on the final iteration. So emitting
     * `outer.gui.item.removed` fires subscribers on:
     *
     *   - `outer.*`
     *   - `outer.gui.*`
     *   - `outer.gui.item.*`
     *   - `outer.gui.item.removed`
     *
     * Subscribers are still keyed in a single map — wildcards just live
     * under their literal `<prefix>.*` string. No regex, no per-emit
     * scan of every listener.
     *
     */
    emit<T extends keyof EventMap>(key: T, data: EventMap[T], meta: unknown) {
        const parts = key.split('.');
        for (let i = 0; i < parts.length; i++) {
            const matchKey = (
                i === parts.length - 1
                    ? key
                    : `${parts.slice(0, i + 1).join('.')}.*`
            ) as ListenKey;
            const extensionListeners = extensionStore.events[matchKey];
            const listeners = (this.#eventListeners[matchKey] || []).concat(
                extensionListeners || [],
            );
            if (!listeners) continue;
            for (const listener of listeners) {
                this.#emitEvent(listener, key, data, meta);
            }
        }
    }

    /**
     * Like `emit`, but awaits every matched listener before resolving.
     *
     * Use this when the emitter needs to act on mutations the handlers made
     * to `data` — e.g. validation hooks where a listener can set
     * `data.allow = false` to reject, or pre-commit pipelines where every
     * stage must complete before the next step runs. Regular `emit` is
     * fire-and-forget and can't observe handler state changes.
     *
     * Listeners run sequentially in the order they're registered so an
     * earlier handler's mutation is visible to later ones. A listener that
     * throws is logged (same as `emit`) and the chain continues.
     */
    async emitAndWait<T extends keyof EventMap>(
        key: T,
        data: EventMap[T],
        meta: unknown,
    ) {
        const parts = key.split('.');
        for (let i = 0; i < parts.length; i++) {
            const matchKey = (
                i === parts.length - 1
                    ? key
                    : `${parts.slice(0, i + 1).join('.')}.*`
            ) as ListenKey;
            const extensionListeners = extensionStore.events[matchKey];
            const listeners = (this.#eventListeners[matchKey] || []).concat(
                extensionListeners || [],
            );
            if (!listeners) continue;
            for (const listener of listeners) {
                try {
                    await listener(key, data, meta);
                } catch (e) {
                    console.error('Error in event listener for event', key, e);
                }
            }
        }
    }

    /**
     * Subscribe to an event by exact key OR a wildcard prefix.
     *
     * Wildcards: a key ending in `.*` matches every event whose name
     * starts with the prefix. `outer.*` matches `outer.gui.item.removed`,
     * `outer.fs.write-hash`, and any other dot-extended descendant.
     * Exact keys still match exactly. See `emit()` for the dispatch order.
     *
     * Callback receives the full `(key, data, meta)` tuple as passed
     * to `emit()` — wildcard subscribers can branch on the triggering
     * event name.
     *
     */
    on<P extends ListenKey>(
        key: P,
        callback: (
            key: MatchingEvents<P>,
            data: EventMap[MatchingEvents<P>],
            meta: unknown,
        ) => Promise<void> | void,
    ) {
        const listeners: EventListener[] =
            this.#eventListeners[key] ?? (this.#eventListeners[key] = []);
        listeners.push(callback as EventListener);
    }
    async #emitEvent<T extends keyof EventMap>(
        listener: EventListener,
        key: T,
        data: EventMap[T],
        meta: unknown,
    ) {
        try {
            await listener(key, data, meta);
        } catch (e) {
            console.error('Error in event listener for event', key, e);
        }
    }
}
