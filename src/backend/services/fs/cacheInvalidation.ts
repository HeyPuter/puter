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

import type { EventClient } from '../../clients/EventClient.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import type {
    FsRemoveNodeEventPayload,
    FsRemoveNodeTarget,
    OuterGuiItemEventPayload,
} from './eventTypes.js';

export class FSEntryCacheInvalidationEventHandler {
    #fsEntryStore: FSEntryStore;
    #eventClient: EventClient;

    constructor(fsEntryStore: FSEntryStore, eventClient: EventClient) {
        this.#fsEntryStore = fsEntryStore;
        this.#eventClient = eventClient;
        this.#registerHandlers();
    }

    #registerHandlers(): void {
        this.#eventClient.on(
            'outer.gui.item.added',
            async (event: OuterGuiItemEventPayload) => {
                await this.#runSafely(
                    () => this.#handleOuterGuiItemEvent(event),
                    'outer.gui.item.added',
                );
            },
        );
        this.#eventClient.on(
            'outer.gui.item.updated',
            async (event: OuterGuiItemEventPayload) => {
                await this.#runSafely(
                    () => this.#handleOuterGuiItemEvent(event),
                    'outer.gui.item.updated',
                );
            },
        );
        this.#eventClient.on(
            'outer.gui.item.moved',
            async (event: OuterGuiItemEventPayload) => {
                await this.#runSafely(
                    () => this.#handleOuterGuiItemEvent(event),
                    'outer.gui.item.moved',
                );
            },
        );
        this.#eventClient.on(
            'fs.remove.node',
            async (event: FsRemoveNodeEventPayload) => {
                await this.#runSafely(
                    () => this.#handleRemoveNodeEvent(event),
                    'fs.remove.node',
                );
            },
        );
    }

    async #runSafely(
        handler: () => Promise<void>,
        eventName: string,
    ): Promise<void> {
        try {
            await handler();
        } catch (error) {
            console.error(
                `prodfsv2 cache invalidation failed for ${eventName}`,
                error,
            );
        }
    }

    #toUserIds(value: unknown): number[] {
        if (!Array.isArray(value)) {
            return [];
        }

        const userIds: number[] = [];
        for (const item of value) {
            const numeric = Number(item);
            if (Number.isInteger(numeric) && numeric > 0) {
                userIds.push(numeric);
            }
        }
        return userIds;
    }

    #toNonEmptyString(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    #isUnrecognizedTargetKeyError(error: unknown): boolean {
        if (!(error instanceof Error)) {
            return false;
        }
        return error.message.includes('unrecognize key for FSNodeContext.get:');
    }

    async #readTargetValue(
        target: FsRemoveNodeTarget,
        keys: string[],
    ): Promise<unknown> {
        if (typeof target.get !== 'function') {
            return undefined;
        }

        for (const key of keys) {
            try {
                return await target.get(key);
            } catch (error) {
                if (this.#isUnrecognizedTargetKeyError(error)) {
                    continue;
                }
                throw error;
            }
        }

        return undefined;
    }

    #extractUidFromEntry(value: unknown): string | null {
        if (!value || typeof value !== 'object') {
            return null;
        }
        const entry = value as { uid?: unknown; uuid?: unknown };
        return (
            this.#toNonEmptyString(entry.uid) ??
            this.#toNonEmptyString(entry.uuid)
        );
    }

    async #handleOuterGuiItemEvent(
        event: OuterGuiItemEventPayload,
    ): Promise<void> {
        const userIds = this.#toUserIds(event?.user_id_list);
        const response = event?.response ?? {};

        const path = this.#toNonEmptyString(response.path);
        const oldPath = this.#toNonEmptyString(response.old_path);
        const uid =
            this.#toNonEmptyString(response.uid) ??
            this.#toNonEmptyString(response.uuid) ??
            this.#toNonEmptyString(response.id);

        const tasks: Promise<void>[] = [];
        for (const userId of userIds) {
            if (path) {
                tasks.push(
                    this.#fsEntryStore.invalidateEntryCacheByPathForUser(
                        userId,
                        path,
                    ),
                );
            }
            if (oldPath && oldPath !== path) {
                tasks.push(
                    this.#fsEntryStore.invalidateEntryCacheByPathForUser(
                        userId,
                        oldPath,
                    ),
                );
            }
        }
        if (uid) {
            tasks.push(this.#fsEntryStore.invalidateEntryCacheByUuid(uid));
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
    }

    async #handleRemoveNodeEvent(
        event: FsRemoveNodeEventPayload,
    ): Promise<void> {
        const target = event?.target;
        if (!target || typeof target.get !== 'function') {
            return;
        }

        const userIdValue = await this.#readTargetValue(target, ['user_id']);
        const pathValue = await this.#readTargetValue(target, ['path']);
        const uidValue =
            (await this.#readTargetValue(target, ['uid', 'uuid'])) ??
            this.#extractUidFromEntry(
                await this.#readTargetValue(target, ['entry']),
            );

        const userId = Number(userIdValue);
        const path = this.#toNonEmptyString(pathValue);
        const uuid = this.#toNonEmptyString(uidValue);

        const tasks: Promise<void>[] = [];
        if (Number.isInteger(userId) && userId > 0 && path) {
            tasks.push(
                this.#fsEntryStore.invalidateEntryCacheByPathForUser(
                    userId,
                    path,
                ),
            );
        }
        if (uuid) {
            tasks.push(this.#fsEntryStore.invalidateEntryCacheByUuid(uuid));
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
    }
}
