import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { extension, extensionStore } from '../../extensions.js';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

describe('RecommendedAppsService', () => {
    let server: PuterServer;
    let customApp: Record<string, unknown>;
    let defaults: Array<Record<string, unknown>>;
    const previousListeners = extensionStore.events['app.recommended'];

    beforeAll(async () => {
        server = await setupTestServer();
        const user = await server.stores.user.create({
            username: 'recommendations-test',
            uuid: randomUUID(),
            password: null,
            email: 'recommendations@test.local',
            free_storage: 1024,
            requires_email_confirmation: false,
        });
        for (const name of ['editor', 'camera', 'custom-recommendation']) {
            if (!(await server.stores.app.getByName(name))) {
                await server.stores.app.create(
                    {
                        name,
                        title: name,
                        index_url: `https://${name}.example.com/`,
                    },
                    { ownerUserId: user.id },
                );
            }
        }
        customApp = await server.stores.app.getByName('custom-recommendation');
        defaults = await server.services.recommendedApps.getRecommendedApps();
    });

    afterEach(() => {
        if (previousListeners) {
            extensionStore.events['app.recommended'] = previousListeners;
        } else {
            delete extensionStore.events['app.recommended'];
        }
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('preserves default ordering without listeners', async () => {
        const apps = await server.services.recommendedApps.getRecommendedApps();
        expect(apps).toEqual(defaults);
        const names = apps.map((app) => app.name);
        expect(names).toContain('editor');
        expect(names.indexOf('editor')).toBeLessThan(names.indexOf('camera'));
        expect(names).not.toContain(customApp.name);
    });

    it('awaits extensions that replace the list and skips missing apps', async () => {
        extension.on('app.recommended', async (_key, data) => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            data.appNames = [
                'camera',
                'custom-recommendation',
                'missing-recommendation',
                'editor',
            ];
        });

        const apps = await server.services.recommendedApps.getRecommendedApps();
        expect(apps.map((app) => app.name)).toEqual([
            'camera',
            'custom-recommendation',
            'editor',
        ]);
        expect(apps[1]).toMatchObject({
            uuid: customApp.uid,
            title: customApp.title,
            index_url: customApp.index_url,
            godmode: false,
            maximize_on_start: false,
            feedback_enabled: false,
            external: false,
        });
    });

    it('isolates in-place mutations from subsequent calls', async () => {
        let calls = 0;
        extension.on('app.recommended', (_key, data) => {
            if (calls++ === 0) {
                data.appNames.splice(
                    0,
                    data.appNames.length,
                    'custom-recommendation',
                );
            }
        });

        const apps = await server.services.recommendedApps.getRecommendedApps();
        expect(apps.map((app) => app.name)).toEqual(['custom-recommendation']);
        expect(
            await server.services.recommendedApps.getRecommendedApps(),
        ).toEqual(defaults);
    });

    it('allows extensions to clear the list', async () => {
        extension.on('app.recommended', (_key, data) => {
            data.appNames = [];
        });

        expect(
            await server.services.recommendedApps.getRecommendedApps(),
        ).toEqual([]);
    });
});
