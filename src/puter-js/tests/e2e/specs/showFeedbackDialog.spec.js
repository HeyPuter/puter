import { test, expect } from '@playwright/test';
import { registerTestApp, deleteTestApp, gotoTestApp, waitForPuterReady, FIXTURE_URL } from '../helpers/testApp.js';

const FEEDBACK_FIXTURE_URL = FIXTURE_URL.replace(
    'menubar-contextmenu.html',
    'send-feedback.html',
);

/** Flips the app's opt-in flag through the same path developers use. */
async function setFeedbackEnabled (page, appName, enabled) {
    await page.goto('/');
    await waitForPuterReady(page);
    const result = await page.evaluate(
        async ({ name, value }) => {
            try {
                const app = await window.puter.apps.update(name, { feedbackEnabled: value });
                return { ok: true, feedback_enabled: app.feedback_enabled };
            } catch (e) {
                return { ok: false, error: String(e?.message ?? e) };
            }
        },
        { name: appName, value: enabled },
    );
    if ( ! result.ok ) {
        throw new Error(`apps.update({ feedbackEnabled }) failed: ${result.error}`);
    }
    // The flag round-trips through the driver's client serialization, so a
    // wrong value here means the opt-in never landed and every assertion
    // downstream would test the unavailable pane instead.
    if ( result.feedback_enabled !== enabled ) {
        throw new Error(`feedback_enabled is ${result.feedback_enabled}, expected ${enabled}`);
    }
}

test.describe('puter.ui.showFeedbackDialog (env=app)', () => {
    test('submitting feedback resolves true', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FEEDBACK_FIXTURE_URL });
        try {
            await setFeedbackEnabled(page, appName, true);
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#send-feedback').click();
            const dialog = page.locator('.app-feedback-overlay');
            await expect(dialog).toBeVisible();

            // The form pane only appears after the server-side target check
            // confirms the app opted in; the app is named by its canonical
            // server-known title and unique name (anti-impersonation).
            const form = dialog.locator('.app-feedback-form');
            await expect(form).toBeVisible({ timeout: 15_000 });
            await expect(dialog.locator('.app-feedback-target-name')).toHaveText(appName);

            // Nothing to send until something has been written.
            const sendBtn = dialog.locator('.app-feedback-send-btn');
            await expect(sendBtn).toBeDisabled();
            await dialog.locator('.app-feedback-message').fill('The new editor is great!');
            await expect(sendBtn).toBeEnabled();

            await sendBtn.click();
            await expect(dialog.locator('.app-feedback-success')).toBeVisible();
            await expect(appFrame.locator('#log [data-entry="feedback:true"]')).toBeVisible();
            // The dialog closes itself shortly after the success pane.
            await expect(dialog).toBeHidden({ timeout: 10_000 });
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('cancel resolves false', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FEEDBACK_FIXTURE_URL });
        try {
            await setFeedbackEnabled(page, appName, true);
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#send-feedback').click();
            const dialog = page.locator('.app-feedback-overlay');
            await expect(dialog.locator('.app-feedback-form')).toBeVisible({ timeout: 15_000 });
            await dialog.locator('.app-feedback-cancel-btn').click();

            await expect(appFrame.locator('#log [data-entry="feedback:false"]')).toBeVisible();
            await expect(dialog).toBeHidden();
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('an app that has not opted in gets the unavailable notice', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FEEDBACK_FIXTURE_URL });
        try {
            const appFrame = await gotoTestApp(page, appName);

            await appFrame.locator('#send-feedback').click();
            const dialog = page.locator('.app-feedback-overlay');
            await expect(dialog.locator('.app-feedback-unavailable')).toBeVisible({ timeout: 15_000 });
            // No form to type into — feedback is strictly opt-in.
            await expect(dialog.locator('.app-feedback-form')).toBeHidden();
            await dialog.locator('.app-feedback-close-btn').click();

            await expect(appFrame.locator('#log [data-entry="feedback:false"]')).toBeVisible();
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});

test.describe('puter.ui.showFeedbackDialog (env=gui)', () => {
    test('resolves false on the Puter desktop itself', async ({ page }) => {
        await page.goto('/');
        await waitForPuterReady(page);
        const sent = await page.evaluate(() => window.puter.ui.showFeedbackDialog());
        expect(sent).toBe(false);
    });
});

test.describe('dashboard app-drawer feedback control', () => {
    test('opted-in app shows a feedback control in the drawer that opens the dialog', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FEEDBACK_FIXTURE_URL });
        try {
            await setFeedbackEnabled(page, appName, true);

            // Open the app on the /app/<name> route — dashboard mode, where
            // the app window wears the top-edge drawer instead of a titlebar.
            await page.goto(`/app/${appName}`);
            const drawer = page.locator('.window-app .dashboard-app-drawer');
            await expect(drawer).toBeAttached({ timeout: 60_000 });

            // The drawer opens on hover; the control lives inside it.
            await drawer.hover();
            const feedbackBtn = drawer.locator('.dashboard-app-drawer-feedback');
            await expect(feedbackBtn).toBeVisible();
            await feedbackBtn.click();

            // It opens the same dialog, targeting this app.
            const dialog = page.locator('.app-feedback-overlay');
            await expect(dialog.locator('.app-feedback-form')).toBeVisible({ timeout: 15_000 });
            await expect(dialog.locator('.app-feedback-target-name')).toHaveText(appName);
        } finally {
            await deleteTestApp(page, appName);
        }
    });

    test('an app that has not opted in shows no feedback control', async ({ page }) => {
        const appName = await registerTestApp(page, { fixtureURL: FEEDBACK_FIXTURE_URL });
        try {
            await page.goto(`/app/${appName}`);
            const drawer = page.locator('.window-app .dashboard-app-drawer');
            await expect(drawer).toBeAttached({ timeout: 60_000 });
            await drawer.hover();
            // The control is only rendered for opted-in apps.
            await expect(drawer.locator('.dashboard-app-drawer-feedback')).toHaveCount(0);
        } finally {
            await deleteTestApp(page, appName);
        }
    });
});

test.describe('puter.ui.showFeedbackDialog (env=web popup)', () => {
    test('popup hosts the dialog, reports false on close, and never hands the opener a token', async ({ page }) => {
        // Prime the GUI session (storageState sign-in) so the popup is authed.
        await page.goto('/');
        await page.waitForFunction(() => !!window.puter?.authToken, null, { timeout: 60_000 });

        // Load the fixture directly (env=web, third-party origin, signed out).
        await page.goto(FEEDBACK_FIXTURE_URL);
        await page.locator('body.ready').waitFor({ timeout: 60_000 });

        const [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#send-feedback').click(),
        ]);

        // The popup renders the feedback dialog for whichever app the
        // browser-attested opener origin resolves to. On a shared dev DB
        // that app is not deterministic, so this asserts the dialog shell
        // rather than a specific pane.
        const dialog = popup.locator('.app-feedback-overlay');
        await expect(dialog).toBeVisible({ timeout: 60_000 });

        // Closing the popup without submitting reports a dismissal.
        await popup.close();
        await expect(page.locator('#log [data-entry="feedback:false"]')).toBeVisible({ timeout: 15_000 });

        // send-feedback is a NON_AUTH popup action: hosting the dialog must
        // not have signed the site in as a side effect.
        const authToken = await page.evaluate(() => window.puter.authToken ?? null);
        expect(authToken).toBeNull();
    });
});
