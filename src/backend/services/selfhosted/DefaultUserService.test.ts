import bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer({
        no_default_user: false,
    } as never);
});

afterAll(async () => {
    await server.shutdown();
});

describe('DefaultUserService — bootstrap admin credentials', () => {
    it('stashes the bootstrap password so rotation can be detected', async () => {
        const admin = await server.stores.user.getByUsername('admin');
        expect(admin).toBeTruthy();

        const stashed = admin?.metadata?.tmp_password;
        expect(typeof stashed).toBe('string');
        expect(
            await bcrypt.compare(String(stashed), String(admin?.password)),
        ).toBe(true);
    });

    it('drops the plaintext stash once the password is rotated', async () => {
        const admin = await server.stores.user.getByUsername('admin');
        expect(admin).toBeTruthy();
        await server.stores.user.update(admin!.id, {
            password: await bcrypt.hash('rotated-password', 8),
        });

        // Simulate the next boot.
        await server.services.defaultUser.onServerStart();

        const fresh = await server.stores.user.getByUsername('admin');
        expect(fresh?.metadata?.tmp_password ?? null).toBeNull();
    });
});
