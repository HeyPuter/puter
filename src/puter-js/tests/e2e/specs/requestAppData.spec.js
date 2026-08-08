import { test, expect } from '@playwright/test';
import {
    registerTestApp,
    registerTargetApp,
    deleteTestApp,
    gotoTestApp,
    FIXTURE_URL,
} from '../helpers/testApp.js';

const PERMISSION_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'request-permission.html',
);

const DIALOG = 'dialog.perm-dialog';
const ROW = '.perm-dialog-permission';

/**
 * Kick off a `requestAppData` call inside the app without awaiting it, so the
 * test can act on the dialog it raises. Resolve with `settle()`.
 */
async function ask (appFrame, target, scopes) {
    await appFrame.locator('body').evaluate(
        (_el, { target: t, scopes: s }) => {
            window.__appData = puter.perms.requestAppData(t, s).then(
                v => ({ ok: true, value: v }),
                e => ({ ok: false, error: String(e?.message ?? e) }),
            );
        },
        { target, scopes },
    );
}

const settle = (appFrame) =>
    appFrame.locator('body').evaluate(() => window.__appData);

/** Run a KV call in the app against the target's namespace. */
const kv = (appFrame, target, method, args = {}) =>
    appFrame.locator('body').evaluate(
        async (_el, { target: t, method: m, args: a }) => {
            try {
                const res = await puter.kv[m]({
                    ...a,
                    optConfig: { appUuid: t },
                });
                return { ok: true, res };
            } catch (e) {
                return { ok: false, error: String(e?.message ?? e) };
            }
        },
        { target, method, args },
    );

