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
import type { puterClients } from '../../clients/index.js';
import type { puterDrivers } from '../../drivers/index.js';
import {
    INTERNAL_ADMISSION_BYPASS,
    INTERNAL_DEPLOY_TARGET,
} from '../../drivers/workers/WorkerDriver.js';
import type {
    EventsInvokeAnswer,
    EventsInvokeCall,
    InvokeLane,
} from '../../clients/events/EventsWorkerInvokerClient.js';
import {
    EVENTS_INVOKE_PATH,
    answerFrom,
    failedAnswer,
} from '../../clients/events/EventsWorkerInvokerClient.js';
import type { puterServices } from '../../services/index.js';
import type { IExtensionServiceInstances } from '../../services/types.js';
import {
    eventsInvokeKey,
    eventsWorkerScope,
    eventsWorkerScript,
    userHandlerScript,
} from '../../services/events/workerRuntime.js';
import {
    generateEventsWorkerSource,
    handlerSetHash,
} from '../../services/events/workerSource.js';
import {
    appHandlerScope,
    type HandlerScope,
} from '../../stores/events/EventHandlerStore.js';
import type { puterStores } from '../../stores/index.js';
import type { IConfig, LayerInstances } from '../../types.js';
import {
    EVENTS_USER_WORKER_DEPLOYS_PER_HOUR,
    EVENTS_WORKER_DEPLOYS_PER_HOUR,
} from './limits.js';

/**
 * Deploys an app's events worker from its published handlers.
 *
 * Deployed the first time a delivery needs it and again on eviction — a publish
 * only writes rows (a user-scope publish also deploys eagerly). An app's scope
 * is one script for the whole set; a user scope is one script per handler,
 * deployed as the holder. Scripts carry no worker token and no `subdomains`
 * row: not one of the owner's workers, not addressable from the internet, not
 * listed or deleted as if it were. A republished set leaves the old script
 * behind rather than deleting it; redeploying a still-live one is always safe.
 */

/** Why a deploy could not happen, for the callers that answer differently. */
export type EventsDeployOutcome =
    | 'deployed'
    | 'stale'
    | 'no-handlers'
    | 'no-owner'
    | 'throttled'
    | 'failed'
    | 'busy';

/** Whose call asked for the deploy: a schedule run's is held to a share. */
export interface EventsDeployOptions {
    lane?: InvokeLane;
    /**
     * A user-scope publish's deploy, which skips the upload when the script's
     * deployed marker is already set. A deploy-on-miss is never eager.
     */
    eager?: boolean;
}

interface DeployLayers {
    config: IConfig;
    clients: LayerInstances<typeof puterClients>;
    stores: LayerInstances<typeof puterStores>;
    services: LayerInstances<typeof puterServices> &
        Pick<IExtensionServiceInstances, 'schedules'>;
    drivers: LayerInstances<typeof puterDrivers>;
}

/**
 * `ev:deploys:{<appUid>}[:<holder>]:<hour>` bucket TTL — comfortably past the
 * hour it counts.
 */
const DEPLOY_THROTTLE_TTL_SECONDS = 2 * 60 * 60;

/** How long `ev:deployed:<script>` says a script was uploaded. Under a day. */
const DEPLOYED_MARKER_TTL_SECONDS = 20 * 60 * 60;

const deployedMarkerKey = (script: string): string => `ev:deployed:${script}`;

const isUserScope = (scope: HandlerScope): boolean => scope.holder !== 0;

interface InFlightDeploy {
    /** A schedule run's, which the region's deploy slots may refuse. */
    capped: boolean;
    eager: boolean;
    promise: Promise<EventsDeployOutcome>;
}

interface DeployResult {
    success?: boolean;
    errors?: unknown[];
}

