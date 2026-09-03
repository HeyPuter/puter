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
import { runWithContext } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { puterDrivers } from '../../drivers/index.js';
import {
    INTERNAL_ADMISSION_BYPASS,
    INTERNAL_DEPLOY_TARGET,
} from '../../drivers/workers/WorkerDriver.js';
import type { EventsInvokeCall } from '../../clients/events/EventsWorkerInvokerClient.js';
import { EVENTS_INVOKE_PATH } from '../../clients/events/EventsWorkerInvokerClient.js';
import type { puterServices } from '../../services/index.js';
import {
    eventsInvokeKey,
    eventsWorkerScript,
} from '../../services/events/workerRuntime.js';
import { generateEventsWorkerSource } from '../../services/events/workerSource.js';
import type { puterStores } from '../../stores/index.js';
import type { IConfig, LayerInstances } from '../../types.js';

/**
 * Deploys an app's events worker from its published handlers.
 *
 * Publishing writes rows and stops there. A handler set is deployed the first
 * time a delivery needs it and again whenever it is evicted, so the deploy is
 * never on a user's request path and first deploy and rehydration are the same
 * code path. In production the events dispatcher asks for one on a namespace
 * miss; locally there is no dispatcher, so the transport below asks directly.
 *
 * Scripts go into their own dispatch namespace under a name derived from the
 * handler set, carry no worker token, and get no `subdomains` row: an events
 * worker is not one of the owner's workers, is not addressable from the
 * internet, and cannot be listed, deleted or overwritten as if it were.
 *
 * Nothing here deletes anything: a republished set leaves the previous set's
 * script behind, and sweeping those by age is the namespace's own job. Deleting
 * one still in use is safe — the next delivery misses and deploys it again.
 */

/** Why a deploy could not happen, for the callers that answer differently. */
export type EventsDeployOutcome =
    | 'deployed'
    | 'stale'
    | 'no-handlers'
    | 'no-owner'
    | 'failed';

interface DeployLayers {
    config: IConfig;
    stores: LayerInstances<typeof puterStores>;
    services: LayerInstances<typeof puterServices>;
    drivers: LayerInstances<typeof puterDrivers>;
}

interface DeployResult {
    success?: boolean;
    errors?: unknown[];
}

export class EventsWorkerDeployer {
    readonly #layers: DeployLayers;
    /** Collapses the burst of misses one cold app produces into one deploy. */
    readonly #inFlight = new Map<string, Promise<EventsDeployOutcome>>();

    constructor(layers: DeployLayers) {
        this.#layers = layers;
    }

    /**
     * Whether handler sets deploy at all. Off means handler CRUD is storage
     * only.
     */
    get enabled(): boolean {
        return this.#layers.config.events?.workerRuntime === true;
    }

