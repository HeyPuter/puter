import type { FSEntryRepository } from '../repositories/FSEntryRepository.js';
import type {
    FsRemoveNodeEventPayload,
    OuterGuiItemEventPayload,
} from './types.js';

export class FSEntryCacheInvalidationEventHandler {
    #fsEntryRepository: FSEntryRepository;

    constructor (fsEntryRepository: FSEntryRepository) {
        this.#fsEntryRepository = fsEntryRepository;
        this.#registerHandlers();
    }

    #registerHandlers (): void {
        extension.on('outer.gui.item.added', async (event: OuterGuiItemEventPayload) => {
            await this.#runSafely(() => this.#handleOuterGuiItemEvent(event), 'outer.gui.item.added');
        });
        extension.on('outer.gui.item.updated', async (event: OuterGuiItemEventPayload) => {
            await this.#runSafely(() => this.#handleOuterGuiItemEvent(event), 'outer.gui.item.updated');
        });
        extension.on('outer.gui.item.moved', async (event: OuterGuiItemEventPayload) => {
            await this.#runSafely(() => this.#handleOuterGuiItemEvent(event), 'outer.gui.item.moved');
        });
        extension.on('fs.remove.node', async (event: FsRemoveNodeEventPayload) => {
            await this.#runSafely(() => this.#handleRemoveNodeEvent(event), 'fs.remove.node');
        });
    }

    async #runSafely (handler: () => Promise<void>, eventName: string): Promise<void> {
        try {
            await handler();
        } catch ( error ) {
            console.error(`prodfsv2 cache invalidation failed for ${eventName}`, error);
        }
    }

    #toUserIds (value: unknown): number[] {
        if ( ! Array.isArray(value) ) {
            return [];
        }

        const userIds: number[] = [];
        for ( const item of value ) {
            const numeric = Number(item);
            if ( Number.isInteger(numeric) && numeric > 0 ) {
                userIds.push(numeric);
            }
        }
        return userIds;
    }

    #toNonEmptyString (value: unknown): string | null {
        if ( typeof value !== 'string' ) {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    async #handleOuterGuiItemEvent (event: OuterGuiItemEventPayload): Promise<void> {
        const userIds = this.#toUserIds(event?.user_id_list);
        const response = event?.response ?? {};

        const path = this.#toNonEmptyString(response.path);
        const oldPath = this.#toNonEmptyString(response.old_path);
        const uid =
            this.#toNonEmptyString(response.uid)
            ?? this.#toNonEmptyString(response.uuid)
            ?? this.#toNonEmptyString(response.id);

        const tasks: Promise<void>[] = [];
        for ( const userId of userIds ) {
            if ( path ) {
                tasks.push(this.#fsEntryRepository.invalidateEntryCacheByPathForUser(userId, path));
            }
            if ( oldPath && oldPath !== path ) {
                tasks.push(this.#fsEntryRepository.invalidateEntryCacheByPathForUser(userId, oldPath));
            }
        }
        if ( uid ) {
            tasks.push(this.#fsEntryRepository.invalidateEntryCacheByUuid(uid));
        }

        if ( tasks.length > 0 ) {
            await Promise.all(tasks);
        }
    }

    async #handleRemoveNodeEvent (event: FsRemoveNodeEventPayload): Promise<void> {
        const target = event?.target;
        if ( !target || typeof target.get !== 'function' ) {
            return;
        }

        const userIdValue = await target.get('user_id');
        const pathValue = await target.get('path');
        const uuidValue = await target.get('uuid');

        const userId = Number(userIdValue);
        const path = this.#toNonEmptyString(pathValue);
        const uuid = this.#toNonEmptyString(uuidValue);

        const tasks: Promise<void>[] = [];
        if ( Number.isInteger(userId) && userId > 0 && path ) {
            tasks.push(this.#fsEntryRepository.invalidateEntryCacheByPathForUser(userId, path));
        }
        if ( uuid ) {
            tasks.push(this.#fsEntryRepository.invalidateEntryCacheByUuid(uuid));
        }

        if ( tasks.length > 0 ) {
            await Promise.all(tasks);
        }
    }
}
