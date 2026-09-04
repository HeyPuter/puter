import { Miniflare, RequestInit as MiniflareRequestInit } from 'miniflare';
import { puterServices } from '..';
import { makeActor } from '../../core';
import { loadFileInput } from '../../drivers/util/fileInput';
import { getWorkerPreamble } from '../../drivers/workers/WorkerDriver';
import { puterStores } from '../../stores';
import type { SubdomainRow } from '../../stores/subdomain/SubdomainStore';
import { LayerInstances } from '../../types';
import { PuterService } from '../types';

const MAX_SOURCE_SIZE = 10 * 1024 * 1024; // 10 MB

// Each Miniflare instance holds a dedicated loopback port, so we can't keep
// every deployed worker resident indefinitely. Dispose a worker after this
// much inactivity; the next request lazily re-deploys it via cfCallLocal.
const WORKER_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_SWEEP_INTERVAL_MS = 60 * 1000; // sweep cadence

const activeWorkers = new Map<string, Miniflare>();
// Registry key -> last dispatch/deploy time (ms). Drives the idle sweep.
const lastAccess = new Map<string, number>();
let idleSweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Events workers are deployed under this prefix on the same maps ordinary
 * workers use, so `cfCallLocal` — which resolves a worker by hostname off the
 * plain name, before it ever checks a subdomain row — can never find one, and a
 * worker named the same as an events script cannot collide with it.
 */
const EVENTS_KEY_PREFIX = 'events:';
const eventsKey = (workerName: string): string =>
    `${EVENTS_KEY_PREFIX}${workerName}`;

