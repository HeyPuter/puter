import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The dialog is a DOM custom element; what matters here is what it is asked
// to show, not how it renders.
vi.mock('../modules/UsageLimitDialog.js', () => ({
    showUsageLimitDialog: vi.fn(),
}));

import { showUsageLimitDialog } from '../modules/UsageLimitDialog.js';
import { classifyUpgradeRefusal, promptIfUpgradeRequired } from './upgradePrompt.js';

describe('classifyUpgradeRefusal', () => {
    it.each([
        // route error body (HttpError → errorHandler), status merged in by the caller
        [{ code: 'subscription_required', status: 402 }, 'subscription'],
        [{ code: 'insufficient_funds', status: 402 }, 'funds'],
        [{ code: 'storage_limit_reached', status: 413 }, 'storage'],
        // codes alone, the shape the legacy XHR path rejects with
        [{ code: 'subscription_required' }, 'subscription'],
        [{ code: 'insufficient_funds' }, 'funds'],
        [{ code: 'storage_limit_reached' }, 'storage'],
        [{ code: 'NOT_ENOUGH_SPACE' }, 'storage'],
        // driver envelope
        [{ success: false, error: { code: 'subscription_required' } }, 'subscription'],
        [{ success: false, error: { code: 'insufficient_funds' } }, 'funds'],
        [{ success: false, error: { status: 402 } }, 'funds'],
        // stream line
        [{ metadata: { usage_limited: true } }, 'funds'],
        // bare statuses keep their historical meaning
        [{ status: 402 }, 'funds'],
        [{ status: 413 }, 'storage'],
        // a 402 that names a plan gate is not a funding problem
        [{ status: 402, code: 'subscription_required' }, 'subscription'],
        // not refusals
        [{ code: 'item_with_same_name_exists' }, null],
        [{ status: 403 }, null],
        [{ error: 'Forbidden', message: 'Forbidden', code: 'forbidden' }, null],
        [{ message: 'network error' }, null],
        ['Storage limit reached', null],
        [null, null],
        [undefined, null],
    ])('%o -> %s', (error, expected) => {
        expect(classifyUpgradeRefusal(error)).toBe(expected);
    });
});

