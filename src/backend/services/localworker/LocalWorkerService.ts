import { Miniflare, RequestInit as MiniflareRequestInit } from 'miniflare';
import { puterServices } from '..';
import { Actor } from '../../core';
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
// workerName -> last dispatch/deploy time (ms). Drives the idle sweep.
const lastAccess = new Map<string, number>();
let idleSweepTimer: ReturnType<typeof setInterval> | null = null;

export class LocalWorkerService extends PuterService {
    declare protected stores: LayerInstances<typeof puterStores>;
    declare protected services: LayerInstances<typeof puterServices>;
    async cfDeployLocal(
        workerName: string,
        authorization: string,
        code: string,
    ) {
        await this.#disposeWorker(workerName);
        try {
            const mf = new Miniflare({
                modules: false,
                name: workerName,
                bindings: {
                    puter_auth: authorization,
                    puter_endpoint: this.config.api_base_url,
                }, // Binds variable/secret to environment
                script: code,
            } as WorkerOptions);
            activeWorkers.set(workerName, mf);
            this.#touch(workerName);
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
     * Local analogue of the production worker URL, matching the host the
     * local worker proxy dispatches on (`<name>.workers.puter.localhost`).
     * Clients rely on `create` returning a usable `url`.
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
        const ownerActor = { user: ownerUser } as Actor;

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