export class EventsWorkerDeployer {
    readonly #layers: DeployLayers;
    /** Collapses the burst of misses one cold app produces into one deploy. */
    readonly #inFlight = new Map<string, InFlightDeploy>();

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
     * Deploy `script`, which must be what the scope's handlers currently hash
     * to: the whole set for an app, one handler for a user scope. A request for
     * anything else is `stale` — the handlers moved on, and the next delivery
     * resolves the new script rather than this one being revived. Always
     * uploads; a deploy-on-miss means whatever said it was there is wrong.
     */
    ensure(
        scope: HandlerScope,
        script: string,
        options: EventsDeployOptions = {},
    ): Promise<EventsDeployOutcome> {
        // A user scope's script is the same bytes whoever holds it, so
        // concurrent deploys of it from any holder or app are one.
        const key = isUserScope(scope)
            ? `user|${script}`
            : `${scope.appUid}|${scope.holder}|${script}`;
        const capped = options.lane === 'schedule';
        const existing = this.#inFlight.get(key);
        if (!existing) return this.#start(key, scope, script, options);
        // An eager deploy may have skipped the upload, which a miss must not
        // take for done.
        if (existing.eager && !options.eager)
            return this.#afterEager(
                existing.promise,
                key,
                scope,
                script,
                options,
            );
        if (capped || !existing.capped) return existing.promise;
        return this.#afterCapped(existing.promise, key, scope, script, options);
    }

    /**
     * {@link ensure} for the deploy a user-scope publish starts, which skips the
     * upload when another holder's deploy of the same script left its marker.
     * Only this path reads the marker.
     */
    async deployEagerly(
        scope: HandlerScope,
        script: string,
    ): Promise<EventsDeployOutcome> {
        if (await this.#markedDeployed(script)) return 'deployed';
        return this.ensure(scope, script, { eager: true });
    }

    /**
     * The scope a script request names: the app's own, or the user scope of
     * `holder` (a user uuid). Null for a holder that does not exist.
     */
    async scopeFor(
        appUid: string,
        holder?: string | null,
    ): Promise<HandlerScope | null> {
        if (!holder) return appHandlerScope(appUid);
        const user = await this.#layers.stores.user.getByUuid(holder);
        if (!user?.id) return null;
        return { appUid, holder: Number(user.id) };
    }

    #start(
        key: string,
        scope: HandlerScope,
        script: string,
        options: EventsDeployOptions,
    ): Promise<EventsDeployOutcome> {
        const entry: InFlightDeploy = {
            capped: options.lane === 'schedule',
            eager: options.eager === true,
            promise: this.#gated(scope, script, options).finally(() => {
                if (this.#inFlight.get(key) === entry)
                    this.#inFlight.delete(key);
            }),
        };
        this.#inFlight.set(key, entry);
        return entry.promise;
    }

    /** A miss that found an eager deploy in flight deploys after it. */
    async #afterEager(
        eager: Promise<EventsDeployOutcome>,
        key: string,
        scope: HandlerScope,
        script: string,
        options: EventsDeployOptions,
    ): Promise<EventsDeployOutcome> {
        await eager;
        const current = this.#inFlight.get(key);
        if (current && !current.eager) return current.promise;
        return this.#start(key, scope, script, options);
    }

    /**
     * A delivery that joined a schedule run's deploy: `busy` means no deploy
     * started, and a delivery is never refused a slot, so it asks again.
     */
    async #afterCapped(
        capped: Promise<EventsDeployOutcome>,
        key: string,
        scope: HandlerScope,
        script: string,
        options: EventsDeployOptions,
    ): Promise<EventsDeployOutcome> {
        const outcome = await capped;
        if (outcome !== 'busy') return outcome;
        const current = this.#inFlight.get(key);
        if (current && !current.capped) return current.promise;
        return this.#start(key, scope, script, options);
    }

    /**
     * Every deploy goes through the schedules' deploy gate when a server has
     * one: a per-script lock, so a burst of runs of an evicted script deploys
     * it once, and a region-wide cap that a schedule run's deploy (`capped`)
     * may be refused with `busy`. A delivery's deploy is never refused.
     */
    #gated(
        scope: HandlerScope,
        script: string,
        options: EventsDeployOptions,
    ): Promise<EventsDeployOutcome> {
        const deploy = () =>
            this.#deploy(scope, script, options.eager === true);
        return (
            this.#layers.services.schedules?.gateDeploy?.(
                script,
                { capped: options.lane === 'schedule' },
                deploy,
            ) ?? deploy()
        );
    }

    async #deploy(
        handlerScope: HandlerScope,
        script: string,
        eager: boolean,
    ): Promise<EventsDeployOutcome> {
        const { appUid } = handlerScope;
        const { stores, drivers } = this.#layers;
        const backend = eventsWorkerScope(this.#layers.config);
        const userScope = isUserScope(handlerScope);

        // Names and hashes are enough to tell a stale request, so the set's
        // sources are read and built only once the throttle has let it through.
        const set = await stores.eventHandler.setForApp(handlerScope);
        if (set.length === 0) return 'no-handlers';
        // Two apps that published byte-identical sets share one script, which
        // is sound: the source is the same, and everything per-app arrives with
        // the invocation. Whoever deploys first owns it. A user scope's script
        // is one handler's, so it is shared the same way across holders.
        const wanted = userScope
            ? set.find((entry) => userHandlerScript(entry, backend) === script)
            : undefined;
        if (
            userScope
                ? !wanted
                : eventsWorkerScript(handlerSetHash(set), backend) !== script
        )
            return 'stale';

        // Asked again inside the gate, where another deploy of this script may
        // have just finished.
        if (eager && userScope && (await this.#markedDeployed(script)))
            return 'deployed';

        if (await this.#tooManyDeploysThisHour(handlerScope))
            return 'throttled';

        const all = await stores.eventHandler.allForApp(handlerScope);
        const handlers = wanted
            ? all.filter(
                  (handler) =>
                      handler.name === wanted.name &&
                      handler.sourceHash === wanted.sourceHash,
              )
            : all;
        const generated = generateEventsWorkerSource(handlers);
        // The set can move between the two reads.
        if (
            handlers.length === 0 ||
            eventsWorkerScript(generated.setHash, backend) !== script
        )
            return 'stale';
        if (generated.tooLarge) {
            console.error(
                `[events] ${appUid}: generated events worker exceeds the size cap`,
            );
            return 'failed';
        }
        if (generated.broken.length > 0)
            console.warn(
                `[events] ${appUid}: handlers not runnable as published:`,
                generated.broken.join(', '),
            );

        const owner = await this.#owner(handlerScope);
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
                        cpuMs: this.#layers.config.events?.workerCpuMs,
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
        if (userScope) await this.#markDeployed(script);
        return 'deployed';
    }

    async #markedDeployed(script: string): Promise<boolean> {
        try {
            return !!(await this.#layers.clients.redis.get(
                deployedMarkerKey(script),
            ));
        } catch (err) {
            console.warn('[events] deployed marker unreadable', err);
            return false;
        }
    }

    async #markDeployed(script: string): Promise<void> {
        try {
            await this.#layers.clients.redis.set(
                deployedMarkerKey(script),
                '1',
                'EX',
                DEPLOYED_MARKER_TTL_SECONDS,
            );
        } catch (err) {
            console.warn('[events] could not mark a script deployed', err);
        }
    }

    /**
     * Whether this scope has already deployed its hourly cap this hour. A
     * flapping set (publish, remove, republish) provisions upstream on every
     * miss, and this is the ceiling on that loop. An app's counter is per app;
     * a user scope has its own, so one user cannot spend another's.
     */
    async #tooManyDeploysThisHour(scope: HandlerScope): Promise<boolean> {
        const redis = this.#layers.clients.redis;
        const hour = new Date().toISOString().slice(0, 13);
        const userScope = isUserScope(scope);
        const key = userScope
            ? `ev:deploys:{${scope.appUid}}:${scope.holder}:${hour}`
            : `ev:deploys:{${scope.appUid}}:${hour}`;
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, DEPLOY_THROTTLE_TTL_SECONDS);
        return (
            count >
            (userScope
                ? EVENTS_USER_WORKER_DEPLOYS_PER_HOUR
                : EVENTS_WORKER_DEPLOYS_PER_HOUR)
        );
    }

    /**
     * The user a scope's deploy runs as, as an actor: the app's owner, or the
     * holder of a user scope.
     */
    async #owner(
        scope: HandlerScope,
    ): Promise<
        | (Actor & { user: { id: number; uuid: string; username: string } })
        | null
    > {
        const { stores } = this.#layers;
        let ownerUserId = scope.holder;
        if (!isUserScope(scope)) {
            const app = await stores.app.getByUid(scope.appUid);
            ownerUserId = Number(app?.owner_user_id);
            if (!app || !Number.isFinite(ownerUserId)) return null;
        }

        const user = await stores.user.getById(ownerUserId);
        if (!user?.id || !user.uuid || !user.username || user.suspended)
            return null;
        return { user, effectiveApp: null } as Actor & {
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

    async send(call: EventsInvokeCall): Promise<EventsInvokeAnswer> {
        // Built per attempt, so a send time stamped into the body is taken
        // after a cold deploy rather than before it.
        const request = (): Request =>
            new Request(
                `http://${call.script}.workers.puter.localhost${EVENTS_INVOKE_PATH}`,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-puter-events-key': call.key,
                    },
                    body: call.render ? call.render() : call.body,
                },
            );

        try {
            const resident = await this.#dispatch(request(), call.timeoutMs);
            if (resident !== null) return resident;

            const scope = await this.#deployer.scopeFor(
                call.appUid,
                call.holder,
            );
            if (!scope) return { status: null, error: 'deploy: no-holder' };
            const outcome = await this.#deployer.ensure(scope, call.script, {
                lane: call.lane,
            });
            if (outcome !== 'deployed')
                return {
                    status: null,
                    error: `deploy: ${outcome}`,
                    ...(outcome === 'busy' ? { deployBusy: true } : {}),
                };

            const retried = await this.#dispatch(request(), call.timeoutMs);
            if (retried === null)
                return { status: null, error: 'script not resident' };
            return retried;
        } catch (err) {
            return failedAnswer(err);
        }
    }

    /**
     * `null` when the script is not deployed here. The timeout is ours to
     * apply: an in-process dispatch has no socket to abort.
     */
    async #dispatch(
        request: Request,
        timeoutMs: number,
    ): Promise<EventsInvokeAnswer | null> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs);
            timer.unref();
        });
        try {
            const response = await Promise.race([
                this.#services.localworkerservice.dispatchEventsWorker(request),
                timeout,
            ]);
            if (response === 'timeout')
                throw new DOMException('invocation timed out', 'TimeoutError');
            if (response === null) return null;
            return answerFrom(response);
        } finally {
            clearTimeout(timer);
        }
    }
}
