import { suite } from '../harness/types.ts';

// Charge creation talks to breez.tips, which the in-memory server cannot
// reach, so these cover the settings surface, client-side validation, and
// the read paths. The charge lifecycle is covered by extensions/payments.test.ts.

export default suite('payments', {
    'getSettings defaults to no address and links the Glow setup page': async (t) => {
        const settings = await t.puter.payments.getSettings();
        t.assert.equal(settings.lightningAddress, null);
        t.assert.ok(settings.glowSetupUrl.startsWith('https://'), 'glowSetupUrl should be a URL');
    },

    'updateSettings rejects a non-breez.tips address before reaching the server': async (t) => {
        await t.assert.rejects(
            () => t.puter.payments.updateSettings({ lightningAddress: 'dev@walletofsatoshi.com' }),
            'a foreign address should reject',
        );
    },

    'createCharge rejects a non-integer amount before reaching the server': async (t) => {
        await t.assert.rejects(
            () => t.puter.payments.createCharge({ amountSats: 1.5 }),
            'a fractional amount should reject',
        );
        await t.assert.rejects(
            () => t.puter.payments.createCharge({ amountSats: 0 }),
            'a zero amount should reject',
        );
    },

    'createCharge rejects a bad fiat price before reaching the server': async (t) => {
        // The option type is a union that already forbids these shapes; the
        // cast lets the runtime validation be exercised for JS callers.
        const createCharge = t.puter.payments.createCharge as (o: unknown) => Promise<unknown>;
        await t.assert.rejects(
            () => t.puter.payments.createCharge({ amount: 0, currency: 'USD' }),
            'a zero fiat amount should reject',
        );
        await t.assert.rejects(
            () => createCharge({ amount: 1 }),
            'a fiat amount without a currency should reject',
        );
        await t.assert.rejects(
            () => t.puter.payments.createCharge({ amount: 1, currency: 'dollars' }),
            'a currency that is not a three-letter code should reject',
        );
        await t.assert.rejects(
            () => createCharge({ amountSats: 100, amount: 1, currency: 'USD' }),
            'sats and fiat together should reject',
        );
        await t.assert.rejects(
            () => createCharge({ description: 'no price' }),
            'no price at all should reject',
        );
    },

    'createCharge without a configured address reports how to set one up': async (t) => {
        try {
            await t.puter.payments.createCharge({ amountSats: 100 });
            t.assert.ok(false, 'should have rejected');
        } catch (err) {
            const e = err as { code?: string; glowSetupUrl?: string };
            t.assert.equal(e.code, 'lightning_address_not_configured');
            t.assert.ok(typeof e.glowSetupUrl === 'string', 'error should carry glowSetupUrl');
        }
    },

    'getCharge on an unknown id rejects with charge_not_found': async (t) => {
        try {
            await t.puter.payments.getCharge('00000000-0000-4000-8000-000000000000');
            t.assert.ok(false, 'should have rejected');
        } catch (err) {
            t.assert.equal((err as { code?: string }).code, 'charge_not_found');
        }
    },

    'updateSettings without the field rejects before reaching the server': async (t) => {
        await t.assert.rejects(
            () => (t.puter.payments.updateSettings as (s: unknown) => Promise<unknown>)({}),
            'a missing lightningAddress should reject rather than clear the setting',
        );
    },

    'waitForPayment rejects with aborted on an aborted signal': async (t) => {
        const controller = new AbortController();
        controller.abort();
        try {
            await t.puter.payments.waitForPayment('00000000-0000-4000-8000-000000000000', { signal: controller.signal });
            t.assert.ok(false, 'should have rejected');
        } catch (err) {
            const e = err as { code?: string; chargeId?: string };
            t.assert.equal(e.code, 'aborted');
            t.assert.equal(e.chargeId, '00000000-0000-4000-8000-000000000000');
        }
    },

    'checkout outside a browser rejects before creating a charge': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            try {
                await t.puter.payments.checkout({ amountSats: 100 });
                t.assert.ok(false, 'should have rejected');
            } catch (err) {
                // Not `lightning_address_not_configured`: the environment check comes first.
                t.assert.equal((err as { code?: string }).code, 'unsupported_environment');
            }
        },
    },

    'listCharges returns a page envelope': async (t) => {
        const page = await t.puter.payments.listCharges({ limit: 5 });
        t.assert.ok(Array.isArray(page.items), 'items should be an array');
    },
});
