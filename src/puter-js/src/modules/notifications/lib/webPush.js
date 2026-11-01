import { PuterJSError } from '../../../lib/PuterJSError.js';
import { request } from './api.js';
import {
    HANDLERS_STORE,
    SERVER_KEY_ENTRY,
    idbGet,
    idbPut,
} from './pushStore.js';

/** Posted by the service worker when the server's confirmation push arrives. */
export const CHALLENGE_MESSAGE = 'puter-push-challenge';
/** Where an app's own origin serves the worker that imports `push-sw.js`. */
export const DEFAULT_APP_WORKER = '/puter-sw.js';
/** The Puter GUI's own worker. */
export const GUI_WORKER = '/sw.js';

const CHALLENGE_TIMEOUT_MS = 30_000;
const WORKER_START_TIMEOUT_MS = 10_000;
/** Answers that a fresh subscription can get past; it is tried once. */
const RENEWABLE_SUBSCRIPTION_ERRORS = new Set([
    'push_subscription_invalid',
    'push_endpoint_revoked',
]);
/** What the server says about a subscription. */
const SUBSCRIPTION_STATES = new Set([
    'active',
    'removed',
    'revoked',
    'unknown',
]);

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

const scriptUrl = (worker) => {
    try {
        return new URL(worker.url, globalThis.location?.href).href;
    } catch {
        return worker.url;
    }
};

const workerConflict = (worker, other) =>
    new PuterJSError(
        `Another service worker (${other.scriptURL}) runs where ${worker.url} would. ` +
            "Add importScripts('https://js.puter.com/push-sw.js') to it and pass its path as the `serviceWorker` option.",
        'push_worker_conflict',
    );

/** Resolves once `worker`'s script is the registration's active one. */
const untilActive = (registration, worker) => {
    const url = scriptUrl(worker);
    const other = registration.active;
    if (other?.scriptURL === url) return Promise.resolve(registration);
    const ours = [registration.installing, registration.waiting].find(
        (candidate) => candidate?.scriptURL === url,
    );
    if (!ours) {
        return other
            ? Promise.reject(workerConflict(worker, other))
            : Promise.resolve(registration);
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ours.removeEventListener('statechange', check);
            // Waiting behind another worker that keeps its pages.
            reject(
                other
                    ? workerConflict(worker, other)
                    : new PuterJSError(
                          'The push service worker did not start',
                          'push_worker_unavailable',
                      ),
            );
        }, WORKER_START_TIMEOUT_MS);
        function check() {
            if (ours.state !== 'activated' && ours.state !== 'redundant')
                return;
            clearTimeout(timer);
            ours.removeEventListener('statechange', check);
            if (ours.state === 'activated') resolve(registration);
            else
                reject(
                    new PuterJSError(
                        'The push service worker failed to install',
                        'push_worker_unavailable',
                    ),
                );
        }
        ours.addEventListener('statechange', check);
        check();
    });
};

/**
 * The site's own worker at the scope `worker` would take, while none of ours is
 * there yet, else null. Registering over it would swap it out once the site's
 * tabs close.
 */
const siteWorkerAt = async (nav, worker) => {
    let scope;
    let existing;
    try {
        scope = new URL('./', scriptUrl(worker)).href;
        existing = await nav.serviceWorker.getRegistration(scope);
    } catch {
        return null;
    }
    if (existing?.scope !== scope) return null;
    const workers = [existing.active, existing.waiting, existing.installing];
    const url = scriptUrl(worker);
    if (workers.some((w) => w?.scriptURL === url)) return null;
    return workers.find(Boolean) ?? null;
};

const registerWorker = async (nav, worker, { keepSiteWorker = false } = {}) => {
    if (keepSiteWorker) {
        const other = await siteWorkerAt(nav, worker);
        if (other) throw workerConflict(worker, other);
    }
    let registration;
    try {
        registration = await nav.serviceWorker.register(worker.url, {
            ...(worker.scope ? { scope: worker.scope } : {}),
            updateViaCache: 'none',
        });
    } catch (error) {
        throw new PuterJSError(
            `Could not register the push service worker at ${worker.url}`,
            'push_worker_unavailable',
            { cause: error },
        );
    }
    return await untilActive(registration, worker);
};

/**
 * Resolves the next challenge the worker hands this page, or null once `signal`
 * aborts; `cancel` stops waiting.
 *
 * @param {Navigator} nav
 * @param {AbortSignal} [signal]
 * @returns {{ promise: Promise<string | null>; cancel: () => void }}
 */
const nextChallenge = (nav, signal) => {
    let cancel = () => {};
    /** @type {Promise<string | null>} */
    const promise = new Promise((resolve, reject) => {
        const onMessage = (event) => {
            const data = event.data;
            if (data?.type !== CHALLENGE_MESSAGE) return;
            if (typeof data.challenge !== 'string') return;
            cancel();
            resolve(data.challenge);
        };
        const onAbort = () => {
            cancel();
            resolve(null);
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
            signal?.removeEventListener('abort', onAbort);
        };
        nav.serviceWorker.addEventListener('message', onMessage);
        nav.serviceWorker.startMessages?.();
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort);
    });
    return { promise, cancel: () => cancel() };
};

const subscriptionBody = (subscription) => {
    const { endpoint, keys } = subscription.toJSON();
    return { endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth } };
};

const subscribeWith = async (registration, key) => {
    try {
        return await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
        });
    } catch (error) {
        throw new PuterJSError(
            error?.message || 'The browser refused the push subscription',
            'push_subscribe_failed',
            { cause: error },
        );
    }
};

