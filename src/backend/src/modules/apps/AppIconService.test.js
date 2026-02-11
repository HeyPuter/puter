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
            const domain = config.static_hosting_domain;

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
    });

    describe('createAppIcons', () => {
        it('stores original and resized icons in /system/app_icons for data URLs', async () => {
            const sudo = vi.fn(async callback => await callback());
            const dirAppIcons = {};
            const originalIconsDir = {};

            const service = Object.create(AppIconService.prototype);
            service.services = {
                get: vi.fn(name => (name === 'su' ? { sudo } : null)),
            };
            service.errors = { report: vi.fn() };
            service.getAppIcons = vi.fn().mockResolvedValue(dirAppIcons);
            service.getOriginalIconsDir = vi.fn().mockResolvedValue(originalIconsDir);
            service.getOriginalIconUrl = vi.fn().mockReturnValue('https://puter-app-icons.site.puter.localhost/original/app-abc.png');
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
                destination_or_parent: originalIconsDir,
                filename: 'app-abc.png',
            }));
            expect(service.writePngToDir).toHaveBeenCalledWith(expect.objectContaining({
                destination_or_parent: dirAppIcons,
                filename: 'app-abc-64.png',
            }));
            expect(data.url).toBe('https://puter-app-icons.site.puter.localhost/original/app-abc.png');
        });
    });

    describe('getIconStream', () => {
        const createServiceInstance = () => new AppIconService({
            services: { get: vi.fn() },
            config: {},
            name: 'app-icon',
            args: {},
        });

        it('redirects to puter-app-icons subsite sized file when requested size exists', async () => {
            const legacyNode = {
                exists: vi.fn().mockResolvedValue(true),
            };
            const legacyRoot = {
                getChild: vi.fn().mockResolvedValue(legacyNode),
            };

            const service = createServiceInstance();
            service.errors = { report: vi.fn() };
            service.getAppIcons = vi.fn().mockResolvedValue(legacyRoot);
            service.getSizedIconUrl = vi.fn().mockReturnValue('https://puter-app-icons.site.puter.localhost/app-abc-64.png');

            const result = await service.getIconStream({
                appUid: 'app-abc',
                size: 64,
                allowRedirect: true,
            });

            expect(result.redirectUrl).toBe('https://puter-app-icons.site.puter.localhost/app-abc-64.png');
            expect(result.redirectCacheControl).toContain('max-age=2592000');
        });

        it('redirects to original and queues resize when requested size is missing', async () => {
            const legacyNode = {
                exists: vi.fn().mockResolvedValue(false),
            };
            const legacyRoot = {
                getChild: vi.fn().mockResolvedValue(legacyNode),
            };
            const originalNode = {
                exists: vi.fn().mockResolvedValue(true),
            };
            const originalDir = {
                getChild: vi.fn().mockResolvedValue(originalNode),
            };

            const service = createServiceInstance();
            service.errors = { report: vi.fn() };
            service.getAppIcons = vi.fn().mockResolvedValue(legacyRoot);
            service.getOriginalIconsDir = vi.fn().mockResolvedValue(originalDir);
            service.getOriginalIconUrl = vi.fn().mockReturnValue('https://puter-app-icons.site.puter.localhost/original/app-abc.png');
            service.queueMissingSizeFromOriginal = vi.fn();

            const result = await service.getIconStream({
                appUid: 'app-abc',
                size: 128,
                allowRedirect: true,
            });

            expect(result.redirectUrl).toBe('https://puter-app-icons.site.puter.localhost/original/app-abc.png');
            expect(result.redirectCacheControl).toContain('max-age=604800');
            expect(service.queueMissingSizeFromOriginal).toHaveBeenCalledWith({
                appUid: 'app-abc',
                size: 128,
            });
        });

        it('redirects to app icon URL when no cached icon exists and URL is eligible', async () => {
            const redirectUrl = `https://dev-center-app-id.${config.static_hosting_domain}/raw-icon.png`;

            const legacyNode = {
                exists: vi.fn().mockResolvedValue(false),
            };
            const legacyRoot = {
                getChild: vi.fn().mockResolvedValue(legacyNode),
            };

            const service = createServiceInstance();
            service.errors = { report: vi.fn() };
            service.getAppIcons = vi.fn().mockResolvedValue(legacyRoot);
            service.getOriginalIconsDir = vi.fn().mockResolvedValue(null);

            const result = await service.getIconStream({
                appUid: 'app-abc',
                appIcon: redirectUrl,
                size: 256,
                allowRedirect: true,
            });

            expect(result.redirectUrl).toBe(redirectUrl);
        });
    });
});
