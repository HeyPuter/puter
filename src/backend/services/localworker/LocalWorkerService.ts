import { Miniflare, RequestInit } from 'miniflare';
import { puterServices } from '..';
import { Actor } from '../../core';
import { loadFileInput } from '../../drivers/util/fileInput';
import { puterStores } from '../../stores';
import { LayerInstances } from '../../types';
import { PuterService } from '../types';

const MAX_SOURCE_SIZE = 10 * 1024 * 1024; // 10 MB

interface SubdomainRow {
    id: number;
    uuid: string;
    ts: number | string; // system timestamp
    subdomain: string; // immutable name
    user_id: number; // owner
    app_owner: number | null; // owning app, if any
    protected: 0 | 1; // access gate
    database_id: string | null; // Cloudflare D1 binding
    root_dir_id: number | null; // editable
    associated_app_id: string | null; // editable
    domain: string | null; // custom domain, editable
}

const activeWorkers = new Map<string, Miniflare>();

export class LocalWorkerService extends PuterService {
    declare protected stores: LayerInstances<typeof puterStores>;
    declare protected services: LayerInstances<typeof puterServices>;
    async cfDeployLocal(
        workerName: string,
        authorization: string,
        code: string,
    ) {
        const mf = new Miniflare({
            modules: false,
            name: workerName,
            bindings: {
                puter_auth: authorization,

                //todo: maybe dont hardcode this
                puter_endpoint: 'http://api.puter.localhost:4100/',
            }, // Binds variable/secret to environment
            script: code,
        } as WorkerOptions);
        activeWorkers.set(workerName, mf);
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
        return mf.dispatchFetch(request.url, request as unknown as RequestInit);
    }
    async cfDeleteLocal(workerName: string) {
        const mf = activeWorkers.get(workerName);
        if (mf) {
            mf.dispose();
            activeWorkers.delete(workerName);
        }
        return true;
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

        const loaded = await loadFileInput(
            {
                fsEntry: this.stores.fsEntry,
                s3Object: this.stores.s3Object,
            },
            this.services.fs,
            ownerActor,
            row.root_dir_id,
            { maxBytes: MAX_SOURCE_SIZE },
        );
        const code = loaded.buffer.toString('utf-8');

        return [workerName, authorization, code];
    }
}
