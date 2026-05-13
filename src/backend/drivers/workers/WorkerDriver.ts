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

import { readFileSync } from 'node:fs';
import { Context } from '../../core/context.js';
import { HttpError, type LegacyErrorCodes } from '../../core/http/HttpError.js';
import { assertVerifiedEmail } from '../../core/http/verifiedEmail.js';
import { PuterDriver } from '../types.js';
import { loadFileInput } from '../util/fileInput.js';
import type { Actor } from '../../core/actor.js';
import path from 'node:path';

const CF_BASE_URL = 'https://api.cloudflare.com/client/v4/accounts';
const WORKER_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_WORKERS_PER_USER = 100;
const MAX_SOURCE_SIZE = 10 * 1024 * 1024; // 10 MB
const WORKER_SUBDOMAIN_PREFIX = 'workers.puter.';

// ── Preamble ────────────────────────────────────────────────────────
//
// The preamble is a webpack-built JS bundle that provides puter.js to
// worker code. It's baked into the source sent to Cloudflare Workers.
// If the file hasn't been built, workers run without puter.js access.

let preamble = '';
let preambleError = false;
let preambleLineCount = 0;
try {
    const preamblePath = path.join(
        __dirname,
        '../../../../../src/worker/dist/workerPreamble.js',
    );
    console.log('reading: ' + preamblePath);
    preamble = readFileSync(preamblePath, 'utf-8');
    preambleLineCount = preamble.split('\n').length - 1;
} catch {
    console.warn(
        '[workers] preamble not built — workers will not have puter.js injected.',
    );
    preambleError = true;
}

/**
 * Driver exposing the `workers` interface — Cloudflare Workers
 * deployment, lifecycle, and file-path queries.
 *
 * Each "worker" is a JS file in the user's Puter FS, deployed to
 * Cloudflare Workers. A corresponding `subdomains` row with subdomain
 * `workers.puter.<name>` ties the worker to its source file.
 *
 * Config: `config.workers.{XAUTHKEY, ACCOUNTID, namespace?, internetExposedUrl?, loggingUrl?}`.
 */
export class WorkerDriver extends PuterDriver {
    readonly driverInterface = 'workers';
    // puter-js calls this as `workers:worker-service` (see Workers.js). Keep the name aligned.
    readonly driverName = 'worker-service';
    readonly isDefault = true;

