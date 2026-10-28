import { PuterJSError } from '../../../lib/PuterJSError.js';
import { request } from './api.js';

/** Posted by the service worker when the server's confirmation push arrives. */
export const CHALLENGE_MESSAGE = 'puter-push-challenge';
/** Where an app's own origin serves the worker that imports `push-sw.js`. */
export const DEFAULT_APP_WORKER = '/puter-sw.js';
/** The Puter GUI's own worker. */
export const GUI_WORKER = '/sw.js';

const CHALLENGE_TIMEOUT_MS = 30_000;
const WORKER_START_TIMEOUT_MS = 10_000;

export const webPushSupported = (g = globalThis) =>
    typeof g.navigator?.serviceWorker?.register === 'function' &&
    'PushManager' in g &&
    'Notification' in g;

export const fromBase64Url = (value) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const sameKey = (buffer, key) => {
    if (!buffer) return false;
    const bytes = new Uint8Array(buffer);
    return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
};

/** The worker for this page; `GUI_WORKER` on the GUI, the app's own elsewhere. */
export const workerFor = (env, serviceWorker) =>
    env === 'gui'
        ? { url: GUI_WORKER, scope: '/' }
        : { url: serviceWorker ?? DEFAULT_APP_WORKER };

const untilActive = (registration) => {
    if (registration.active) return Promise.resolve(registration);
    const worker = registration.installing ?? registration.waiting;
    if (!worker) return Promise.resolve(registration);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            worker.removeEventListener('statechange', check);
            reject(
                new PuterJSError(
                    'The push service worker did not start',
                    'push_worker_unavailable',
                ),
            );
        }, WORKER_START_TIMEOUT_MS);
        function check() {
            if (worker.state !== 'activated' && worker.state !== 'redundant')
                return;
            clearTimeout(timer);
            worker.removeEventListener('statechange', check);
            if (worker.state === 'activated') resolve(registration);
            else
                reject(
                    new PuterJSError(
                        'The push service worker failed to install',
                        'push_worker_unavailable',
                    ),
                );
        }
        worker.addEventListener('statechange', check);
        check();
    });
};

const registerWorker = async (nav, worker) => {
    try {
        const registration = await nav.serviceWorker.register(worker.url, {
            ...(worker.scope ? { scope: worker.scope } : {}),
            updateViaCache: 'none',
        });
        return await untilActive(registration);
    } catch (error) {
        if (error instanceof PuterJSError) throw error;
        throw new PuterJSError(
            `Could not register the push service worker at ${worker.url}`,
            'push_worker_unavailable',
            { cause: error },
        );
    }
};

/**
 * Resolves the next challenge the worker hands this page; `cancel` stops
 * waiting.
 */
const nextChallenge = (nav) => {
    let cancel = () => {};
    const promise = new Promise((resolve, reject) => {
        const onMessage = (event) => {
            const data = event.data;
            if (data?.type !== CHALLENGE_MESSAGE) return;
            if (typeof data.challenge !== 'string') return;
            cancel();
            resolve(data.challenge);
        };
        const timer = setTimeout(() => {
            cancel();
            reject(
                new PuterJSError(
                    'The confirmation push did not arrive',
                    'push_verification_timeout',
                ),
            );
        }, CHALLENGE_TIMEOUT_MS);
        cancel = () => {
            clearTimeout(timer);
            nav.serviceWorker.removeEventListener('message', onMessage);
        };
        nav.serviceWorker.addEventListener('message', onMessage);
        nav.serviceWorker.startMessages?.();
    });
    return { promise, cancel: () => cancel() };
};

const subscriptionBody = (subscription) => {
    const { endpoint, keys } = subscription.toJSON();
    return { endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth } };
};

const subscribeWith = (registration, key) =>
    registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
    });

/** Tells the server about `subscription`; `active` or `pending`. */
const announce = (puter, subscription, label) =>
    request(puter, 'POST', '/push/web/subscriptions', {
        subscription: subscriptionBody(subscription),
        ...(label ? { label } : {}),
    });

/**
 * Subscribes this browser and registers it with the server. A new subscription
 * is confirmed by a push the worker hands back; a known one is only refreshed.
 * Needs notification permission already granted.
 *
 * @returns {Promise<Record<string, unknown>>} The server's device record.
 */
export async function syncWebPush(
    puter,
    { worker, label, nav = globalThis.navigator } = {},
) {
    const { publicKey } = await request(puter, 'GET', '/push/web/key');
    if (typeof publicKey !== 'string' || publicKey === '') {
        throw new PuterJSError(
            "Push notifications aren't available on this deployment",
            'push_unavailable',
        );
    }
    const key = fromBase64Url(publicKey);
    const registration = await registerWorker(nav, worker);

    let subscription = await registration.pushManager.getSubscription();
    if (
        subscription &&
        !sameKey(subscription.options?.applicationServerKey, key)
    ) {
        await subscription.unsubscribe();
        subscription = null;
    }
    subscription ??= await subscribeWith(registration, key);

    // Listening first: the confirmation can arrive before the POST returns.
    const challenge = nextChallenge(nav);
    try {
        let result;
        try {
            result = await announce(puter, subscription, label);
        } catch (error) {
            if (error?.code !== 'push_subscription_invalid') throw error;
            // The push service may not know a brand-new subscription yet; one fresh one is tried.
            await subscription.unsubscribe();
            subscription = await subscribeWith(registration, key);
            result = await announce(puter, subscription, label);
        }
        if (result.status === 'active') return result.device;
        const { device } = await request(
            puter,
            'POST',
            '/push/web/subscriptions/verify',
            {
                subscription: subscriptionBody(subscription),
                challenge: await challenge.promise,
            },
        );
        return device;
    } finally {
        challenge.cancel();
    }
}

/** Ends this browser's subscription for `worker` and tells the server. */
export async function removeWebPush(
    puter,
    { worker, nav = globalThis.navigator } = {},
) {
    const registration = await nav.serviceWorker.getRegistration(
        worker.scope ?? worker.url,
    );
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return false;
    try {
        await request(puter, 'DELETE', '/push/web/subscriptions', {
            endpoint: subscription.endpoint,
        });
    } finally {
        await subscription.unsubscribe();
    }
    return true;
}

/** This browser's subscription for `worker`, or null. */
export async function currentWebPush({ worker, nav = globalThis.navigator }) {
    const registration = await nav.serviceWorker.getRegistration(
        worker.scope ?? worker.url,
    );
    return (await registration?.pushManager.getSubscription()) ?? null;
}
