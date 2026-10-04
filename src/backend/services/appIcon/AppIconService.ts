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

import { Readable } from 'node:stream';
import type { LayerInstances } from '../../types';
import { APP_ICON_SIZES, getAppIconsBaseUrl } from '../../util/appIcon.js';
import {
    APP_ICONS_SUBDOMAIN,
    ensureSystemSite,
} from '../../util/systemSite.js';
import { UNLIMITED_STORAGE_ALLOWANCE } from '../fs/FSService.js';
import type { puterServices } from '../index';
import { PuterService } from '../types.js';

const APP_ICONS_PATH_PREFIX = '/system/app_icons';

// Minimum gap between read-triggered runs for one uid, so an icon that fails
// to process isn't retried on every GET.
const ICON_RETRY_COOLDOWN_MS = 10 * 60_000;
const ICON_ATTEMPTS_MAX_KEYS = 10_000;
const SHUTDOWN_WAIT_MS = 5_000;

const ORIGINAL_ICON_FILENAME = (uid: string) => `${uid}.png`;
const SIZED_ICON_FILENAME = (uid: string, size: number) => `${uid}-${size}.png`;

/**
 * App icon generation service.
 *
 * 1. On boot: ensures `/system/app_icons/` exists, owned by the system user, and
 *    that the `puter-app-icons` subdomain points at it. Icons are then served
 *    through Puter's regular hosting path
 *    (`https://puter-app-icons.<hosting-domain>/<uid>-<size>.png`) — no custom
 *    route, no custom S3 plumbing.
 * 2. On `app.new-icon` event: decodes the data URL, resizes via sharp to the 6
 *    standard sizes, and writes the PNGs into that directory via FSService. The
 *    write populates the CDN-backed subdomain automatically because
 *    `puter-app-icons` is a regular hosted site.
 * 3. Once the original is persisted, the app's `icon` column is rewritten from the
 *    data URL to the canonical endpoint URL so later reads don't re-ship the
 *    base64 payload.
 */
