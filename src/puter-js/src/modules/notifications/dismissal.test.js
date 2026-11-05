import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const driverCall = vi.fn();
vi.mock('../../lib/networkUtils.js', () => ({
    driverCall: (...args) => driverCall(...args),
}));
const { NotificationsModule } = await import('./index.js');
const { reconcileDismissed } = await import('./lib/osNotifications.js');

const osNotification = (uid) => ({ data: { puter: { uid } }, close: vi.fn() });
let shown, getRegistration, events, callbacks, mod;
const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeEach(() => {
    shown = [];
    callbacks = [];
    getRegistration = vi.fn(async () => ({ getNotifications: async () => shown }));
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration } });
    vi.stubGlobal('location', { href: 'https://app.example/page' });
    driverCall.mockReset().mockResolvedValue([]);
    events = {
        onLocal: vi.fn(async (subject, handler) => {
            callbacks.push((event) => handler({ event }));
            return { off: vi.fn() };
        }),
        fetch: vi.fn(async () => ({ items: [] })),
    };
    mod = new NotificationsModule({
        env: 'web', authToken: 'token',
        getAppIDFromAuthToken: () => 'app-1',
        onAuthStateChanged: () => () => {},
        events,
    });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const dismissal = (uid) => ({ op: 'dismiss', uid, type: 'app.message' });

describe('dismissal listeners', () => {
    it('starts a live feed, closes matching OS copies and emits only uid', async () => {
        shown = [osNotification('one'), osNotification('two')];
        const handler = vi.fn();
        expect(mod.on('dismiss', handler)).toBe(mod);
        await settle();
        callbacks[0]({ ...dismissal('one'), notification: { title: 'private' } });
        await settle();
        expect(events.onLocal).toHaveBeenCalledWith('notif:app-user', expect.any(Function), expect.any(Object));
        expect(handler).toHaveBeenCalledExactlyOnceWith({ uid: 'one' });
        expect(shown.map((n) => n.close.mock.calls.length)).toEqual([1, 0]);
        expect(mod.off('dismiss', handler)).toBe(mod);
        callbacks[0](dismissal('two'));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('keeps postings and dismissal events separate across multiple feeds', async () => {
        const posted = vi.fn();
        await mod.onNotification(posted);
        await mod.onNotification(posted);
        const handler = vi.fn();
        mod.on('dismiss', handler);
        await settle();
        for (const callback of callbacks) callback(dismissal('one'));
        expect(handler).toHaveBeenCalledExactlyOnceWith({ uid: 'one' });
        expect(posted).not.toHaveBeenCalled();
        callbacks[0]({ op: 'dismiss', type: 'other', uid: 'two' });
        callbacks[0]({ op: 'dismiss', type: 'app.message', uid: '' });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not claim a posting was received by a dismissal-only listener', async () => {
        mod.on('dismiss', () => {});
        await settle();
        callbacks[0]({ op: 'post', type: 'app.message', uid: 'one', notification: { title: 'Hello' } });
        vi.useFakeTimers();
        const ack = vi.fn();
        mod._answerReceipt({ uid: 'one' }, ack);
        expect(ack).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(ack).toHaveBeenCalledExactlyOnceWith({ received: false });
    });

    it('retains unsupported event validation', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(mod.on('other', () => {})).toBeUndefined();
        expect(events.onLocal).not.toHaveBeenCalled();
    });

    it.each([true, false])('dismiss closes this browser copy when marked is %s', async (success) => {
        shown = [osNotification('one'), osNotification('two')];
        driverCall.mockResolvedValue({ success });
        expect(await mod.dismiss('one')).toBe(success);
        expect(shown[0].close).toHaveBeenCalled();
        expect(shown[1].close).not.toHaveBeenCalled();
    });

    it('does not close on an unsuccessful request', async () => {
        shown = [osNotification('one')];
        driverCall.mockRejectedValue({ code: 'forbidden', message: 'Denied' });
        await expect(mod.dismiss('one')).rejects.toMatchObject({ code: 'forbidden' });
        expect(shown[0].close).not.toHaveBeenCalled();
    });
});

describe('displayed notification catch-up', () => {
    it('uses one bounded read and closes only acknowledged visible rows without an event', async () => {
        shown = Array.from({ length: 60 }, (_, i) => osNotification(`n-${i}`));
        driverCall.mockResolvedValue([
            { uid: 'n-0', acknowledged: 123 },
            { uid: 'n-1', acknowledged: null },
            { uid: 'n-2', acknowledged: 0 },
        ]);
        const handler = vi.fn();
        mod.on('dismiss', handler);
        await settle();
        expect(driverCall).toHaveBeenCalledTimes(1);
        expect(driverCall.mock.calls[0][0]).toMatchObject({
            method: 'select', args: { subject: 'notif:app-user', limit: 50, uids: shown.slice(0, 50).map((n) => n.data.puter.uid) },
        });
        expect(shown.filter((n) => n.close.mock.calls.length).map((n) => n.data.puter.uid)).toEqual(['n-0', 'n-2']);
        expect(handler).not.toHaveBeenCalled();
    });

    it('runs when onNotification starts and after a gap', async () => {
        shown = [osNotification('one')];
        driverCall.mockResolvedValue([{ uid: 'one', acknowledged: 123 }]);
        await mod.onNotification(() => {});
        callbacks[0]({ op: 'gap' });
        await settle();
        expect(driverCall).toHaveBeenCalledTimes(2);
        expect(shown[0].close).toHaveBeenCalledTimes(2);
    });

    it('does not ask the server without displayed Puter notifications', async () => {
        shown = [{ data: { uid: 'unrelated' }, close: vi.fn() }];
        await mod.onNotification(() => {});
        expect(driverCall).not.toHaveBeenCalled();
    });

    it('uses the selected custom worker registration', async () => {
        shown = [osNotification('one')];
        await reconcileDismissed(mod.puter, { url: '/custom/sw.js' });
        expect(getRegistration).toHaveBeenCalledWith('/custom/sw.js');
    });

    it('finds an app worker outside the page scope when none was selected here', async () => {
        const own = osNotification('one');
        const unrelated = osNotification('another-app');
        globalThis.navigator.serviceWorker.getRegistrations = vi.fn(async () => [
            { getNotifications: async () => [unrelated] },
            { getNotifications: async () => [own] },
        ]);
        driverCall.mockResolvedValue([{ uid: 'one', acknowledged: 123 }]);
        await mod.onNotification(() => {});
        expect(own.close).toHaveBeenCalledOnce();
        expect(unrelated.close).not.toHaveBeenCalled();
    });

    it('ignores a result after the signed-in account changed', async () => {
        shown = [osNotification('one')];
        driverCall.mockImplementation(async () => {
            mod.puter.authToken = 'another';
            return [{ uid: 'one', acknowledged: 123 }];
        });
        await mod.onNotification(() => {});
        expect(shown[0].close).not.toHaveBeenCalled();
    });

    it('contains failures so live delivery can still start', async () => {
        shown = [osNotification('one')];
        driverCall.mockRejectedValue(new Error('offline'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(mod.onNotification(() => {})).resolves.toHaveProperty('off');
        expect(shown[0].close).not.toHaveBeenCalled();
    });
});