describe('promptIfUpgradeRequired', () => {
    const origPuter = globalThis.puter;

    beforeEach(() => {
        globalThis.puter = { env: 'app', ui: { requestUpgrade: vi.fn() } };
    });

    afterEach(() => {
        globalThis.puter = origPuter;
        vi.clearAllMocks();
    });

    describe('inside an app', () => {
        it('hands the desktop what was refused and why', () => {
            promptIfUpgradeRequired(
                { code: 'subscription_required', status: 402 },
                { method: 'puter.email.sendTransactional', subscriptionMessage: 'Sending email requires a subscription.' },
            );
            expect(globalThis.puter.ui.requestUpgrade).toHaveBeenCalledWith({
                reason: 'subscription',
                method: 'puter.email.sendTransactional',
                message: 'Sending email requires a subscription.',
            });
            expect(showUsageLimitDialog).not.toHaveBeenCalled();
        });

        it('does not wait for the desktop to answer', () => {
            // The desktop opens its upgrade window and never resolves the
            // callback; the rejection must not hang behind it.
            globalThis.puter.ui.requestUpgrade = vi.fn(() => new Promise(() => {}));
            expect(promptIfUpgradeRequired({ status: 413 })).toBeUndefined();
        });

        it('reports storage and funding refusals as such', () => {
            promptIfUpgradeRequired({ code: 'storage_limit_reached' }, { method: 'puter.fs.upload' });
            promptIfUpgradeRequired({ code: 'insufficient_funds' }, { method: 'puter.ai.chat' });
            expect(globalThis.puter.ui.requestUpgrade.mock.calls).toEqual([
                [{ reason: 'storage', method: 'puter.fs.upload', message: 'Not enough storage space available.' }],
                [{ reason: 'funds', method: 'puter.ai.chat', message: 'Your account does not have enough funding to complete this request.' }],
            ]);
        });
    });

    describe('on a third-party site', () => {
        beforeEach(() => {
            globalThis.puter = { env: 'web' };
        });

        it('shows the funding dialog for an out-of-credit call', () => {
            promptIfUpgradeRequired({ code: 'insufficient_funds', status: 402 }, { method: 'puter-kvstore::set' });
            expect(showUsageLimitDialog).toHaveBeenCalledWith(
                'Your account does not have enough funding to complete this request.',
                { title: 'Low Balance', method: 'puter-kvstore::set' },
            );
        });

        it('shows the storage dialog for an out-of-space write', () => {
            promptIfUpgradeRequired({ code: 'storage_limit_reached', status: 413 }, { method: 'puter.fs.upload' });
            expect(showUsageLimitDialog).toHaveBeenCalledWith(
                'Not enough storage space available.',
                { title: 'Out of Storage', method: 'puter.fs.upload' },
            );
        });

        it("prefers the SDK method's own wording for a plan gate", () => {
            promptIfUpgradeRequired(
                { code: 'subscription_required', message: 'A subscription is required for this action' },
                { method: 'puter.email.sendTransactional', subscriptionMessage: 'Sending email requires a subscription.' },
            );
            expect(showUsageLimitDialog).toHaveBeenCalledWith(
                'Sending email requires a subscription.',
                { title: 'Subscription Required', method: 'puter.email.sendTransactional' },
            );
        });

        it("falls back to the backend's message, punctuated", () => {
            promptIfUpgradeRequired(
                { code: 'subscription_required', message: 'External email requires a subscription' },
                { method: 'puter.email.send' },
            );
            expect(showUsageLimitDialog).toHaveBeenCalledWith(
                'External email requires a subscription.',
                { title: 'Subscription Required', method: 'puter.email.send' },
            );
        });

        it('reads the message off a driver envelope too', () => {
            promptIfUpgradeRequired({
                success: false,
                error: { code: 'subscription_required', message: 'Pro plan only.' },
            });
            expect(showUsageLimitDialog).toHaveBeenCalledWith(
                'Pro plan only.',
                { title: 'Subscription Required', method: undefined },
            );
        });

        it('falls back to a generic line when nobody said why', () => {
            promptIfUpgradeRequired({ code: 'subscription_required', status: 402 });
            expect(showUsageLimitDialog).toHaveBeenCalledWith(
                'This action requires a subscription.',
                { title: 'Subscription Required', method: undefined },
            );
        });

        it('ignores a blank backend message', () => {
            promptIfUpgradeRequired({ code: 'subscription_required', message: '   ' });
            expect(showUsageLimitDialog).toHaveBeenCalledWith(
                'This action requires a subscription.',
                expect.anything(),
            );
        });
    });

    it('does nothing for a rejection an upgrade would not clear', () => {
        promptIfUpgradeRequired({ status: 403 });
        promptIfUpgradeRequired(new Error('offline'));
        promptIfUpgradeRequired('Authentication failed.');
        expect(globalThis.puter.ui.requestUpgrade).not.toHaveBeenCalled();
        expect(showUsageLimitDialog).not.toHaveBeenCalled();
    });

    describe('everywhere else', () => {
        it.each(['gui', 'nodejs', 'web-worker', 'service-worker'])(
            'keeps funding and plan refusals silent in the %s environment',
            (env) => {
                globalThis.puter = { env, ui: { requestUpgrade: vi.fn() } };
                promptIfUpgradeRequired({ code: 'insufficient_funds', status: 402 });
                promptIfUpgradeRequired({ code: 'subscription_required', status: 402 });
                expect(globalThis.puter.ui.requestUpgrade).not.toHaveBeenCalled();
                expect(showUsageLimitDialog).not.toHaveBeenCalled();
            },
        );

        it.each(['gui', 'nodejs'])(
            'still shows the storage dialog in the %s environment, which the desktop relies on',
            (env) => {
                globalThis.puter = { env, ui: { requestUpgrade: vi.fn() } };
                promptIfUpgradeRequired({ code: 'storage_limit_reached' }, { method: 'puter.fs (/copy)' });
                expect(showUsageLimitDialog).toHaveBeenCalledWith(
                    'Not enough storage space available.',
                    { title: 'Out of Storage', method: 'puter.fs (/copy)' },
                );
                expect(globalThis.puter.ui.requestUpgrade).not.toHaveBeenCalled();
            },
        );
    });

    it('uses the SDK instance it is handed over the global one', () => {
        const local = { env: 'app', ui: { requestUpgrade: vi.fn() } };
        promptIfUpgradeRequired({ status: 402 }, { method: 'puter.ai.chat' }, local);
        expect(local.ui.requestUpgrade).toHaveBeenCalledTimes(1);
        expect(globalThis.puter.ui.requestUpgrade).not.toHaveBeenCalled();
    });
});
