import type { Request, RequestHandler, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { LegacyFSController } from './LegacyFSController.js';

const PNG_2X2 =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=';

let server: PuterServer;
let handler: RequestHandler;
type Driver = {
    create: (a: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

beforeAll(async () => {
    server = await setupTestServer({
        api_base_url: 'http://api.test.local',
        static_hosting_domain: 'site.test',
    } as unknown as Parameters<typeof setupTestServer>[0]);
    await server.services.appIcon.ensureIconsDirectory();
    const controller = server.controllers
        .legacyFs as unknown as LegacyFSController;
    const router = new PuterRouter();
    controller.registerRoutes(router);
    handler = router.routes.find(
        (r) =>
            r.path === '/get-launch-apps' &&
            String(r.method).toLowerCase() === 'get',
    )!.handler as RequestHandler;
}, 60_000);

afterAll(async () => {
    await server?.shutdown();
});

const makeActor = async (): Promise<{ actor: Actor; id: number }> => {
    const username = `v13-${Math.random().toString(36).slice(2, 10)}`;
    const u = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    const r = (await server.stores.user.getById(u.id))!;
    return {
        id: r.id,
        actor: {
            user: {
                id: r.id,
                uuid: r.uuid,
                username: r.username,
                email: r.email ?? null,
                email_confirmed: true,
            },
        } as unknown as Actor,
    };
};

const createViaDriver = async (actor: Actor, icon: string) =>
    runWithContext({ actor }, () =>
        (server.drivers.apps as unknown as Driver).create({
            object: {
                name: `v13-${Math.random().toString(36).slice(2, 10)}`,
                title: 'V',
                index_url: `https://v13-${Math.random().toString(36).slice(2, 10)}.test/`,
                icon,
            },
        }),
    );

const launchApps = async (actor: Actor, appUid: string, userId: number) => {
    await server.clients.db.write(
        'INSERT INTO `app_opens` (`app_uid`, `user_id`, `ts`) VALUES (?, ?, ?)',
        [appUid, userId, Math.floor(Date.now() / 1000)],
    );
    let body: { recent: Array<Record<string, unknown>> } | undefined;
    const res = {
        json: (v: unknown) => {
            body = v as typeof body;
            return res;
        },
        status: () => res,
        setHeader: () => res,
    } as unknown as Response;
    await handler(
        {
            query: { icon_size: '64' },
            headers: {},
            body: {},
            actor,
        } as unknown as Request,
        res,
        () => {},
    );
    return body!.recent.find((e) => e.uuid === appUid)!;
};

describe('/get-launch-apps recent icon, verified', () => {
    it('a valid data-URL icon written through the driver is migrated to a short URL', async () => {
        const { actor, id } = await makeActor();
        const app = await createViaDriver(
            actor,
            `data:image/png;base64,${PNG_2X2}`,
        );
        await vi.waitFor(
            async () => {
                const row = await server.stores.app.getByUid(app.uid as string);
                expect(String(row?.icon).slice(0, 80)).toMatch(
                    /^https?:\/\/.*\/app-icon\/app-/,
                );
            },
            { timeout: 10_000 },
        );
        const entry = await launchApps(actor, app.uid as string, id);
        expect(String(entry.icon).length).toBeLessThan(200);
        expect(entry.iconCdnUrl).toMatch(/-64\.png$/);
    }, 30_000);

    it('returns an icon endpoint when migration cannot decode the stored icon', async () => {
        const { actor, id } = await makeActor();
        // PNG signature passes the write-path sniff; sharp rejects the rest.
        const corrupt = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.alloc(1024 * 1024, 0x41),
        ]).toString('base64');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let app: Record<string, unknown>;
        try {
            app = await createViaDriver(
                actor,
                `data:image/png;base64,${corrupt}`,
            );
            // Give the background pipeline time to try and fail.
            await vi.waitFor(
                () =>
                    expect(
                        warn.mock.calls.some(
                            ([m]) => m === '[app-icon] icon processing failed',
                        ),
                    ).toBe(true),
                { timeout: 10_000 },
            );
        } finally {
            warn.mockRestore();
        }
        const row = await server.stores.app.getByUid(app!.uid as string);
        expect(String(row?.icon).startsWith('data:image/png')).toBe(true);
        const entry = await launchApps(actor, app!.uid as string, id);
        expect(entry.icon).toBe(
            `http://api.test.local/app-icon/${app!.uid}/64`,
        );
    }, 30_000);
});
