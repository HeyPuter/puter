import { Readable } from 'node:stream';
import type { LayerInstances } from '../../types';
import type { puterServices } from '../index';
import { PuterService } from '../types.js';

const ICON_SIZES = [16, 32, 64, 128, 256, 512] as const;
const APP_ICONS_SUBDOMAIN = 'puter-app-icons';
const APP_ICONS_PATH_PREFIX = '/system/app_icons';

const ORIGINAL_ICON_FILENAME = (uid: string) => `${uid}.png`;
const SIZED_ICON_FILENAME = (uid: string, size: number) => `${uid}-${size}.png`;

/**
 * App icon generation service.
 *
 *   1. On boot: ensures `/system/app_icons/` exists (owned by admin/system user)
 *      and that the `puter-app-icons` subdomain points at it. Icons are then
 *      served through Puter's regular hosting path
 *      (`https://puter-app-icons.<hosting-domain>/<uid>-<size>.png`) —
 *      no custom route, no custom S3 plumbing.
 *   2. On `app.new-icon` event: decodes the data URL, resizes via sharp to
 *      the 6 standard sizes, and writes the PNGs into that directory via
 *      FSEntryService. The write populates the CDN-backed subdomain
 *      automatically because `puter-app-icons` is a regular hosted site.
 *   3. Once the original is persisted, the app's `icon` column is rewritten
 *      from the data URL to the canonical endpoint URL so later reads
 *      don't re-ship the base64 payload.
 */
export class AppIconService extends PuterService {
    declare protected services: LayerInstances<typeof puterServices>;

    #sharp: typeof import('sharp') | null = null;
    #dirReady: Promise<void> | null = null;
    #ownerUserId: number | null = null;

    override async onServerStart(): Promise<void> {
        try {
            this.#sharp = (await import('sharp')).default;
        } catch {
            console.warn(
                '[app-icon] sharp not available — icon resizing disabled',
            );
        }

        this.#dirReady = this.ensureIconsDirectory();

        this.clients.event.on(
            'app.new-icon',
            async (_key: string, data: unknown) => {
                try {
                    await this.#processIcon(data as Record<string, unknown>);
                } catch (err) {
                    console.warn('[app-icon] icon processing failed', err);
                }
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
                    await this.#processIcon({
                        app_uid: d.app_uid,
                        data_url: icon,
                    });
                }
            },
        );
    }

    /** Public: canonical URL for an app's icon at a given size (CDN/subdomain-backed). */
    getIconUrl(appUid: string, size: number): string | null {
        const base = this.#iconsBaseUrl();
        if (!base) return null;
        const normalized = appUid.startsWith('app-') ? appUid : `app-${appUid}`;
        return `${base}/${SIZED_ICON_FILENAME(normalized, size)}`;
    }

    /** Public: URL of the un-resized original PNG (no size suffix) on the subdomain. */
    getOriginalIconUrl(appUid: string): string | null {
        const base = this.#iconsBaseUrl();
        if (!base) return null;
        const normalized = appUid.startsWith('app-') ? appUid : `app-${appUid}`;
        return `${base}/${ORIGINAL_ICON_FILENAME(normalized)}`;
    }

    /**
     * Pick the best subdomain URL to redirect an icon request at. Falls back
     * to the un-resized original when the sized variant hasn't been generated
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
        const cfg = this.config;
        const host = cfg.static_hosting_domain ?? cfg.static_hosting_domain_alt;
        if (!host) return null;
        const protocol = cfg.protocol ?? 'https';
        // Externally-visible port. Mirrors what PuterHomepageService et al.
        // do — non-80/443 deployments (local dev, reverse-proxied setups on
        // non-standard ports) would otherwise get a hostname with no port.
        const pubPort = cfg.pub_port;
        const portSuffix =
            pubPort && pubPort !== 80 && pubPort !== 443 ? `:${pubPort}` : '';
        return `${protocol}://${APP_ICONS_SUBDOMAIN}.${host}${portSuffix}`;
    }

    // ── Bootstrap ───────────────────────────────────────────────────

    /**
     * Public so `DefaultUserService` can call it immediately after it
     * creates the admin user on first boot — otherwise we'd lose the
     * race (AppIconService is registered BEFORE DefaultUserService and
     * its own `onServerStart` runs when no admin exists yet). Idempotent:
     * safe to call repeatedly.
     */
    async ensureIconsDirectory(): Promise<void> {
        // The admin user owns the icons directory. DefaultUserService
        // creates the admin on first boot; if it doesn't exist yet we
        // bail and try again the next time an icon is processed.
        const adminUser = await this.stores.user.getByUsername('admin');
        if (!adminUser) {
            console.warn(
                '[app-icon] admin user not found; deferring icons directory setup',
            );
            return;
        }
        this.#ownerUserId = adminUser.id;

        // Ensure /system/app_icons/ exists.
        const existing = await this.stores.fsEntry.getEntryByPath(
            APP_ICONS_PATH_PREFIX,
        );
        let dirEntry = existing;
        if (!dirEntry) {
            // Write an empty dir by writing a dummy file and removing it
            // isn't great — instead rely on `createMissingParents` when we
            // write the first icon. We still need a directory entry for
            // the subdomain `root_dir_id` though, so create it explicitly
            // via the store's directory helper.
            dirEntry = await this.stores.fsEntry.resolveParentDirectory(
                adminUser.id,
                APP_ICONS_PATH_PREFIX,
                true,
            );
        }

        if (!dirEntry) {
            console.warn('[app-icon] failed to ensure icons directory');
            return;
        }

        // Register the `puter-app-icons` subdomain pointing at that dir.
        // Idempotent: skip if it already exists.
        const already =
            await this.stores.subdomain.existsBySubdomain(APP_ICONS_SUBDOMAIN);
        if (!already) {
            await this.stores.subdomain.create({
                userId: adminUser.id,
                subdomain: APP_ICONS_SUBDOMAIN,
                rootDirId: dirEntry.id ?? null,
            });
        }
    }

    // ── Icon pipeline ───────────────────────────────────────────────

    async #processIcon(data: Record<string, unknown>): Promise<void> {
        if (this.#dirReady) await this.#dirReady;
        if (!this.#ownerUserId) {
            // Retry the bootstrap — admin may have been created in the
            // meantime (e.g. first-boot race).
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

        for (const size of ICON_SIZES) {
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
        await this.services.fsEntry.write(this.#ownerUserId, {
            fileMetadata: {
                path: `${APP_ICONS_PATH_PREFIX}/${filename}`,
                size: buffer.length,
                contentType: 'image/png',
                overwrite: true,
                createMissingParents: true,
            },
            fileContent: Readable.from(buffer),
        });
    }
}