    #cfBaseUrl = '';

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
        }
        this.#subscribeHotReload();
    }

    // ── Driver methods ──────────────────────────────────────────────

    async create(args: {
        appId: string;
        workerName: string;
        filePath: string;
        authorization?: string;
    }): Promise<unknown> {
        const actor = this.#requireActor();
        this.#requireVerified(actor);
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
        this.#requireCfConfig();
        const subdomainName = `${WORKER_SUBDOMAIN_PREFIX}${workerName}`;

        // Quota check — count existing workers.puter.* subdomains owned by user
        const existingWorkers =
            await this.stores.subdomain.listByUserIdAndPrefix(
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

        // If tied to an app, verify ownership and get app-scoped token
        let authorization = String(args.authorization ?? '');
        let appOwnerId = actor.app?.id ?? undefined;
        if (appId) {
            if (actor.app && actor.app.uid !== appId) {
                throw new HttpError(
                    403,
                    'Cannot deploy worker for another app',
                    { legacyCode: 'forbidden' },
                );
            }
            appOwnerId = actor.app?.id;
            authorization = this.services.auth.getUserAppToken(actor, appId);
        }
        if (!authorization && actor.app?.uid) {
            authorization = this.services.auth.getUserAppToken(
                actor,
                actor.app.uid,
            );
        }

        const existingSub =
            await this.stores.subdomain.getBySubdomain(subdomainName);
        if (existingSub) {
            this.#checkWorkerWriteAccess(
                existingSub,
                actor,
                409,
                'Worker name is already in use',
                'conflict',
            );
        }
        if (!authorization) {
            // Fall back to a session token for the current user
            const userRow = await this.stores.user.getById(actor.user.id!);
            if (!userRow)
                throw new HttpError(500, 'User not found', {
                    legacyCode: 'internal_error',
                });
            const session =
                await this.services.auth.createSessionToken(userRow);
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
        if (existingSub) {
            // Update root_dir if worker already exists
            const updated = await this.stores.subdomain.update(
                String(existingSub.uuid),
                {
                    root_dir_id: loaded.fsEntry?.sqlId ?? null,
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
            });
        }

        // Deploy to Cloudflare
        const cfResult = await this.#cfDeploy(
            workerName,
            authorization,
            preamble + sourceCode,
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
        this.#requireCfConfig();

        const subdomainName = `${WORKER_SUBDOMAIN_PREFIX}${workerName}`;
        const row = await this.stores.subdomain.getBySubdomain(subdomainName);
        if (!row)
            throw new HttpError(404, 'Worker not found', {
                legacyCode: 'not_found',
            });
        this.#checkWorkerWriteAccess(
            row,
            actor,
            403,
            'This is not your worker',
            'forbidden',
        );

        const cfResult = await this.#cfDelete(workerName);
        await this.stores.subdomain.deleteByUuid(row.uuid, {
            userId: actor.user.id,
        });
        return cfResult;
    }

    async getFilePaths(args: Record<string, unknown>): Promise<unknown[]> {
        const actor = this.#requireActor();
        const workerName = args.workerName as string | undefined;

        let rows: Array<Record<string, unknown>>;
        if (typeof workerName === 'string' && workerName.length > 0) {
            const sub = await this.stores.subdomain.getBySubdomain(
                `${WORKER_SUBDOMAIN_PREFIX}${workerName}`,
            );
            rows = sub ? [sub] : [];
        } else {
            rows = await this.stores.subdomain.listByUserIdAndPrefix(
                actor.user.id,
                WORKER_SUBDOMAIN_PREFIX,
                actor.app ? { appId: actor.app.id } : {},
            );
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
        if (actor.app) {
            rows = rows.filter((r) => {
                return r.app_owner === actor.app?.id;
            });
        }

        return rows.map((r) => {
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
    }

    async getLoggingUrl(): Promise<string | null> {
        return this.#workerConfig().loggingUrl ?? null;
    }

    // ── Cloudflare API ──────────────────────────────────────────────

    async #cfDeploy(
        workerName: string,
        authorization: string,
        code: string,
    ): Promise<Record<string, unknown>> {
        const cfg = this.#workerConfig();
        const metadata = JSON.stringify({
            body_part: 'swCode',
            compatibility_flags: ['global_fetch_strictly_public'],
            compatibility_date: '2025-07-15',
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

        const res = await fetch(`${this.#cfBaseUrl}/scripts/${workerName}/`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${cfg.XAUTHKEY}` },
            body: form,
        });
        const json = (await res.json()) as {
            success?: boolean;
            errors?: Array<{ message: string }>;
        };

        if (json.success) {
            return {
                success: true,
                errors: [],
                url: `https://${workerName}.puter.work`,
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
        const cfg = this.#workerConfig();
        const res = await fetch(`${this.#cfBaseUrl}/scripts/${workerName}/`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${cfg.XAUTHKEY}` },
        });
        return (await res.json()) as Record<string, unknown>;
    }

    // ── Helpers ──────────────────────────────────────────────────────

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

    #requireCfConfig(): void {
        const cfg = this.#workerConfig();
        if (!cfg.XAUTHKEY || !cfg.ACCOUNTID) {
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

    #checkWorkerWriteAccess(
        row: Record<string, unknown>,
        actor: Actor & { user: { id: number } },
        errorStatus: number,
        errorMessage: string,
        errorLegacyCode: LegacyErrorCodes,
    ): void {
        if (Number(row.user_id) !== actor.user.id) {
            throw new HttpError(errorStatus, errorMessage, {
                legacyCode: errorLegacyCode,
            });
        }

        if (!actor.app) return;

        const actorAppId = actor.app.id;
        const workerAppOwnerId =
            row.app_owner === null || row.app_owner === undefined
                ? null
                : Number(row.app_owner);
        if (!actorAppId || workerAppOwnerId !== actorAppId) {
            throw new HttpError(errorStatus, errorMessage, {
                legacyCode: errorLegacyCode,
            });
        }
    }

    #workerConfig(): NonNullable<typeof this.config.workers> {
        return this.config.workers ?? {};
    }

    /**
     * Mirror of the HTTP-layer `requireVerifiedGate` on /delete-site — only
     * active when `strict_email_verification_required` is truthy, so self-
     * hosted installs without SMTP aren't bricked. Applied at the driver
     * level so /drivers/call can't bypass the gate the HTTP route enforces.
     */
    #requireVerified(actor: Actor): void {
        assertVerifiedEmail(
            Boolean(this.config.strict_email_verification_required),
            actor.user,
            400,
        );
    }

    // ── Hot-reload: auto-redeploy on file write ─────────────────────
    //
    // When a user saves a JS file that's tied to a worker subdomain,
    // we redeploy it to Cloudflare automatically. This is what makes
    // "save file → live in prod" instant.
    //
    // The FS layer emits `outer.gui.item.added` and
    // `outer.gui.item.updated` after a write commits. We subscribe to
    // those — the payload carries `{ user_id_list, response }` where
    // `response` is the entry shape (uuid, path, user_id, etc.). We
    // match against worker subdomain `root_dir_id` to decide whether
    // to re-deploy.

    #subscribeHotReload(): void {
        if (!this.#cfBaseUrl) return; // CF not configured — skip

        for (const eventName of [
            'outer.gui.item.added',
            'outer.gui.item.updated',
        ] as const) {
            this.clients.event.on(
                eventName,
                (_key: string, data: unknown, meta: unknown) => {
                    void this.#handleFileWrite(data, meta).catch((err) => {
                        console.error('[workers] hot-reload error', err);
                    });
                },
            );
        }
    }

    async #handleFileWrite(data: unknown, meta: unknown): Promise<void> {
        const metaObj =
            meta && typeof meta === 'object'
                ? (meta as Record<string, unknown>)
                : {};
        // Only run on the local node — incoming broadcast writes shouldn't trigger a re-deploy
        if (metaObj.from_outside) return;

        const d = data as Record<string, unknown> | undefined;
        if (!d) return;

        // `outer.gui.item.*` events carry `{ user_id_list, response }`
        // where `response` is the FS entry shape. Extract what we need.
        const response = (d.response ?? d) as Record<string, unknown>;
        const userIdList = d.user_id_list as Array<number | string> | undefined;

        const uuid = (response.uuid ?? response.uid) as string | undefined;
        const userId = (userIdList?.[0] ?? response.user_id) as
            | number
            | undefined;
        const path = response.path as string | undefined;

        // Only files trigger hot-reload (not directories)
        if (response.is_dir || response.isDir) return;
        if (!uuid || !userId) return;

        // Check if any worker subdomain points at this file
        const workerSubs = await this.stores.subdomain.listByUserIdAndPrefix(
            userId,
            WORKER_SUBDOMAIN_PREFIX,
        );
        const matched = workerSubs.filter((r: Record<string, unknown>) => {
            // root_dir_id can be the FS entry id or uuid depending on how it was stored
            return (
                String(r.root_dir_id) === String(uuid) ||
                String(r.root_dir_id) === String(response.id)
            );
        });

        if (matched.length === 0) return;

        for (const row of matched) {
            const workerFullName = String(row.subdomain ?? '');
            if (!workerFullName.startsWith(WORKER_SUBDOMAIN_PREFIX)) continue;
            const workerName = workerFullName.slice(
                WORKER_SUBDOMAIN_PREFIX.length,
            );

            try {
                const ownerUser = await this.stores.user.getById(userId);
                if (!ownerUser) continue;
                const ownerActor = { user: ownerUser } as Actor;

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
                    path ?? uuid, // prefer path, fall back to uuid
                    { maxBytes: MAX_SOURCE_SIZE },
                );
                const sourceCode = loaded.buffer.toString('utf-8');

                // Get an auth token for the deploy
                const appOwnerId = row.app_owner as number | null;
                let authorization: string;
                if (appOwnerId) {
                    // App-scoped: get the app's uid, then mint an app-under-user token
                    const app = await this.stores.app.getById(appOwnerId);
                    if (!app) continue; // app gone
                    authorization = this.services.auth.getUserAppToken(
                        ownerActor,
                        app.uid,
                    );
                } else {
                    // User-scoped: mint a session token
                    const session =
                        await this.services.auth.createSessionToken(ownerUser);
                    authorization = session.token;
                }

                // Deploy
                const cfResult = (await this.#cfDeploy(
                    workerName,
                    authorization,
                    preamble + sourceCode,
                )) as { success?: boolean; errors?: unknown[]; url?: string };

                // Notify the user
                await this.#notifyUser(userId, workerName, cfResult);
            } catch (err) {
                console.warn(
                    `[workers] hot-reload deploy failed for ${workerName}`,
                    err,
                );
                await this.#notifyUser(userId, workerName, {
                    success: false,
                    errors: [String(err)],
                });
            }
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
