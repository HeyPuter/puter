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
import type { puterDrivers } from '../../drivers/index.js';
import type { puterServices } from '../../services/index.js';
import { eventsWorkerName } from '../../services/events/workerRuntime.js';
import {
    EVENTS_WORKER_FILE_PREFIX,
    generateEventsWorkerSource,
} from '../../services/events/workerSource.js';
import type { puterStores } from '../../stores/index.js';
import { WORKER_SUBDOMAIN_PREFIX } from '../../stores/subdomain/SubdomainStore.js';
import type { IConfig, LayerInstances } from '../../types.js';

/**
 * Keeps an app's events worker in step with its published handlers.
 *
 * Runs after every handler mutation, in the mutating request's own context, so
 * the deploy is the app owner's: their file, their worker registry row, their
 * deploy quota, and the same `worker.create` announcement anything pricing
 * workers already consumes. Handlers are baked into a generated source file in
 * the owner's app data and deployed through the ordinary worker machinery — the
 * worker is a normal worker in every registry that has to know about it.
 *
 * The generated file is named by the handler-set hash, which is the
 * idempotence: a publish that changed nothing finds its own artifact already
 * bound and deploys nothing. A changed set writes a new file first and binds it
 * via the deploy, so the write lands on an unbound file and cannot race the
 * source-file hot-reload watching the previous one.
 *
 * A deploy that fails is reported, never thrown: the publish it followed has
 * already happened, and deliveries stay retriable until a later publish (or
 * republish) puts the worker where the resolver looks.
 */

export interface EventsWorkerSyncView {
    action: 'none' | 'deployed' | 'removed' | 'failed';
    workerName: string;
    url?: string | null;
    error?: string;
}

interface DeployLayers {
    config: IConfig;
    stores: LayerInstances<typeof puterStores>;
    services: LayerInstances<typeof puterServices>;
    drivers: LayerInstances<typeof puterDrivers>;
}

interface DeployResult {
    success?: boolean;
    errors?: unknown[];
    url?: string | null;
}

export class EventsWorkerDeployer {
    readonly #layers: DeployLayers;

    constructor(layers: DeployLayers) {
        this.#layers = layers;
    }

    /** Whether publishes deploy at all. Off means handler CRUD is storage only. */
    get enabled(): boolean {
        return this.#layers.config.events?.workerRuntime === true;
    }

    async sync(actor: Actor, appUid: string): Promise<EventsWorkerSyncView> {
        try {
            return await this.#sync(actor, appUid);
        } catch (err) {
            console.warn('[events] worker deploy failed', appUid, err);
            return {
                action: 'failed',
                workerName: '',
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async #sync(actor: Actor, appUid: string): Promise<EventsWorkerSyncView> {
        const { stores, services, drivers } = this.#layers;
        const user = actor.user;
        if (!user?.id || !user.uuid || !user.username)
            return { action: 'failed', workerName: '', error: 'no user' };

        const workerName = eventsWorkerName(appUid, user.uuid);
        const row = await stores.subdomain.getBySubdomain(
            `${WORKER_SUBDOMAIN_PREFIX}${workerName}`,
        );
        const previousArtifactId =
            typeof row?.root_dir_id === 'number' ? row.root_dir_id : null;

        const handlers = await stores.eventHandler.allForApp(appUid);
        if (handlers.length === 0) {
            // Nothing left to run. The worker goes too — keeping an addressable
            // deployment around for zero handlers would only keep billing it.
            if (!row) return { action: 'none', workerName };
            await drivers.workers.destroy({ workerName });
            await this.#removeArtifact(user.id, previousArtifactId);
            return { action: 'removed', workerName };
        }

        const generated = generateEventsWorkerSource(handlers);
        if (generated.broken.length > 0)
            console.warn(
                `[events] ${appUid}: handlers not runnable as published:`,
                generated.broken.join(', '),
            );

        const filePath =
            `/${user.username}/AppData/${appUid}/` +
            `${EVENTS_WORKER_FILE_PREFIX}${generated.setHash.slice(0, 16)}.js`;

        const existing = await stores.fsEntry.getEntryByPath(filePath);
        if (
            row &&
            existing &&
            previousArtifactId !== null &&
            Number(existing.id) === previousArtifactId
        )
            // This exact handler set is what is bound and deployed already.
            return { action: 'none', workerName };

        const source = Buffer.from(generated.source, 'utf8');
        const { fsEntry } = await services.fs.write(user.id, {
            fileMetadata: {
                path: filePath,
                size: source.byteLength,
                contentType: 'text/javascript',
                overwrite: true,
                createMissingParents: true,
            },
            fileContent: source,
        });

        const result = (await drivers.workers.create({
            appId: appUid,
            workerName,
            filePath,
        })) as DeployResult;
        if (result?.success !== true)
            return {
                action: 'failed',
                workerName,
                error:
                    (result?.errors ?? []).map(String).join(', ') ||
                    'deploy failed',
            };

        // The superseded artifact, once the registry row points away from it.
        if (previousArtifactId !== null && previousArtifactId !== fsEntry.id)
            await this.#removeArtifact(user.id, previousArtifactId);

        return { action: 'deployed', workerName, url: result.url ?? null };
    }

    /** Best-effort: a stale artifact is clutter, not a correctness problem. */
    async #removeArtifact(userId: number, entryId: number | null) {
        if (entryId === null) return;
        try {
            const entry =
                await this.#layers.stores.fsEntry.getEntryById(entryId);
            if (entry) await this.#layers.services.fs.remove(userId, { entry });
        } catch (err) {
            console.warn('[events] stale worker artifact not removed', err);
        }
    }
}