/** Tells the server about `subscription`; `active` or `pending`. */
const announce = (puter, subscription, label) =>
    request(puter, 'POST', '/push/web/subscriptions', {
        subscription: subscriptionBody(subscription),
        ...(label ? { label } : {}),
    });

/** Whether `buffer` is the key Puter last subscribed this origin with. */
const earlierPuterKey = async (buffer) => {
    try {
        const stored = await idbGet(HANDLERS_STORE, SERVER_KEY_ENTRY);
        return (
            typeof stored === 'string' && sameKey(buffer, fromBase64Url(stored))
        );
    } catch {
        return false;
    }
};

const rememberPuterKey = async (publicKey) => {
    try {
        await idbPut(HANDLERS_STORE, SERVER_KEY_ENTRY, publicKey);
    } catch {
        // Only a later key rotation needs it.
    }
};

/**
 * This registration's subscription made with Puter's `key`, or null. One made
 * with Puter's earlier key is ended; on a website, one made with any other key
 * belongs to something else on the site and is left alone.
 */
const currentSubscription = async (puter, registration, key) => {
    const subscription = await registration.pushManager.getSubscription();
    const existing = subscription?.options?.applicationServerKey;
    if (!subscription || sameKey(existing, key)) return subscription;
    if (puter.env === 'web' && existing && !(await earlierPuterKey(existing))) {
        throw new PuterJSError(
            'This browser already has a push subscription from another service on this site',
            'push_subscription_conflict',
        );
    }
    await subscription.unsubscribe();
    return null;
};

/**
 * Announces `subscription` and, for one the server doesn't have yet, waits for
 * the confirmation push and verifies it.
 */
const register = async (
    puter,
    nav,
    subscription,
    { label, onPending, signal },
) => {
    // Listening first: the confirmation can arrive before the POST returns.
    const challenge = nextChallenge(nav, signal);
    try {
        const result = await announce(puter, subscription, label);
        if (result.status === 'active') return result.device;
        onPending?.();
        const answer = await challenge.promise;
        if (answer === null) {
            throw new PuterJSError(
                'Push notifications were turned off before this browser was confirmed',
                'push_verification_canceled',
            );
        }
        const { device } = await request(
            puter,
            'POST',
            '/push/web/subscriptions/verify',
            {
                subscription: subscriptionBody(subscription),
                challenge: answer,
            },
        );
        return device;
    } finally {
        challenge.cancel();
    }
};

/**
 * Subscribes this browser and registers it with the server. A new subscription
 * is confirmed by a push the worker hands back; a known one is only refreshed.
 * Needs notification permission already granted.
 *
 * @param {import('../../../index.js').Puter} puter
 * @param {{
 *     worker: { url: string; scope?: string };
 *     label?: string;
 *     nav?: Navigator;
 *     onPending?: () => void;
 *     signal?: AbortSignal;
 *     renewRemoved?: boolean;
 * }} options
 *   `onPending` runs once the server has the subscription and only its
 *   confirmation is left. Aborting `signal` stops waiting for that
 *   confirmation, with `push_verification_canceled`. `renewRemoved` replaces a
 *   subscription the user removed in Puter instead of rejecting with
 *   `push_device_removed`.
 * @returns {Promise<Record<string, unknown>>} The server's device record.
 */
export async function syncWebPush(
    puter,
    {
        worker,
        label,
        nav = globalThis.navigator,
        onPending,
        signal,
        renewRemoved = false,
    },
) {
    const { publicKey } = await request(puter, 'GET', '/push/web/key');
    if (typeof publicKey !== 'string' || publicKey === '') {
        throw new PuterJSError(
            "Push notifications aren't available on this deployment",
            'push_unavailable',
        );
    }
    const key = fromBase64Url(publicKey);
    const registration = await registerWorker(nav, worker, {
        keepSiteWorker: puter.env !== 'gui',
    });

    let subscription =
        (await currentSubscription(puter, registration, key)) ??
        (await subscribeWith(registration, key));
    await rememberPuterKey(publicKey);

    const options = { label, onPending, signal };
    try {
        return await register(puter, nav, subscription, options);
    } catch (error) {
        const renewable =
            RENEWABLE_SUBSCRIPTION_ERRORS.has(error?.code) ||
            (renewRemoved && error?.code === 'push_device_removed');
        if (!renewable || signal?.aborted) throw error;
        // A brand-new subscription the push service doesn't know yet, an
        // endpoint another account turned off here, or one the user removed.
        await subscription.unsubscribe();
        subscription = await subscribeWith(registration, key);
        return await register(puter, nav, subscription, options);
    }
}

/**
 * The server's answer for this browser's subscription at `endpoint`, or null
 * when it can't tell, as on a server without the route. Never throws.
 *
 * @returns {Promise<'active' | 'removed' | 'revoked' | 'unknown' | null>}
 */
export async function webPushState(puter, endpoint) {
    try {
        const { state } = await request(
            puter,
            'POST',
            '/push/web/subscriptions/status',
            { endpoint },
            { interactiveReauth: false },
        );
        return SUBSCRIPTION_STATES.has(state) ? state : null;
    } catch {
        return null;
    }
}

/**
 * Ends this browser's subscription for `worker` and tells the server, with
 * `authToken` in place of the live token when given.
 */
export async function removeWebPush(
    puter,
    { worker, authToken, nav = globalThis.navigator } = {},
) {
    const registration = await nav.serviceWorker.getRegistration(
        worker.scope ?? worker.url,
    );
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return false;
    try {
        await request(
            puter,
            'DELETE',
            '/push/web/subscriptions',
            { endpoint: subscription.endpoint },
            { authToken },
        );
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