test.describe('puter.perms.requestAppData (env=app)', () => {
    test('deny then allow, and the grant reaches the target namespace', async ({
        page,
    }) => {
        const target = await registerTargetApp(page, {
            title: 'Contacts',
            seed: {
                birthday: { value: 'March 3' },
                phone: { value: '555-0101' },
                oauthToken: { value: 'SECRET', private: true },
            },
        });
        const appName = await registerTestApp(page, {
            fixtureURL: PERMISSION_FIXTURE_URL,
        });
        try {
            const appFrame = await gotoTestApp(page, appName);
            const dialog = page.locator(DIALOG);

            // -- the prompt itself --
            await ask(appFrame, target.uid, { kv: ['get', 'list'] });
            await expect(dialog).toBeVisible();
            // Names the requesting app and the *target*, by title rather than uid.
            await expect(dialog.locator('.perm-dialog-entity-name')).toContainText(
                appName,
            );
            await expect(dialog).toContainText('Contacts');
            await expect(dialog.locator(ROW)).toHaveCount(1);
            // Encoded exactly once: `i18n()` encodes the whole interpolated
            // string, so composing two calls renders a literal `&#39;` here.
            await expect(dialog).toContainText("'s saved data");
            await expect(dialog).not.toContainText('&#39;');

            // -- deny --
            await dialog.locator('.perm-dialog-deny').click();
            expect(await settle(appFrame)).toEqual({ ok: true, value: false });
            await expect(dialog).toBeHidden();

            // -- allow --
            await ask(appFrame, target.uid, { kv: ['get', 'list'] });
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();
            expect(await settle(appFrame)).toEqual({ ok: true, value: true });

            // -- the grant works, and per-entry privacy holds under it --
            expect(await kv(appFrame, target.uid, 'get', { key: 'birthday' }))
                .toEqual({ ok: true, res: 'March 3' });
            // Private entries read as absent, not as a refusal.
            expect(await kv(appFrame, target.uid, 'get', { key: 'oauthToken' }))
                .toEqual({ ok: true, res: null });
            const listed = await kv(appFrame, target.uid, 'list', { as: 'keys' });
            expect(listed.res).toContain('birthday');
            expect(listed.res).not.toContain('oauthToken');

            // -- a repeat request prompts again --
            // `requestAppData` does not consult existing grants before
            // prompting, unlike `requestEmail` (checks whoami) and the folder
            // helpers (stat first). Pinned as current behaviour: an app calling
            // this on every launch re-asks the user.
            await ask(appFrame, target.uid, { kv: ['get'] });
            await expect(dialog).toBeVisible();
            await dialog.locator('.perm-dialog-allow').click();
            expect(await settle(appFrame)).toEqual({ ok: true, value: true });
        } finally {
            await deleteTestApp(page, appName);
            await deleteTestApp(page, target.name);
        }
    });

    test('one row per scope, and the wording matches the scope', async ({
        page,
    }) => {
        const target = await registerTargetApp(page, { title: 'Contacts' });
        const appName = await registerTestApp(page, {
            fixtureURL: PERMISSION_FIXTURE_URL,
        });
        try {
            const appFrame = await gotoTestApp(page, appName);
            const dialog = page.locator(DIALOG);

            // Both stores in one decision.
            await ask(appFrame, target.uid, 'read');
            await expect(dialog.locator(ROW)).toHaveCount(2);
            await expect(dialog).toContainText('saved data');
            await expect(dialog).toContainText('files');
            await dialog.locator('.perm-dialog-deny').click();
            await settle(appFrame);

            // A delete scope must say so — "change" would misdescribe it.
            await ask(appFrame, target.uid, { kv: ['del'] });
            await expect(dialog).toContainText('delete');
            await dialog.locator('.perm-dialog-deny').click();
            await settle(appFrame);

            // `write` satisfies a read check via the exploder, so its wording
            // names reading too.
            await ask(appFrame, target.uid, { kv: ['set'] });
            await expect(dialog).toContainText('read and change');
            await dialog.locator('.perm-dialog-deny').click();
            await settle(appFrame);

            // Every class of a store collapses to one store-wide row, which
            // covers deletion by prefix implication and must say so.
            await ask(appFrame, target.uid, { kv: ['read', 'write', 'delete'] });
            await expect(dialog.locator(ROW)).toHaveCount(1);
            await expect(dialog).toContainText('delete');
            await dialog.locator('.perm-dialog-deny').click();
            await settle(appFrame);
        } finally {
            await deleteTestApp(page, appName);
            await deleteTestApp(page, target.name);
        }
    });

    test('deleting an entry needs its own scope', async ({ page }) => {
        const target = await registerTargetApp(page, {
            title: 'Contacts',
            seed: { phone: { value: '555-0101' } },
        });
        const appName = await registerTestApp(page, {
            fixtureURL: PERMISSION_FIXTURE_URL,
        });
        try {
            const appFrame = await gotoTestApp(page, appName);
            const dialog = page.locator(DIALOG);

            await ask(appFrame, target.uid, { kv: ['get', 'list'] });
            await dialog.locator('.perm-dialog-allow').click();
            await settle(appFrame);

            const refused = await kv(appFrame, target.uid, 'del', {
                key: 'phone',
            });
            expect(refused.ok).toBe(false);

            await ask(appFrame, target.uid, { kv: ['del'] });
            await dialog.locator('.perm-dialog-allow').click();
            await settle(appFrame);

            expect((await kv(appFrame, target.uid, 'del', { key: 'phone' })).ok)
                .toBe(true);
        } finally {
            await deleteTestApp(page, appName);
            await deleteTestApp(page, target.name);
        }
    });

    test('requests that must never prompt resolve without a dialog', async ({
        page,
    }) => {
        const target = await registerTargetApp(page, { title: 'Contacts' });
        const appName = await registerTestApp(page, {
            fixtureURL: PERMISSION_FIXTURE_URL,
        });
        try {
            const appFrame = await gotoTestApp(page, appName);

            // Its own data: already implicit, so approving it would mean nothing.
            await appFrame.locator('body').evaluate(() => {
                window.__appData = puter.perms
                    .requestAppData(puter.appID, 'read')
                    .then(v => ({ ok: true, value: v }));
            });
            expect(await settle(appFrame)).toEqual({ ok: true, value: true });
            await expect(page.locator(DIALOG)).toHaveCount(0);

            // Over the transport cap. Asserted through `requestPermission`
            // rather than `requestAppData`: the scope vocabulary has only 14
            // names and complete classes collapse, so the SDK helper can never
            // produce a list this long. The cap protects the transport.
            const overCap = await appFrame.locator('body').evaluate((_el, t) =>
                puter.ui.requestPermission({
                    permissions: Array.from(
                        { length: 17 },
                        (_x, i) => `app-data:${t}:kv:get${i}`,
                    ),
                }),
            target.uid);
            expect(overCap).toBe(false);
            await expect(page.locator(DIALOG)).toHaveCount(0);

            // Target opted out of sharing: no prompt, and the grant would 403.
            await page.evaluate(async (name) => {
                await window.puter.apps.update(name, {
                    metadata: { share_app_data: false },
                });
            }, target.name);
            const appFrame2 = await gotoTestApp(page, appName);
            await ask(appFrame2, target.uid, { kv: ['get'] });
            expect(await settle(appFrame2)).toEqual({ ok: true, value: false });
            await expect(page.locator(DIALOG)).toHaveCount(0);
        } finally {
            await deleteTestApp(page, appName);
            await deleteTestApp(page, target.name);
        }
    });

    test('invalid scopes are refused in the SDK before any prompt', async ({
        page,
    }) => {
        const target = await registerTargetApp(page, { title: 'Contacts' });
        const appName = await registerTestApp(page, {
            fixtureURL: PERMISSION_FIXTURE_URL,
        });
        try {
            const appFrame = await gotoTestApp(page, appName);

            const outcomes = await appFrame.locator('body').evaluate(
                async (_el, t) => {
                    const attempt = (scopes, id) =>
                        puter.perms.requestAppData(t, scopes).then(
                            v => `${id}:resolved:${v}`,
                            e => `${id}:rejected`,
                        );
                    return Promise.all([
                        // Emptying a whole namespace is not grantable.
                        attempt({ kv: ['flush'] }, 'flush'),
                        // `out['toString']` is truthy, so a truthiness guard
                        // would throw a TypeError instead of a clean error.
                        attempt(['toString:read'], 'proto'),
                        attempt({ kv: ['nope'] }, 'unknown'),
                        attempt({}, 'empty'),
                    ]);
                },
                target.uid,
            );

            expect(outcomes).toEqual([
                'flush:rejected',
                'proto:rejected',
                'unknown:rejected',
                'empty:rejected',
            ]);
            await expect(page.locator(DIALOG)).toHaveCount(0);
        } finally {
            await deleteTestApp(page, appName);
            await deleteTestApp(page, target.name);
        }
    });
});