export class LocalWorkerService extends PuterService {
    declare protected stores: LayerInstances<typeof puterStores>;
    declare protected services: LayerInstances<typeof puterServices>;
    async cfDeployLocal(
        workerName: string,
        authorization: string | undefined,
        code: string,
        extraBindings: Record<string, string> = {},
    ) {
        return this.#deploy(
            workerName,
            workerName,
            authorization,
            code,
            extraBindings,
        );
    }

    /** Same deploy, keyed so it never resolves as an ordinary worker. */
    async cfDeployLocalEvents(
        workerName: string,
        authorization: string | undefined,
        code: string,
        extraBindings: Record<string, string> = {},
    ) {
        return this.#deploy(
            eventsKey(workerName),
            workerName,
            authorization,
            code,
            extraBindings,
        );
    }

    async #deploy(
        key: string,
        workerName: string,
        authorization: string | undefined,
        code: string,
        extraBindings: Record<string, string>,
    ) {
        await this.#disposeWorker(key);
        try {
            const mf = new Miniflare({
                modules: false,
                name: workerName,
                // Binds variables/secrets to the environment. A worker
                // deployed without a token gets no `puter_auth` at all, the
                // same as upstream.
                bindings: {
                    ...(authorization === undefined
                        ? {}
                        : { puter_auth: authorization }),
                    ...extraBindings,
                    puter_endpoint: this.config.api_base_url,
                },
                script: code,
            } as WorkerOptions);
            activeWorkers.set(key, mf);
            this.#touch(key);
            return {
                success: true,
                errors: [],
                url: this.#localWorkerUrl(workerName),
            };
        } catch (_e) {
            return { success: false, errors: [], url: null };
        }
    }

    /**
     * Local analogue of the production worker URL, matching the host the local
     * worker proxy dispatches on (`<name>.workers.puter.localhost`). Clients
     * rely on `create` returning a usable `url`.
     */
    #localWorkerUrl(workerName: string): string {
        const port = this.config.port ? `:${this.config.port}` : '';
        return `http://${workerName}.workers.puter.localhost${port}`;
    }
    async cfCallLocal(workerName: string, request: Request) {
        let mf = activeWorkers.get(workerName);
        if (!mf) {
            // cfDeployLocal here
            const existingSub: SubdomainRow | null =
                await this.stores.subdomain.getBySubdomain(
                    'workers.puter.' + workerName,
                );

            if (!existingSub) {
                return new Response('subdomain not found', { status: 404 });
            }
            const [_, authorization, code] = await this.reconstructDeployArgs(
                workerName,
                existingSub,
            );
            await this.cfDeployLocal(workerName, authorization, code);
            mf = activeWorkers.get(workerName)!;
        }
        // Mark activity so the idle sweep keeps this worker resident.
        this.#touch(workerName);
        // `request` is a WHATWG Request built by the local-worker proxy
        // middleware. Miniflare's `dispatchFetch(input, init)` needs us to coerce this
        const hasBody = request.body != null;
        return mf.dispatchFetch(request.url, {
            method: request.method,
            headers: [...request.headers] as [string, string][],
            body: hasBody ? (request.body as unknown as BodyInit) : undefined,
            // `duplex: 'half'` is required by undici when body is a stream.
            ...(hasBody ? { duplex: 'half' } : {}),
        } as unknown as MiniflareRequestInit);
    }
    /**
     * Dispatch into a resident worker without the subdomain-row lookup
     * `cfCallLocal` falls back to — `null` means "not deployed here", which is
     * the local stand-in for a dispatch-namespace miss. For workers that have
     * no row to be found by: events workers, which the caller redeploys and
     * retries.
     */
    async dispatchEventsWorker(request: Request): Promise<Response | null> {
        const workerName = new URL(request.url).host.split('.')[0];
        const key = eventsKey(workerName);
        const mf = activeWorkers.get(key);
        if (!mf) return null;
        this.#touch(key);
        const hasBody = request.body != null;
        return (await mf.dispatchFetch(request.url, {
            method: request.method,
            headers: [...request.headers] as [string, string][],
            body: hasBody ? (request.body as unknown as BodyInit) : undefined,
            // `duplex: 'half'` is required by undici when body is a stream.
            ...(hasBody ? { duplex: 'half' } : {}),
        } as unknown as MiniflareRequestInit)) as unknown as Response;
    }

    async cfDeleteLocal(workerName: string) {
        await this.#disposeWorker(workerName);
        // Mirror the Cloudflare delete response shape — puter.js checks
        // `result` to decide whether the delete succeeded.
        return {
            success: true,
            errors: [],
            messages: [],
            result: { id: workerName },
        };
    }

    // -- Idle lifecycle stuff

    #touch(workerName: string): void {
        lastAccess.set(workerName, Date.now());
        this.#ensureIdleSweep();
    }

    async #disposeWorker(workerName: string): Promise<void> {
        const mf = activeWorkers.get(workerName);
        activeWorkers.delete(workerName);
        lastAccess.delete(workerName);
        if (mf) {
            try {
                await mf.dispose(); // releases the instance's port
            } catch {
                /* best-effort teardown */
            }
        }
    }

    // Lazily started on first deploy; disposes workers idle past the timeout
    // and stops itself once nothing is resident.
    #ensureIdleSweep(): void {
        if (idleSweepTimer) return;
        idleSweepTimer = setInterval(() => {
            const now = Date.now();
            for (const [name, ts] of [...lastAccess]) {
                if (now - ts > WORKER_IDLE_TIMEOUT_MS) {
                    void this.#disposeWorker(name);
                }
            }
            if (activeWorkers.size === 0 && idleSweepTimer) {
                clearInterval(idleSweepTimer);
                idleSweepTimer = null;
            }
        }, IDLE_SWEEP_INTERVAL_MS);
        // Don't keep the process (or test runner) alive just for the sweep.
        idleSweepTimer.unref?.();
    }

    override onServerShutdown(): void {
        if (idleSweepTimer) {
            clearInterval(idleSweepTimer);
            idleSweepTimer = null;
        }
        for (const name of [...activeWorkers.keys()]) {
            void this.#disposeWorker(name);
        }
    }
    async reconstructDeployArgs(workerName: string, row: SubdomainRow) {
        const appOwnerId = row.app_owner as number | null;
        let authorization: string;
        const ownerUser = await this.stores.user.getById(row.user_id);
        if (!ownerUser) throw new Error('Owner seems to not exist');
        const ownerActor = makeActor({ user: ownerUser });

        if (appOwnerId) {
            const app = await this.stores.app.getById(appOwnerId);
            if (!app)
                throw new Error(
                    'Local: Worker belongs to existant application',
                ); // app gone
            authorization = await this.services.auth.createWorkerAppToken(
                ownerActor,
                app.uid,
                workerName,
            );
        } else {
            const session = await this.services.auth.createWorkerSessionToken(
                ownerUser,
                workerName,
            );

            authorization = session.token;
        }

        if (row.root_dir_id == null) {
            throw new Error(
                `Local: worker ${workerName} has no root_dir_id (source file)`,
            );
        }
        const sourceEntry = await this.stores.fsEntry.getEntryById(
            row.root_dir_id,
        );
        if (!sourceEntry) {
            throw new Error(
                `Local: worker ${workerName} source file not found (id=${row.root_dir_id})`,
            );
        }

        const loaded = await loadFileInput(
            {
                fsEntry: this.stores.fsEntry,
                s3Object: this.stores.s3Object,
            },
            this.services.fs,
            ownerActor,
            sourceEntry.path ?? sourceEntry.uuid,
            { maxBytes: MAX_SOURCE_SIZE },
        );
        const sourceCode = loaded.buffer.toString('utf-8');

        const code = getWorkerPreamble() + sourceCode;

        return [workerName, authorization, code];
    }
}
