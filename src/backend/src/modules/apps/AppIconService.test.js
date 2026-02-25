import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import config from '../../config.js';
import { AppIconService } from './AppIconService.js';

describe('AppIconService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('URL helpers', () => {
        it('extracts a puter subdomain from a static hosting URL', () => {
            const service = Object.create(AppIconService.prototype);
            const domain = 'site.puter.localhost:4100';

            const result = service.extractPuterSubdomainFromUrl(`https://dev-center-app-id.${domain}/icon.png`);

            expect(result).toBe('dev-center-app-id');
        });

        it('does not redirect when URL is the same app-icon endpoint request', () => {
            const service = Object.create(AppIconService.prototype);

            const shouldRedirect = service.shouldRedirectIconUrl({
                iconUrl: 'https://api.puter.localhost/app-icon/app-123/64',
                appUid: 'app-123',
                size: 64,
            });

            expect(shouldRedirect).toBe(false);
        });

        it('parses app-icon endpoint URLs without size as default size 128', () => {
            const service = Object.create(AppIconService.prototype);

            const parsed = service.parseAppIconEndpointUrl('https://api.puter.localhost/app-icon/app-123');

            expect(parsed).toEqual({
                appUid: 'app-123',
                size: 128,
            });
        });

        it('normalizes raw base64 icon strings to png data URLs', () => {
            const service = Object.create(AppIconService.prototype);
            const rawBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

            const result = service.normalizeRawBase64ImageString(rawBase64);

            expect(result).toBe(`data:image/png;base64,${rawBase64}`);
        });
    });

    describe('createAppIcons', () => {
        it('stores original and resized icons in /system/app_icons for data URLs', async () => {
            const sudo = vi.fn(async callback => await callback());
            const dirAppIcons = {
                exists: vi.fn().mockResolvedValue(true),
            };

            const service = Object.create(AppIconService.prototype);
            service.services = {
                get: vi.fn(name => (name === 'su' ? { sudo } : null)),
            };
            service.errors = { report: vi.fn() };
            service.ensureAppIconsDirectory = vi.fn().mockResolvedValue(dirAppIcons);
            service.getAppIconEndpointUrl = vi.fn().mockReturnValue('https://api.puter.localhost/app-icon/app-abc');
            service.loadIconSource = vi.fn().mockResolvedValue({
                metadata: 'data:image/png;base64',
                input: Buffer.from([1, 2, 3]),
            });
            service.writePngToDir = vi.fn().mockResolvedValue(undefined);
            service.getSharp = vi.fn(() => ({
                clone: vi.fn(() => ({
                    resize: vi.fn().mockReturnThis(),
                    png: vi.fn().mockReturnThis(),
                    toBuffer: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
                })),
            }));

            const data = {
                appUid: 'app-abc',
                dataUrl: 'data:image/png;base64,AA==',
            };

            await service.createAppIcons({ data });

            expect(service.writePngToDir).toHaveBeenCalledTimes(AppIconService.ICON_SIZES.length + 1);
            expect(service.writePngToDir).toHaveBeenCalledWith(expect.objectContaining({
                destination_or_parent: dirAppIcons,
                filename: 'app-abc.png',
            }));
            expect(service.writePngToDir).toHaveBeenCalledWith(expect.objectContaining({
                destination_or_parent: dirAppIcons,
                filename: 'app-abc-64.png',
            }));
            expect(data.url).toBe('https://api.puter.localhost/app-icon/app-abc');
        });

        it('queueDataUrlIconWrite persists migrated URL to DB when conversion succeeds', async () => {
            const service = Object.create(AppIconService.prototype);
            service.errors = { report: vi.fn() };
            service.createAppIcons = vi.fn(async ({ data }) => {
                data.url = 'https://api.puter.localhost/app-icon/app-abc';
            });
            service.persistConvertedIconUrl = vi.fn().mockResolvedValue(undefined);

            service.queueDataUrlIconWrite({
                appUid: 'app-abc',
                dataUrl: 'data:image/png;base64,AA==',
            });

            await Promise.resolve();
            await Promise.resolve();

            expect(service.createAppIcons).toHaveBeenCalledTimes(1);
            expect(service.persistConvertedIconUrl).toHaveBeenCalledWith({
                appUid: 'app-abc',
                iconUrl: 'https://api.puter.localhost/app-icon/app-abc',
            });
        });
    });

    describe('icon URL mapping', () => {
        it('builds a legacy app-icon path with normalized app uid', () => {
            const service = Object.create(AppIconService.prototype);

            const result = service.getAppIconPath({
                appUid: 'abc',
                size: 64,
            });

            expect(result).toBe(`${config.api_base_url}/app-icon/app-abc/64`);
        });

        it('defaults to size 128 when size is not provided', () => {
            const service = Object.create(AppIconService.prototype);

            const result = service.getAppIconPath({
                appUid: 'abc',
            });

            expect(result).toBe(`${config.api_base_url}/app-icon/app-abc/128`);
        });

        it('iconifyApps rewrites icons to the legacy app-icon endpoint path', async () => {
            const service = Object.create(AppIconService.prototype);
            const apps = [
                { uid: 'app-abc', icon: 'data:image/png;base64,AA==' },
                { uuid: 'def', icon: 'https://example.com/icon.png' },
            ];

            const result = await service.iconifyApps({
                apps,
                size: 128,
            });

            expect(result[0].icon).toBe(`${config.api_base_url}/app-icon/app-abc/128`);
            expect(result[1].icon).toBe(`${config.api_base_url}/app-icon/app-def/128`);
        });

        it('iconifyApps leaves icon unchanged when app uid is missing', async () => {
            const service = Object.create(AppIconService.prototype);
            const apps = [{ icon: 'existing-icon' }];

            const result = await service.iconifyApps({
                apps,
                size: 128,
            });

            expect(result[0].icon).toBe('existing-icon');
        });
    });
});
