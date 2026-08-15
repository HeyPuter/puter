/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EventMetadata } from '../../clients/event/types.js';
import { makeActor, type Actor } from '../../core/actor.js';
import { Context } from '../../core/context.js';
import { HttpError, type LegacyErrorCodes } from '../../core/http/HttpError.js';
import { assertVerifiedEmail } from '../../core/http/verifiedEmail.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import {
    WORKER_SUBDOMAIN_PREFIX,
    type SubdomainRow,
} from '../../stores/subdomain/SubdomainStore.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import type { DriverConcurrentConfig, DriverRateLimitConfig } from '../meta.js';
import { PuterDriver } from '../types.js';
import { loadFileInput } from '../util/fileInput.js';
import {
    decodeCursor,
    encodeCursor,
    normalizeLimit,
    normalizeOffset,
} from '../../util/pagination.js';

const CF_BASE_URL = 'https://api.cloudflare.com/client/v4/accounts';
const WORKER_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_WORKERS_PER_USER = 100;

/**
 * Opt-in key for `create()` that skips the admission checks a _new_ worker has
 * to clear — the per-user limit and the verified-email gate — for a worker that
 * already exists and cleared them when it was first created. Re-running
 * admission on an existing worker can only take a working worker away from its
 * owner.
 *
 * Deliberately a symbol, not a named field: driver arguments arrive as parsed
 * JSON from the caller and are passed through untouched, and `JSON.parse` can
 * never produce a symbol-keyed property. Only in-process code holding this
 * import can set it. A string key here would be a privilege-escalation hole.
 */
export const INTERNAL_ADMISSION_BYPASS = Symbol(
    'workers.internalAdmissionBypass',
);

/**
 * Opt-in key for `create()` that deploys under a caller-chosen script name and
 * grouping instead of the default one-script-per-`workerName` layout, and skips
 * the `subdomains` bookkeeping entirely.
 *
 * It exists for callers that derive a script's identity from something they
 * already own — where its source file lives, say — and so have nothing to look
 * up when a request arrives and no row to keep in sync with the filesystem.
 * Everything else about the deploy is deliberately unchanged: same source read,
 * same preamble, same token minting, so a second deploy path cannot drift from
 * this one.
 *
 * A symbol for the same reason as `INTERNAL_ADMISSION_BYPASS`: `JSON.parse` can
 * never produce one, so a request body cannot reach it. Choosing a script name
 * is choosing what a deploy overwrites, and that has to stay in-process.
 */
export const INTERNAL_DEPLOY_TARGET = Symbol('workers.internalDeployTarget');

export interface InternalDeployTarget {
    /** Script name to deploy under, in place of `workerName`. */
    scriptName: string;
    /** Grouping to deploy into, in place of the configured default. */
    namespace?: string;
    /**
     * Labels stored alongside the script. A name derived from a hash cannot be
     * read backwards, so labels are the only way to enumerate afterwards which
     * scripts belong to what.
     */
    tags?: string[];
}

const MAX_SOURCE_SIZE = 10 * 1024 * 1024; // 10 MB
// How far to scan an app's child apps when resolving which workers it may
// see. A user is capped at MAX_WORKERS_PER_USER workers, so only that many
// child apps can actually own one; the ceiling is generous slack over that.
const CHILD_APP_SCAN_LIMIT = 1000;
let USE_LOCAL_WORKERD = false;

// -- Preamble --------------------------------------------------------
//
// The preamble is a webpack-built JS bundle that provides puter.js to
// worker code. It's baked into the source sent to Cloudflare Workers.
// If the file hasn't been built, workers run without puter.js access.

let preamble = '';
let preambleError = false;
let preambleLineCount = 0;
let preambleVersion: string | null = null;
try {
    // Five levels up from `dist/src/backend/drivers/workers` (compiled
    // runtime); four when running from `src/backend/drivers/workers`
    // directly (vitest transforms the TS sources in place).
    const preamblePath = [
        path.join(
            __dirname,
            '../../../../../src/worker/dist/workerPreamble.js',
        ),
        path.join(__dirname, '../../../../src/worker/dist/workerPreamble.js'),
    ].find((candidate) => existsSync(candidate));
    if (!preamblePath) throw new Error('workerPreamble.js not found');
    console.log('reading: ' + preamblePath);
    preamble = readFileSync(preamblePath, 'utf-8');
    preambleLineCount = preamble.split('\n').length - 1;

    const versionMatch = /^var __PUTER_PREAMBLE_VERSION__\s*=\s*"([^"]+)"/.exec(
        preamble,
    );
    if (versionMatch) {
        preambleVersion = versionMatch[1];
    }
} catch {
    console.warn(
        '[workers] preamble not built — workers will not have puter.js injected.',
    );
    preambleError = true;
}

