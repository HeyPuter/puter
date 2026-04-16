import { PuterService } from '../types.js';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

const ICON_SIZES = [16, 32, 64, 128, 256, 512] as const;

/**
 * App icon generation service — listens for `app.new-icon` events,
 * resizes icons via sharp, and uploads sized PNGs to S3.
 *
 * The `/app-icon/:uid/:size` route (in AppController) serves the
 * generated icons. When an icon hasn't been generated yet it falls
 * back to decoding the data URL from the DB column.
 *
 * Config:
 *   config.s3_bucket        — bucket for icon storage
 *   config.s3_region        — region
 *   config.api_base_url     — used to build icon URLs
 */
export class AppIconService extends PuterService {

    #sharp: typeof import('sharp') | null = null;

    override async onServerStart (): Promise<void> {
        // Try loading sharp — it's optional; without it icons are served raw
        try {
            this.#sharp = (await import('sharp')).default;
        } catch {
            console.warn('[app-icon] sharp not available — icon resizing disabled');
        }

        // Listen for new/changed app icons
        this.clients.event.on('app.new-icon', async (_key: string, data: unknown) => {
            try {
                await this.#processIcon(data as Record<string, unknown>);
            } catch ( err ) {
                console.warn('[app-icon] icon processing failed', err);
            }
        });

        // Also listen for app creation/updates that include icons
        this.clients.event.on('app.changed', async (_key: string, data: unknown) => {
            const d = data as Record<string, unknown> | undefined;
            if ( d?.action === 'icon-migrated' ) return; // avoid loop
            if ( ! d?.app_uid ) return;
            const app = await this.stores.app.getByUid(String(d.app_uid));
            if ( ! app ) return;
            const icon = (app as Record<string, unknown>).icon as string | undefined;
            if ( icon?.startsWith('data:') ) {
                await this.#processIcon({
                    app_uid: d.app_uid,
                    data_url: icon,
                });
            }
        });
    }

    async #processIcon (data: Record<string, unknown>): Promise<void> {
        const dataUrl = (data.dataUrl ?? data.data_url) as string | undefined;
        let appUid = (data.appUid ?? data.app_uid) as string | undefined;
        if ( !dataUrl || !appUid ) return;
        if ( ! appUid.startsWith('app-') ) appUid = `app-${appUid}`;

        // Parse the data URL
        const commaIdx = dataUrl.indexOf(',');
        if ( commaIdx === -1 ) return;
        const meta = dataUrl.slice(0, commaIdx);
        const inputBuffer = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
        if ( inputBuffer.length === 0 ) return;

        const bucket = (this.config as unknown as Record<string, unknown>).s3_bucket as string ?? 'puter-local';
        const s3 = this.clients.s3 as unknown as S3Client;

        if ( this.#sharp ) {
            // Upload original
            const originalKey = `app-icons/${appUid}.png`;
            const originalPng = await this.#sharp(inputBuffer).png().toBuffer();
            await s3.send(new PutObjectCommand({
                Bucket: bucket,
                Key: originalKey,
                Body: originalPng,
                ContentType: 'image/png',
            }));

            // Generate sized variants
            for ( const size of ICON_SIZES ) {
                const sizedKey = `app-icons/${appUid}-${size}.png`;
                const sizedPng = await this.#sharp(inputBuffer)
                    .resize(size)
                    .png()
                    .toBuffer();
                await s3.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: sizedKey,
                    Body: sizedPng,
                    ContentType: 'image/png',
                }));
            }

            // Update the app's icon column to point to the endpoint URL
            // so future reads don't serve the data URL
            const apiBase = String((this.config as unknown as Record<string, unknown>).api_base_url ?? '').replace(/\/+$/, '');
            if ( apiBase ) {
                const endpointUrl = `${apiBase}/app-icon/${appUid}`;
                await this.clients.db.write(
                    "UPDATE `apps` SET `icon` = ? WHERE `uid` = ? AND `icon` LIKE 'data:%'",
                    [endpointUrl, appUid],
                );
                // Invalidate app cache
                const app = await this.stores.app.getByUid(appUid);
                if ( app ) {
                    await this.stores.app.invalidateByUid(appUid);
                }

                // Signal that we migrated (so app.changed listener doesn't re-process)
                this.clients.event.emit('app.changed', {
                    app_uid: appUid,
                    action: 'icon-migrated',
                }, {});
            }
        } else {
            // No sharp — just upload the original as-is for the endpoint to serve
            const key = `app-icons/${appUid}.png`;
            await s3.send(new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: inputBuffer,
                ContentType: 'image/png',
            }));
        }
    }
}