    /**
     * Deploy `script`, which must be what the app's handlers currently hash to.
     * A request for anything else is `stale` — the set moved on, and the next
     * delivery resolves the new script rather than this one being revived.
     */
    ensure(appUid: string, script: string): Promise<EventsDeployOutcome> {
        const existing = this.#inFlight.get(script);
        if (existing) return existing;
        const started = this.#deploy(appUid, script).finally(() =>
            this.#inFlight.delete(script),
        );
        this.#inFlight.set(script, started);
        return started;
    }

    async #deploy(
        appUid: string,
        script: string,
    ): Promise<EventsDeployOutcome> {
        const { stores, drivers } = this.#layers;

        const handlers = await stores.eventHandler.allForApp(appUid);
        if (handlers.length === 0) return 'no-handlers';

        const generated = generateEventsWorkerSource(handlers);
        // Two apps that published byte-identical sets share one script, which
        // is sound: the source is the same, and everything per-app arrives with
        // the invocation. Whoever deploys first owns it.
        if (eventsWorkerScript(generated.setHash) !== script) return 'stale';
        if (generated.broken.length > 0)
            console.warn(
                `[events] ${appUid}: handlers not runnable as published:`,
                generated.broken.join(', '),
            );

        const owner = await this.#owner(appUid);
        if (!owner) return 'no-owner';

        const secret = this.#layers.config.events?.internalSecret;
        if (!secret) {
            console.error(
                '[events] no internalSecret configured: an events worker deployed without an invoke key would refuse every delivery',
            );
            return 'failed';
        }

        // Deployed as the owner, so the deploy is theirs: their app binding,
        // their namespace quota, their name in whatever reads the deploy.
        // Admission is bypassed because this is not a deploy they asked for —
        // publishing is the gate, and an owner whose email lapsed afterwards
        // must not silently stop delivering.
        try {
            const result = (await runWithContext({ actor: owner }, async () =>
                drivers.workers.create({
                    appId: appUid,
                    workerName: script,
                    filePath: '',
                    [INTERNAL_ADMISSION_BYPASS]: true,
                    [INTERNAL_DEPLOY_TARGET]: {
                        scriptName: script,
                        namespace: this.#namespace(),
                        runtime: 'events',
                        source: generated.source,
                        omitOwnerToken: true,
                        // What the script compares an invocation against.
                        // Derived from the script name, so a redeploy of
                        // the same set binds the same key.
                        secrets: {
                            events_invoke_key: eventsInvokeKey(secret, script),
                        },
                        // Names are hashes and do not reverse, so tags are
                        // the only way to answer "whose scripts are these?"
                        // when cleaning up superseded sets.
                        tags: [
                            `events-app:${appUid}`,
                            `user:${owner.user.uuid}`,
                        ],
                    },
                }),
            )) as DeployResult | undefined;
            // A deploy the platform rejected comes back as a result rather
            // than a throw, and must not be reported as a success.
            if (result?.success === false)
                throw new Error(
                    (result.errors ?? []).map(String).join('; ') ||
                        'deploy rejected',
                );
        } catch (err) {
            console.error(
                `[events] ${appUid}: events worker deploy failed`,
                err instanceof Error ? err.message : err,
            );
            return 'failed';
        }
        return 'deployed';
    }

    /** The app owner, as an actor the deploy can run as. */
    async #owner(
        appUid: string,
    ): Promise<
        | (Actor & { user: { id: number; uuid: string; username: string } })
        | null
    > {
        const { stores } = this.#layers;
        const app = await stores.app.getByUid(appUid);
        const ownerUserId = Number(app?.owner_user_id);
        if (!app || !Number.isFinite(ownerUserId)) return null;

        const user = await stores.user.getById(ownerUserId);
        if (!user?.id || !user.uuid || !user.username || user.suspended)
            return null;
        return { user } as Actor & {
            user: { id: number; uuid: string; username: string };
        };
    }

    /**
     * Where events workers are deployed. Deliberately has no default: without a
     * value there is nowhere to put them that is not somewhere else's, and the
     * default namespace is the one the public dispatcher serves.
     */
    #namespace(): string | undefined {
        const namespace = this.#layers.config.events?.workerNamespace;
        if (namespace) {
            // The public dispatcher resolves any script in its namespace off
            // the request hostname, with no further check, so sharing that
            // namespace would put every events worker on the public worker
            // domain — the one thing this deploy target exists to prevent.
            if (namespace === this.#layers.config.workers?.namespace)
                throw new HttpError(
                    503,
                    'events.workerNamespace must not be the public worker namespace',
                    { legacyCode: 'response_timeout' },
                );
            return namespace;
        }
        // A local worker runtime has no namespaces to keep apart, and no
        // dispatcher that could serve one either way.
        if (
            this.#layers.config.workers?.localServer &&
            !this.#layers.config.workers?.ACCOUNTID
        )
            return undefined;
        throw new HttpError(503, 'Events workers are not configured', {
            legacyCode: 'response_timeout',
        });
    }
}

/**
 * The local-development transport: no dispatcher, no namespace, no HTTP hop —
 * the invocation goes straight into the local worker runtime, and a script that
 * is not resident is deployed on the spot the way the dispatcher's miss path
 * would have asked for.
 */
export class LocalEventsInvokeTransport {
    readonly #services: Pick<DeployLayers['services'], 'localworkerservice'>;
    readonly #deployer: EventsWorkerDeployer;

    constructor(
        services: Pick<DeployLayers['services'], 'localworkerservice'>,
        deployer: EventsWorkerDeployer,
    ) {
        this.#services = services;
        this.#deployer = deployer;
    }

    async send(call: EventsInvokeCall): Promise<{
        status: number | null;
        error?: string;
    }> {
        const request = (): Request =>
            new Request(
                `http://${call.script}.workers.puter.localhost${EVENTS_INVOKE_PATH}`,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-puter-events-key': call.key,
                    },
                    body: call.body,
                },
            );

        try {
            const resident = await this.#dispatch(request(), call.timeoutMs);
            if (resident !== null) return { status: resident };

            const outcome = await this.#deployer.ensure(
                call.appUid,
                call.script,
            );
            if (outcome !== 'deployed')
                return { status: null, error: `deploy: ${outcome}` };

            const status = await this.#dispatch(request(), call.timeoutMs);
            if (status === null)
                return { status: null, error: 'script not resident' };
            return { status };
        } catch (err) {
            return {
                status: null,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /**
     * `null` when the script is not deployed here. The timeout is ours to
     * apply: an in-process dispatch has no socket to abort.
     */
    async #dispatch(
        request: Request,
        timeoutMs: number,
    ): Promise<number | null> {
        const response = await Promise.race([
            this.#services.localworkerservice.dispatchEventsWorker(request),
            new Promise<'timeout'>((resolve) =>
                setTimeout(() => resolve('timeout'), timeoutMs).unref(),
            ),
        ]);
        if (response === 'timeout') throw new Error('invocation timed out');
        return response === null ? null : response.status;
    }
}