/**
 * The puter.js/router preamble prepended to every worker's source before
 * deploy. Exposed so the local-workerd path (`LocalWorkerService`) can build
 * the same `preamble + sourceCode` script when it lazily re-deploys a worker
 * into Miniflare after a server restart.
 */
export function getWorkerPreamble(): string {
    return preamble;
}

/**
 * Driver exposing the `workers` interface — Cloudflare Workers deployment,
 * lifecycle, and file-path queries.
 *
 * Each "worker" is a JS file in the user's Puter FS, deployed to Cloudflare
 * Workers. A corresponding `subdomains` row with subdomain
 * `workers.puter.<name>` ties the worker to its source file.
 *
 * Config: `config.workers.{XAUTHKEY, ACCOUNTID, namespace?,
 * internetExposedUrl?, loggingUrl?}`.
 */
export class WorkerDriver extends PuterDriver {
    readonly driverInterface = 'workers';
    // puter-js calls this as `workers:worker-service` (see Workers.js). Keep the name aligned.
    readonly driverName = 'worker-service';
    readonly isDefault = true;

    // Without this the driver falls back to the generic 600/minute default,
    // which is far too loose for `create` — every call reads the source out
    // of the user's FS, bundles it, and provisions upstream.
    //
    // Deploys still get their own tighter budget, but not a single-digit one:
    // developing against workers means redeploying on every change, and a
    // tooling client that deploys a set of them does it back to back. The
    // in-flight cap below is what bounds the concurrent bundling work; this
    // window is only here to stop a loop.
    readonly rateLimit: DriverRateLimitConfig = {
        // Everything that isn't `create`/`destroy` is a metadata read —
        // listing workers, resolving one by name, enumerating its files — and
        // a client walks several of those per deploy and again per page of a
        // listing. Cheap to serve, so the budget only catches a loop.
        default: {
            limit: 600,
            window: 60_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 300,
                [DEFAULT_TEMP_SUBSCRIPTION]: 150,
            },
        },
        methods: {
            create: {
                limit: 120,
                window: 60_000,
                bySubscription: {
                    [DEFAULT_FREE_SUBSCRIPTION]: 80,
                    [DEFAULT_TEMP_SUBSCRIPTION]: 40,
                },
            },
            destroy: {
                limit: 30,
                window: 60_000,
                bySubscription: {
                    [DEFAULT_FREE_SUBSCRIPTION]: 20,
                    [DEFAULT_TEMP_SUBSCRIPTION]: 10,
                },
            },
        },
    };

    readonly concurrent: DriverConcurrentConfig = {
        default: {
            limit: 10,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 5,
                [DEFAULT_TEMP_SUBSCRIPTION]: 3,
            },
        },
        methods: {
            // Deploys are the expensive path; the floor stays at 2 so a
            // client that kicks off a second deploy while the first is
            // still settling doesn't get a spurious rejection.
            create: {
                limit: 5,
                bySubscription: {
                    [DEFAULT_FREE_SUBSCRIPTION]: 2,
                    [DEFAULT_TEMP_SUBSCRIPTION]: 2,
                },
            },
        },
    };

    #cfBaseUrl = '';
    #hotReloadSubscribed = false;

    static currentPreambleVersion(): string | null {
        return preambleVersion;
    }

    override onServerStart(): void {
        const cfg = this.#workerConfig();
        if (cfg.ACCOUNTID) {
            this.#cfBaseUrl = `${CF_BASE_URL}/${cfg.ACCOUNTID}/workers`;
            if (cfg.namespace) {
                this.#cfBaseUrl += `/dispatch/namespaces/${cfg.namespace}`;
            }
            if (preambleError) {
                throw new Error(
                    '[workers] preamble not build but workers configured to be enabled. Halting start',
                );
            }
        } else if (cfg.localServer) {
            USE_LOCAL_WORKERD = true;
        }
        this.#subscribeHotReload();
    }

    // -- Driver methods ----------------------------------------------

    async create(args: {
        appId: string;
        workerName: string;
        filePath: string;
        authorization?: string;
        [INTERNAL_ADMISSION_BYPASS]?: boolean;
        [INTERNAL_DEPLOY_TARGET]?: InternalDeployTarget;
    }): Promise<unknown> {
        const actor = this.#requireActor();
        const skipAdmission = args[INTERNAL_ADMISSION_BYPASS] === true;
        const deployTarget = this.#validateDeployTarget(
            args[INTERNAL_DEPLOY_TARGET],
        );
        if (!skipAdmission) this.#requireVerified(actor);
        const workerName = String(args.workerName ?? '').toLowerCase();
        const filePath = String(args.filePath ?? '');
        const appId = args.appId || actor.app?.uid;
        if (!workerName)
            throw new HttpError(400, 'Missing `workerName`', {
                legacyCode: 'bad_request',
            });
        if (!filePath)
            throw new HttpError(400, 'Missing `filePath`', {
                legacyCode: 'bad_request',
            });
        if (!WORKER_NAME_REGEX.test(workerName)) {
            throw new HttpError(
                400,
                'Worker name must be alphanumeric (plus _ and -)',
                { legacyCode: 'bad_request' },
            );
        }
        this.#rejectReserved(workerName);
        const subdomainName = `${WORKER_SUBDOMAIN_PREFIX}${workerName}`;

        // Authorization runs ahead of the infrastructure check so "you may not
        // target that app" / "that name is taken" don't hide behind a 503 on
        // installs without Cloudflare configured. Both are reads — nothing is
        // written before #requireCfConfig.
        const boundApp = await this.#resolveWorkerAppBinding(actor, appId);
        // A deploy target names its own script, so `workerName` never becomes a
        // subdomain and cannot collide with one somebody else owns.
        const existingSub = deployTarget
            ? null
            : await this.stores.subdomain.getBySubdomain(subdomainName);
        if (existingSub) {
            await this.#checkWorkerWriteAccess(
                existingSub,
                actor,
                409,
                'Worker name is already in use',
                'conflict',
            );
        }

        this.#requireCfConfig();

        // Quota check — count existing workers.puter.* subdomains owned by user
        //
        // A deploy target creates no such row, so this count can neither see
        // its scripts nor be grown by them; running it would only make an
        // unrelated worker quota decide whether these deploy. Whatever bounds
        // them has to be counted where they actually live, and belongs to the
        // caller that owns their lifecycle.
        const existingWorkers =
            skipAdmission || deployTarget
                ? []
                : await this.stores.subdomain.listByUserIdAndPrefix(
                      actor.user.id,
                      WORKER_SUBDOMAIN_PREFIX,
                  );
        if (existingWorkers.length >= MAX_WORKERS_PER_USER) {
            throw new HttpError(
                403,
                `Worker limit reached (max ${MAX_WORKERS_PER_USER})`,
                { legacyCode: 'forbidden' },
            );
        }

        // If tied to an app, get an app-scoped worker token. Worker tokens
        // use `kind='worker'` so they don't collide with any interactive
        // `kind='app'` session for the same (user, app); the long expiry
        // (WORKER_WINDOW_SECONDS) means the worker doesn't have to re-mint
        // on a clock cadence.
        let authorization = undefined;
        const appOwnerId = boundApp?.id;
        if (boundApp) {
            authorization = await this.services.auth.createWorkerAppToken(
                actor,
                boundApp.uid,
                workerName,
            );
        }
        if (!authorization) {
            // Fall back to a user-scoped worker token (no app binding).
            // Same kind='worker' row + long expiry as the app-scoped
            // branch above; (user, worker_name) is the unique key.
            const userRow = await this.stores.user.getById(actor.user.id!);
            if (!userRow)
                throw new HttpError(500, 'User not found', {
                    legacyCode: 'internal_error',
                });
            const session = await this.services.auth.createWorkerSessionToken(
                userRow,
                workerName,
            );
            authorization = session.token;
        }

        // Read source file. loadFileInput runs the read-ACL check internally
        // before pulling bytes from S3.
        const loaded = await loadFileInput(
            { fsEntry: this.stores.fsEntry, s3Object: this.stores.s3Object },
            this.services.fs,
            actor,
            filePath,
            { maxBytes: MAX_SOURCE_SIZE },
        );
        const sourceCode = loaded.buffer.toString('utf-8');

        // Create subdomain entry
        if (deployTarget) {
            // Deliberately no row: the script's identity comes from the caller,
            // which can recompute it whenever it needs to. A row here would be
            // a second copy of that identity to keep in sync with the source
            // file, which is the thing this path exists to avoid.
        } else if (existingSub) {
            // Update root_dir if worker already exists
            const updated = await this.stores.subdomain.update(
                String(existingSub.uuid),
                {
                    root_dir_id: loaded.fsEntry?.sqlId ?? null,
                    preamble_version: preambleVersion,
                },
                { userId: actor.user.id },
            );
            if (!updated) {
                throw new HttpError(409, 'Worker name is already in use', {
                    legacyCode: 'conflict',
                });
            }
        } else {
            if (!loaded.fsEntry?.sqlId)
                throw new HttpError(400, `Invalid file recieved!`, {
                    legacyCode: 'bad_request',
                });
            await this.stores.subdomain.create({
                userId: actor.user.id!,
                subdomain: subdomainName,
                rootDirId: loaded.fsEntry?.sqlId,
                appOwner: appOwnerId,
                preambleVersion,
            });
            // Announced against the row rather than the deploy: the row is
            // what makes the worker ours to keep, and it outlives a failed
            // deploy. Awaited so a listener has settled before the caller is
            // told the worker exists; one that throws is logged and ignored.
            await this.clients.event.emitAndWait(
                'worker.create',
                { actor, workerName },
                {},
            );
        }

        // AppData is keyed by the app the worker authenticates as, so the
        // directory has to follow the binding rather than the caller.
        if (boundApp) {
            await this.services.fs.mkdir(actor.user.id!, {
                path: `/${actor.user.username}/AppData/${boundApp.uid}`,
                createMissingParents: true,
            });
        }

        // Deploy to Cloudflare
        const cfResult = await this.#cfDeploy(
            deployTarget?.scriptName ?? workerName,
            authorization,
            preamble + sourceCode,
            deployTarget,
        );
        return cfResult;
    }

    async destroy(args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireActor();
        this.#requireVerified(actor);
        const workerName = String(args.workerName ?? '').toLowerCase();
        if (!workerName)
            throw new HttpError(400, 'Missing `workerName`', {
                legacyCode: 'bad_request',
            });

        // Same ordering as create: resolve who owns the worker before
        // reporting on the deploy backend.
        const subdomainName = `${WORKER_SUBDOMAIN_PREFIX}${workerName}`;
        const row = await this.stores.subdomain.getBySubdomain(subdomainName);
        if (!row)
            throw new HttpError(404, 'Worker not found', {
                legacyCode: 'not_found',
            });
        await this.#checkWorkerWriteAccess(
            row,
            actor,
            403,
            'This is not your worker',
            'forbidden',
        );

        this.#requireCfConfig();

        const cfResult = await this.#cfDelete(workerName);
        await this.stores.subdomain.deleteByUuid(row.uuid, {
            userId: actor.user.id,
        });
        return cfResult;
    }

    async getFilePaths(args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireActor();
        const workerName = args.workerName as string | undefined;

        const limit = normalizeLimit(args.limit, { cap: 5000 });
        const offset = normalizeOffset(args.offset);
        const hasCursor = Object.prototype.hasOwnProperty.call(args, 'cursor');
        const payload = decodeCursor(
            args.cursor as string | null | undefined,
        ) as { id?: number } | undefined;
        if (payload && offset !== undefined) {
            throw new HttpError(400, 'cursor and offset cannot be combined', {
                legacyCode: 'bad_request',
            });
        }
        const includeTotal = args.includeTotal === true;
        const paginated =
            hasCursor ||
            limit !== undefined ||
            offset !== undefined ||
            includeTotal;
        const pageSize = limit ?? 500;

        // An app sees the workers it deployed under itself and under the apps
        // it created (the sandboxed ones) — the same set it may manage.
        const managedAppIds = actor.app
            ? await this.#managedAppIds(actor)
            : undefined;

        let rows: SubdomainRow[];
        let cursor: string | undefined;
        if (typeof workerName === 'string' && workerName.length > 0) {
            const sub = await this.stores.subdomain.getBySubdomain(
                `${WORKER_SUBDOMAIN_PREFIX}${workerName}`,
            );
            rows = sub ? [sub] : [];
        } else {
            rows = await this.stores.subdomain.listByUserIdAndPrefix(
                actor.user.id,
                WORKER_SUBDOMAIN_PREFIX,
                {
                    ...(managedAppIds ? { appIds: managedAppIds } : {}),
                    ...(paginated
                        ? {
                              limit: pageSize + 1,
                              offset,
                              afterId:
                                  payload?.id !== undefined
                                      ? Number(payload.id)
                                      : undefined,
                          }
                        : {}),
                },
            );
            if (paginated && rows.length > pageSize) {
                rows = rows.slice(0, pageSize);
                cursor = encodeCursor({
                    id: Number(rows[rows.length - 1]!.id),
                });
            }
        }

        const rootDirIds = rows
            .map((r) => r.root_dir_id)
            .filter((id): id is number => typeof id === 'number');
        const entriesById =
            await this.stores.fsEntry.getEntriesByIds(rootDirIds);

        // Make sure the user only sees their own workers
        rows = rows.filter((r) => {
            return r.user_id === actor.user.id;
        });
        if (managedAppIds) {
            rows = rows.filter((r) => {
                return (
                    r.app_owner !== null &&
                    r.app_owner !== undefined &&
                    managedAppIds.includes(Number(r.app_owner))
                );
            });
        }

        const items = rows.map((r) => {
            const name =
                String(r.subdomain ?? '')
                    .split('.')
                    .pop() ?? '';
            let file_path = null;
            let file_uid = null;
            if (typeof r.root_dir_id === 'number') {
                const loaded = entriesById.get(r.root_dir_id);
                file_path = loaded?.path;
                file_uid = loaded?.uuid;
            }
            return {
                name,
                url: `https://${name}.puter.work`,
                file_path,
                file_uid,
                created_at: r.ts
                    ? new Date(r.ts as string).toISOString()
                    : null,
            };
        });

        if (!paginated) return items;

        let total: number | undefined;
        if (includeTotal) {
            total = await this.stores.subdomain.countByUserIdAndPrefix(
                actor.user.id,
                WORKER_SUBDOMAIN_PREFIX,
                managedAppIds ? { appIds: managedAppIds } : {},
            );
        }

        return {
            items,
            ...(cursor ? { cursor } : {}),
            ...(total !== undefined ? { total } : {}),
        };
    }

    async getLoggingUrl(): Promise<string | null> {
        return this.#workerConfig().loggingUrl ?? null;
    }

    // -- Cloudflare API ----------------------------------------------

    async #cfDeploy(
        workerName: string,
        authorization: string,
        code: string,
        target?: InternalDeployTarget,
    ): Promise<Record<string, unknown>> {
        if (USE_LOCAL_WORKERD) {
            return this.services.localworkerservice.cfDeployLocal(
                workerName,
                authorization,
                code,
            );
        }
        const cfg = this.#workerConfig();
        const metadata = JSON.stringify({
            body_part: 'swCode',
            compatibility_flags: ['global_fetch_strictly_public'],
            compatibility_date: '2025-07-15',
            ...(target?.tags ? { tags: target.tags } : {}),
            bindings: [
                {
                    type: 'secret_text',
                    name: 'puter_auth',
                    text: authorization,
                },
                {
                    type: 'plain_text',
                    name: 'puter_endpoint',
                    text: cfg.internetExposedUrl ?? 'https://api.puter.com',
                },
            ],
        });

        const form = new FormData();
        form.append('metadata', metadata);
        form.append(
            'swCode',
            new Blob([code], { type: 'application/javascript' }),
        );

        const res = await fetch(
            `${this.#deployBaseUrl(target)}/scripts/${workerName}/`,
            {
                method: 'PUT',
                headers: { Authorization: `Bearer ${cfg.XAUTHKEY}` },
                body: form,
            },
        );
        const json = (await res.json()) as {
            success?: boolean;
            errors?: Array<{ message: string }>;
        };

        if (json.success) {
            return {
                success: true,
                errors: [],
                // A caller that named the script also owns how it is reached;
                // the per-worker subdomain below is not where it answers.
                url: target ? null : `https://${workerName}.puter.work`,
            };
        }

        // Parse Cloudflare error stack traces to adjust for preamble offset
        const errors = (json.errors ?? []).map((e) => {
            const lines = e.message.split('\n');
            const header = lines.shift() ?? '';
            const adjusted = lines.map((line) => {
                if (line.includes('at worker.js:')) {
                    const [before, after] = line.split('at worker.js:');
                    const positions = after.split(':');
                    positions[0] = String(
                        Number(positions[0]) - preambleLineCount,
                    );
                    return `${before}at worker.js:${positions.join(':')}`;
                }
                return line;
            });
            return `${header}\n${adjusted.join('\n')}`;
        });
        return { success: false, errors, url: null };
    }

    async #cfDelete(workerName: string): Promise<Record<string, unknown>> {
        if (USE_LOCAL_WORKERD) {
            return this.services.localworkerservice.cfDeleteLocal(workerName);
        }
        const cfg = this.#workerConfig();
        const res = await fetch(`${this.#cfBaseUrl}/scripts/${workerName}/`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${cfg.XAUTHKEY}` },
        });
        return (await res.json()) as Record<string, unknown>;
    }

    // -- Helpers ------------------------------------------------------

    #requireActor(): Actor & {
        user: { id: number; uuid: string; username: string };
    } {
        const actor = Context.get('actor') as Actor | undefined;
        if (!actor?.user?.id)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        return actor as Actor & {
            user: { id: number; uuid: string; username: string };
        };
    }

    /**
     * Only in-process code can supply a deploy target, so this is not a trust
     * boundary — it is a guard against a caller putting a path separator or a
     * space into a name that is about to be interpolated into a request URL,
     * where it would silently address something other than what was meant.
     */
    #validateDeployTarget(
        target: InternalDeployTarget | undefined,
    ): InternalDeployTarget | undefined {
        if (!target) return undefined;
        const invalid =
            !WORKER_NAME_REGEX.test(target.scriptName) ||
            (target.namespace !== undefined &&
                !WORKER_NAME_REGEX.test(target.namespace));
        if (invalid) {
            throw new HttpError(500, 'Invalid internal deploy target', {
                legacyCode: 'internal_error',
            });
        }
        return target;
    }

    /**
     * Where scripts are written. The configured default is resolved once at
     * startup; a deploy target picks its own grouping per call, which is what
     * keeps its scripts out of the default one entirely.
     */
    #deployBaseUrl(target?: InternalDeployTarget): string {
        if (!target?.namespace) return this.#cfBaseUrl;
        const cfg = this.#workerConfig();
        return `${CF_BASE_URL}/${cfg.ACCOUNTID}/workers/dispatch/namespaces/${target.namespace}`;
    }

    #requireCfConfig(): void {
        const cfg = this.#workerConfig();
        if ((!cfg.XAUTHKEY || !cfg.ACCOUNTID) && !cfg.localServer) {
            throw new HttpError(503, 'Cloudflare Workers not configured', {
                legacyCode: 'response_timeout',
            });
        }
    }

    #rejectReserved(name: string): void {
        const reserved = this.config.reserved_words ?? [];
        if (reserved.includes(name)) {
            throw new HttpError(400, `Worker name '${name}' is reserved`, {
                legacyCode: 'bad_request',
            });
        }
    }

    async #checkWorkerWriteAccess(
        row: SubdomainRow,
        actor: Actor & { user: { id: number } },
        errorStatus: number,
        errorMessage: string,
        errorLegacyCode: LegacyErrorCodes,
    ): Promise<void> {
        const deny = () =>
            new HttpError(errorStatus, errorMessage, {
                legacyCode: errorLegacyCode,
            });

        if (Number(row.user_id) !== actor.user.id) throw deny();

        if (!actor.app) return;

        const actorAppId = actor.app.id;
        const workerAppOwnerId =
            row.app_owner === null || row.app_owner === undefined
                ? null
                : Number(row.app_owner);
        if (!actorAppId || workerAppOwnerId === null) throw deny();
        if (workerAppOwnerId === actorAppId) return;

        // A worker bound to an app the caller created stays manageable by its
        // creator — otherwise an app could deploy a sandboxed worker and then
        // be locked out of redeploying or destroying it.
        if (!(await this.#appIsOwnedByActorApp(workerAppOwnerId, actor)))
            throw deny();
    }

    /**
     * The app a worker deployed by `actor` should authenticate as, or null for
     * a user-scoped worker. `requestedAppUid` is the caller-supplied binding
     * (`appId`), which defaults to the caller's own app.
     *
     * An app actor may name its own app, or an app it created for this user
     * (`apps.app_owner`) — the sandbox case, which gives each generated project
     * its own KV/AppData namespace. Root sessions keep their existing reach
     * over any app.
     */
    async #resolveWorkerAppBinding(
        actor: Actor & { user: { id: number } },
        requestedAppUid?: string,
    ): Promise<{ uid: string; id?: number } | null> {
        // Self-binding, either implicit or named. Not every actor shape carries
        // `app.id`, so fall back to a lookup rather than leaving the subdomain
        // row unowned.
        const selfBinding = async () => ({
            uid: actor.app!.uid,
            id:
                actor.app!.id ??
                (await this.stores.app.getByUid(actor.app!.uid))?.id,
        });
        if (!requestedAppUid) {
            return actor.app?.uid ? await selfBinding() : null;
        }
        if (actor.app?.uid === requestedAppUid) {
            return await selfBinding();
        }

        const app = await this.stores.app.getByUid(requestedAppUid);
        if (!actor.app) {
            // Root session: unchanged: bind to whatever it names. An unknown
            // uid still mints a token, as it did before, and simply leaves the
            // subdomain row unowned by any app.
            return { uid: requestedAppUid, id: app?.id };
        }

        if (!app || !(await this.#appIsOwnedByActorApp(app.id, actor))) {
            throw new HttpError(403, 'Cannot deploy worker for another app', {
                legacyCode: 'forbidden',
            });
        }
        return { uid: app.uid, id: app.id };
    }

    /**
     * Whether `appId` is an app the actor's app created for this same user.
     * Mirrors `AppDriver.#checkWriteAccess` — both halves matter: `app_owner`
     * alone would let an app reach a namesake row owned by a different user.
     */
    async #appIsOwnedByActorApp(
        appId: number,
        actor: Actor & { user: { id: number } },
    ): Promise<boolean> {
        if (!actor.app?.id) return false;
        const app = await this.stores.app.getById(appId);
        if (!app) return false;
        return (
            Number(app.app_owner) === Number(actor.app.id) &&
            Number(app.owner_user_id) === Number(actor.user.id)
        );
    }

    /**
     * App ids whose workers the caller may see and manage: its own, plus every
     * app it created for this user. Only meaningful for app actors — a root
     * session sees all of its own workers.
     */
    async #managedAppIds(
        actor: Actor & { user: { id: number } },
    ): Promise<number[]> {
        if (!actor.app?.id) return [];
        const children = await this.stores.app.list({
            appOwner: actor.app.id,
            ownerUserId: actor.user.id,
            limit: CHILD_APP_SCAN_LIMIT,
        });
        return [
            actor.app.id,
            ...children.map((app: { id: number }) => Number(app.id)),
        ];
    }

    #workerConfig(): NonNullable<typeof this.config.workers> {
        return this.config.workers ?? {};
    }

    /**
     * Mirror of the HTTP-layer `requireVerifiedGate` on /delete-site — only
     * active when `strict_email_verification_required` is truthy, so self-
     * hosted installs without SMTP aren't bricked. Applied at the driver level
     * so /drivers/call can't bypass the gate the HTTP route enforces.
     */
    #requireVerified(actor: Actor): void {
        assertVerifiedEmail(
            Boolean(this.config.strict_email_verification_required),
            actor.user,
            400,
        );
    }

    // -- Hot-reload: auto-redeploy on source file write --------------
    //
    // When a user saves a JS file that's tied to a worker subdomain,
    // we redeploy it to Cloudflare automatically. This is what makes
    // "save file → live in prod" instant.
    //
    // This listens to backend FS lifecycle events rather than `outer.gui.*`
    // socket events. GUI events intentionally expose public UUID-shaped ids,
    // while worker subdomains are keyed to the numeric fsentries.id.

    #subscribeHotReload(): void {
        if (!this.#cfBaseUrl && !USE_LOCAL_WORKERD) return;
        // Idempotent: re-entry (e.g. a second onServerStart) must not stack
        // duplicate listeners — each duplicate would multiply redeploys on
        // every user's worker-source save.
        if (this.#hotReloadSubscribed) return;
        this.#hotReloadSubscribed = true;

        this.clients.event.on(
            'fs.write.file',
            (_key: string, data: unknown, meta: EventMetadata) => {
                void this.#handleSourceWrite(data, meta).catch((err) => {
                    console.error('[workers] hot-reload error', err);
                });
            },
        );
        this.clients.event.on(
            'fs.remove.node',
            (_key: string, data: unknown, meta: EventMetadata) => {
                void this.#handleSourceRemove(data, meta).catch((err) => {
                    console.error('[workers] source remove error', err);
                });
            },
        );
        this.clients.event.on(
            'fs.move.node',
            (_key: string, data: unknown, meta: EventMetadata) => {
                void this.#handleSourceMove(data, meta).catch((err) => {
                    console.error('[workers] source move error', err);
                });
            },
        );
    }

    async #handleSourceWrite(
        data: unknown,
        meta: EventMetadata,
    ): Promise<void> {
        const metaObj =
            meta && typeof meta === 'object'
                ? (meta as Record<string, unknown>)
                : {};
        // Only run on the local node — incoming broadcast writes shouldn't trigger a re-deploy
        if (metaObj.from_outside) return;

        const entry = this.#extractFsEntryFromEvent(data);
        if (!entry || entry.isDir) return;

        const matched = await this.#listWorkerRowsForEntry(entry);
        if (matched.length === 0) return;

        for (const row of matched) {
            const workerFullName = String(row.subdomain ?? '');
            if (!workerFullName.startsWith(WORKER_SUBDOMAIN_PREFIX)) continue;
            const workerName = workerFullName.slice(
                WORKER_SUBDOMAIN_PREFIX.length,
            );

            try {
                const ownerUser = await this.stores.user.getById(entry.userId);
                if (!ownerUser) continue;
                const ownerActor = makeActor({ user: ownerUser });

                // Read the updated file content. `ownerActor` is the file's
                // owner from the originating write event, so the read-ACL
                // check inside loadFileInput will pass.
                const loaded = await loadFileInput(
                    {
                        fsEntry: this.stores.fsEntry,
                        s3Object: this.stores.s3Object,
                    },
                    this.services.fs,
                    ownerActor,
                    entry.path ?? entry.uuid, // prefer path, fall back to uuid
                    { maxBytes: MAX_SOURCE_SIZE },
                );
                const sourceCode = loaded.buffer.toString('utf-8');

                // Mint a worker token for the redeploy. Idempotent on
                // (user, app_uid, worker_name) so a hot-reload reuses
                // the same row across reloads and the long-lived token
                // stays stable for the worker's whole lifetime.
                const appOwnerId = row.app_owner as number | null;
                let authorization: string;
                if (appOwnerId) {
                    const app = await this.stores.app.getById(appOwnerId);
                    if (!app) continue; // app gone
                    authorization =
                        await this.services.auth.createWorkerAppToken(
                            ownerActor,
                            app.uid,
                            workerName,
                        );
                } else {
                    const session =
                        await this.services.auth.createWorkerSessionToken(
                            ownerUser,
                            workerName,
                        );

                    authorization = session.token;
                }

                // Deploy
                const cfResult = (await this.#cfDeploy(
                    workerName,
                    authorization,
                    preamble + sourceCode,
                )) as { success?: boolean; errors?: unknown[]; url?: string };

                if (cfResult.success && row.uuid) {
                    await this.stores.subdomain.update(
                        String(row.uuid),
                        { preamble_version: preambleVersion },
                        { userId: entry.userId },
                    );
                }

                // Notify the user
                await this.#notifyUser(entry.userId, workerName, cfResult);
            } catch (err) {
                console.warn(
                    `[workers] hot-reload deploy failed for ${workerName}`,
                    err,
                );
                await this.#notifyUser(entry.userId, workerName, {
                    success: false,
                    errors: [String(err)],
                });
            }
        }
    }

    async #handleSourceRemove(
        data: unknown,
        meta: EventMetadata,
    ): Promise<void> {
        const metaObj =
            meta && typeof meta === 'object'
                ? (meta as Record<string, unknown>)
                : {};
        if (metaObj.from_outside) return;

        const entry = this.#extractFsEntryFromEvent(data);
        if (!entry || entry.isDir) return;

        const matched = await this.#listWorkerRowsForEntry(entry);
        for (const row of matched) {
            await this.#deleteWorkerForSourceRow(row, entry.userId);
        }
    }

    async #handleSourceMove(data: unknown, meta: EventMetadata): Promise<void> {
        const metaObj =
            meta && typeof meta === 'object'
                ? (meta as Record<string, unknown>)
                : {};
        if (metaObj.from_outside) return;

        const entry = this.#extractFsEntryFromEvent(data);
        if (!entry || !this.#isTrashPath(entry.path)) return;

        const matched = entry.isDir
            ? await this.#listWorkerRowsUnderPath(entry.userId, entry.path)
            : await this.#listWorkerRowsForEntry(entry);
        for (const row of matched) {
            await this.#deleteWorkerForSourceRow(row, entry.userId);
        }
    }

    #extractFsEntryFromEvent(data: unknown): FSEntry | undefined {
        if (!data || typeof data !== 'object') return undefined;
        const event = data as Record<string, unknown>;
        for (const key of ['node', 'entry', 'target']) {
            const value = event[key];
            if (this.#isFsEntry(value)) {
                return value;
            }
        }
        return undefined;
    }

    #isFsEntry(value: unknown): value is FSEntry {
        if (!value || typeof value !== 'object') return false;
        const entry = value as Partial<FSEntry>;
        return (
            typeof entry.id === 'number' &&
            typeof entry.uuid === 'string' &&
            typeof entry.userId === 'number' &&
            typeof entry.path === 'string' &&
            typeof entry.isDir === 'boolean'
        );
    }

    async #listWorkerRowsForEntry(entry: FSEntry): Promise<SubdomainRow[]> {
        const workerSubs = await this.stores.subdomain.listByUserIdAndPrefix(
            entry.userId,
            WORKER_SUBDOMAIN_PREFIX,
        );
        return workerSubs.filter((r) => {
            return (
                String(r.root_dir_id) === String(entry.id) ||
                String(r.root_dir_id) === String(entry.uuid) ||
                String(r.root_dir_id) === String(entry.uid)
            );
        });
    }

    async #listWorkerRowsUnderPath(
        userId: number,
        parentPath: string,
    ): Promise<SubdomainRow[]> {
        const workerSubs = await this.stores.subdomain.listByUserIdAndPrefix(
            userId,
            WORKER_SUBDOMAIN_PREFIX,
        );
        const rootDirIds = workerSubs
            .map((r) => r.root_dir_id)
            .filter((id): id is number => typeof id === 'number');
        const entriesById =
            await this.stores.fsEntry.getEntriesByIds(rootDirIds);
        return workerSubs.filter((row) => {
            const rootDirId = row.root_dir_id;
            if (typeof rootDirId !== 'number') return false;
            const entry = entriesById.get(rootDirId);
            return (
                entry?.path === parentPath ||
                entry?.path.startsWith(`${parentPath}/`)
            );
        });
    }

    #isTrashPath(entryPath: string): boolean {
        const parts = entryPath.split('/').filter(Boolean);
        return parts[1] === 'Trash';
    }

    async #deleteWorkerForSourceRow(
        row: SubdomainRow,
        userId: number,
    ): Promise<void> {
        const workerFullName = String(row.subdomain ?? '');
        if (!workerFullName.startsWith(WORKER_SUBDOMAIN_PREFIX)) return;
        const workerName = workerFullName.slice(WORKER_SUBDOMAIN_PREFIX.length);

        try {
            await this.#cfDelete(workerName);
            if (row.uuid) {
                await this.stores.subdomain.deleteByUuid(String(row.uuid), {
                    userId,
                });
            }
        } catch (err) {
            console.warn(
                `[workers] source cleanup failed for ${workerName}`,
                err,
            );
        }
    }

    async #notifyUser(
        userId: number,
        workerName: string,
        result: { success?: boolean; errors?: unknown[]; url?: string },
    ): Promise<void> {
        try {
            const title = result.success
                ? `Successfully deployed https://${workerName}.puter.work`
                : `Failed to deploy ${workerName}! ${(result.errors ?? []).join(', ')}`;

            await this.services.notification.notify([userId], {
                source: 'worker',
                title,
                template: 'user-requesting-share',
            });
        } catch (err) {
            console.warn('[workers] notification create failed', err);
        }
    }
}