export class AppIconService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    #sharp: typeof import('sharp') | null = null;
    #dirReady: Promise<void> | null = null;
    #ownerUserId: number | null = null;

    // Per-uid in-flight run, so N concurrent GETs for an un-migrated icon
    // share one sharp/fs/db pass instead of each kicking off their own.
    #inFlight = new Map<
        string,
        { next?: Record<string, unknown>; done: Promise<void> }
    >();
    // Per-uid timestamp of the last attempt (success or failure), gating
    // read-triggered retries during `ICON_RETRY_COOLDOWN_MS`.
    #lastAttempt = new Map<string, number>();

    override async onServerStart(): Promise<void> {
        try {
            this.#sharp = (await import('sharp')).default;
        } catch {
            console.warn(
                '[app-icon] sharp not available — icon resizing disabled',
            );
        }

        // Retried from the icon pipeline if this fails at boot.
        this.#dirReady = this.ensureIconsDirectory().catch((e) => {
            console.warn('[app-icon] icons directory setup failed', e);
        });

        this.clients.event.on(
            'app.new-icon',
            async (_key: string, data: unknown) => {
                await this.#scheduleIcon(data as Record<string, unknown>, {
                    fromRead: true,
                });
            },
        );

        // Apps written with a data URL icon outside this pipeline get
        // picked up lazily through `app.changed`. Guarded against the
        // `icon-migrated` action we emit ourselves.
        this.clients.event.on(
            'app.changed',
            async (_key: string, data: unknown) => {
                const d = data as Record<string, unknown> | undefined;
                if (!d?.app_uid) return;
                if (d.action === 'icon-migrated') return;
                const app = await this.stores.app.getByUid(String(d.app_uid));
                const icon = (app as Record<string, unknown> | null)?.icon as
                    | string
                    | undefined;
                if (icon?.startsWith('data:')) {
                    await this.#scheduleIcon(
                        { app_uid: d.app_uid, data_url: icon },
                        { fromRead: false },
                    );
                }
            },
        );
    }

    // Let in-flight icon runs finish while the layers they write through are up,
    // but not past a few seconds: a stalled run retries on the next read, and
    // the rest of shutdown (metering flush included) must not wait on it.
    override async onServerShutdown(): Promise<void> {
        let timer: NodeJS.Timeout | undefined;
        const limit = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, SHUTDOWN_WAIT_MS);
        });
        try {
            await Promise.race([
                (async () => {
                    await this.#dirReady;
                    await Promise.all(
                        [...this.#inFlight.values()].map((s) => s.done),
                    );
                })(),
                limit,
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Public: canonical URL for an app's icon at a given size
     * (CDN/subdomain-backed).
     */
    getIconUrl(appUid: string, size: number): string | null {
        const base = this.#iconsBaseUrl();
        if (!base) return null;
        const normalized = appUid.startsWith('app-') ? appUid : `app-${appUid}`;
        return `${base}/${SIZED_ICON_FILENAME(normalized, size)}`;
    }

    /**
     * Public: URL of the un-resized original PNG (no size suffix) on the
     * subdomain.
     */
    getOriginalIconUrl(appUid: string): string | null {
        const base = this.#iconsBaseUrl();
        if (!base) return null;
        const normalized = appUid.startsWith('app-') ? appUid : `app-${appUid}`;
        return `${base}/${ORIGINAL_ICON_FILENAME(normalized)}`;
    }

    /**
     * Pick the best subdomain URL to redirect an icon request at. Falls back to
     * the un-resized original when the sized variant hasn't been generated
     * (e.g. apps imported with an HTTP icon URL that predates the sharp
     * pipeline), preventing 404s on `<uid>-<size>.png`.
     */
    async resolveIconRedirectUrl(
        appUid: string,
        size: number,
    ): Promise<string | null> {
        const base = this.#iconsBaseUrl();
        if (!base) return null;
        const normalized = appUid.startsWith('app-') ? appUid : `app-${appUid}`;
        const sizedPath = `${APP_ICONS_PATH_PREFIX}/${SIZED_ICON_FILENAME(normalized, size)}`;
        const sizedExists = await this.stores.fsEntry.getEntryByPath(sizedPath);
        if (sizedExists)
            return `${base}/${SIZED_ICON_FILENAME(normalized, size)}`;
        const originalPath = `${APP_ICONS_PATH_PREFIX}/${ORIGINAL_ICON_FILENAME(normalized)}`;
        const originalExists =
            await this.stores.fsEntry.getEntryByPath(originalPath);
        if (originalExists)
            return `${base}/${ORIGINAL_ICON_FILENAME(normalized)}`;
        return null;
    }

    #iconsBaseUrl(): string | null {
        return getAppIconsBaseUrl(this.config);
    }

    // -- Bootstrap ---------------------------------------------------

    /** Set up the system-owned icons directory and its subdomain. Idempotent. */
    async ensureIconsDirectory(): Promise<void> {
        const ownerUserId = await ensureSystemSite(this.stores, {
            subdomain: APP_ICONS_SUBDOMAIN,
            dirPath: APP_ICONS_PATH_PREFIX,
            isProtected: true,
        });
        if (ownerUserId === null) {
            console.warn('[app-icon] system user not found; icons disabled');
            return;
        }
        this.#ownerUserId = ownerUserId;
    }

    // -- Icon pipeline -----------------------------------------------

    /**
     * Runs `#processIcon` at most once at a time per uid. A write arriving
     * mid-run queues its payload for one more run (newest wins); a read joins
     * the current run, or is skipped within `ICON_RETRY_COOLDOWN_MS` of the
     * last attempt. Never rejects.
     */
    async #scheduleIcon(
        data: Record<string, unknown>,
        { fromRead }: { fromRead: boolean },
    ): Promise<void> {
        let uid = (data.appUid ?? data.app_uid) as string | undefined;
        if (!uid) return;
        if (!uid.startsWith('app-')) uid = `app-${uid}`;

        const inFlight = this.#inFlight.get(uid);
        if (inFlight) {
            if (!fromRead) inFlight.next = data;
            return inFlight.done;
        }

        if (fromRead) {
            const lastAttempt = this.#lastAttempt.get(uid);
            if (
                lastAttempt !== undefined &&
                Date.now() - lastAttempt < ICON_RETRY_COOLDOWN_MS
            ) {
                return;
            }
        }

        // Registered before the first await so concurrent callers join it.
        const state: { next?: Record<string, unknown>; done: Promise<void> } = {
            next: data,
            done: Promise.resolve(),
        };
        this.#inFlight.set(uid, state);
        const runningUid = uid;
        state.done = (async () => {
            try {
                while (state.next) {
                    const payload = state.next;
                    state.next = undefined;
                    this.#noteAttempt(runningUid);
                    try {
                        await this.#processIcon(payload);
                    } catch (err) {
                        console.warn('[app-icon] icon processing failed', err);
                    }
                }
            } finally {
                this.#inFlight.delete(runningUid);
            }
        })();
        return state.done;
    }

    #noteAttempt(uid: string): void {
        // Re-inserting moves the key to the end, so eviction below is FIFO
        // by last-attempt order, not insertion order.
        this.#lastAttempt.delete(uid);
        if (this.#lastAttempt.size >= ICON_ATTEMPTS_MAX_KEYS) {
            const oldest = this.#lastAttempt.keys().next().value;
            if (oldest !== undefined) this.#lastAttempt.delete(oldest);
        }
        this.#lastAttempt.set(uid, Date.now());
    }

    async #processIcon(data: Record<string, unknown>): Promise<void> {
        if (this.#dirReady) await this.#dirReady;
        if (!this.#ownerUserId) {
            // The boot-time setup failed; retry it.
            await this.ensureIconsDirectory();
            if (!this.#ownerUserId) return;
        }
        if (!this.#sharp) return; // can't resize without sharp

        const dataUrl = (data.dataUrl ?? data.data_url) as string | undefined;
        let appUid = (data.appUid ?? data.app_uid) as string | undefined;
        if (!dataUrl || !appUid) return;
        if (!appUid.startsWith('app-')) appUid = `app-${appUid}`;

        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx === -1) return;
        const inputBuffer = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
        if (inputBuffer.length === 0) return;

        // Write the original alongside the sized variants so the CDN-backed
        // subdomain serves everything through the same path.
        const writes: Array<Promise<unknown>> = [];

        const originalPng = await this.#sharp(inputBuffer).png().toBuffer();
        writes.push(
            this.#writeIcon(ORIGINAL_ICON_FILENAME(appUid), originalPng),
        );

        for (const size of APP_ICON_SIZES) {
            const sizedPng = await this.#sharp(inputBuffer)
                .resize(size)
                .png()
                .toBuffer();
            writes.push(
                this.#writeIcon(SIZED_ICON_FILENAME(appUid, size), sizedPng),
            );
        }
        await Promise.all(writes);

        // Rewrite the DB icon column from data URL to canonical endpoint URL.
        // The endpoint URL is `/app-icon/<uid>` — the AppController route
        // that falls back to the data URL if S3/CDN lookups miss. Using it
        // here keeps the icon column small and makes clients go through
        // the cached path.
        const apiBase = String(this.config.api_base_url ?? '').replace(
            /\/+$/,
            '',
        );
        if (apiBase) {
            await this.clients.db.write(
                "UPDATE `apps` SET `icon` = ? WHERE `uid` = ? AND `icon` LIKE 'data:%'",
                [`${apiBase}/app-icon/${appUid}`, appUid],
            );
            await this.stores.app.invalidateByUid(appUid);
            this.clients.event.emit(
                'app.changed',
                {
                    app_uid: appUid,
                    action: 'icon-migrated',
                },
                {},
            );
        }
    }

    async #writeIcon(filename: string, buffer: Buffer): Promise<void> {
        if (!this.#ownerUserId) return;
        // The system user's allowance isn't sized for every app's icons.
        await this.services.fs.write(
            this.#ownerUserId,
            {
                fileMetadata: {
                    path: `${APP_ICONS_PATH_PREFIX}/${filename}`,
                    size: buffer.length,
                    contentType: 'image/png',
                    overwrite: true,
                    createMissingParents: true,
                },
                fileContent: Readable.from(buffer),
            },
            undefined,
            UNLIMITED_STORAGE_ALLOWANCE,
        );
    }
}
