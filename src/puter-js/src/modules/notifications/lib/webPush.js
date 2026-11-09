import { PuterJSError } from '../../../lib/PuterJSError.js';
import { request } from './api.js';
import {
    HANDLERS_STORE,
    RECEIPT_PREFIX,
    SERVER_KEYS_ENTRY,
    SERVER_KEY_ENTRY,
    idbDelete,
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

/** The scope `worker` registers at: its own, else its script's folder. */
export const workerScope = (worker) =>
    new URL(worker.scope ?? './', scriptUrl(worker)).href;

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
        scope = workerScope(worker);
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

/** The receipt kept at `scope` for `subscription`'s endpoint, else null. */
const storedReceipt = async (scope, subscription) => {
    try {
        const kept = await idbGet(HANDLERS_STORE, RECEIPT_PREFIX + scope);
        return kept?.endpoint === subscription.endpoint &&
            typeof kept.receipt === 'string'
            ? kept.receipt
            : null;
    } catch {
        return null;
    }
};

const keepReceipt = async (scope, endpoint, receipt) => {
    if (typeof receipt !== 'string' || receipt === '') return;
    try {
        await idbPut(HANDLERS_STORE, RECEIPT_PREFIX + scope, {
            endpoint,
            receipt,
        });
    } catch {
        // The next new account here is asked to confirm again.
    }
};

const forgetReceipt = async (scope) => {
    try {
        await idbDelete(HANDLERS_STORE, RECEIPT_PREFIX + scope);
    } catch {
        // A leftover is only sent for the same endpoint.
    }
};

/** Forgets the receipt kept for `worker`'s subscription. Never throws. */
export const forgetWebPushReceipt = async (worker) => {
    let scope;
    try {
        scope = workerScope(worker);
    } catch {
        return;
    }
    await forgetReceipt(scope);
};

/** Tells the server about `subscription`; `active` or `pending`. */
const announce = async (puter, subscription, { label, interactive, scope }) => {
    const receipt = await storedReceipt(scope, subscription);
    return await request(
        puter,
        'POST',
        '/push/web/subscriptions',
        {
            subscription: subscriptionBody(subscription),
            ...(label ? { label } : {}),
            ...(receipt ? { receipt } : {}),
        },
        { interactiveReauth: interactive },
    );
};

const turnedOff = () =>
    new PuterJSError(
        'Push notifications were turned off before this browser was confirmed',
        'push_verification_canceled',
    );

/** The keys in `values` that decode, skipping anything else. */
const decodeKeys = (values) =>
    values.flatMap((value) => {
        if (typeof value !== 'string' || value === '') return [];
        try {
            return [fromBase64Url(value)];
        } catch {
            return [];
        }
    });

/** The key Puter last subscribed this origin with, or null. */
const storedPuterKey = async () => {
    try {
        const stored = await idbGet(HANDLERS_STORE, SERVER_KEY_ENTRY);
        return typeof stored === 'string' ? fromBase64Url(stored) : null;
    } catch {
        return null;
    }
};

/** That key and every key the server listed as Puter's. */
const storedPuterKeys = async () => {
    let listed = [];
    try {
        const stored = await idbGet(HANDLERS_STORE, SERVER_KEYS_ENTRY);
        if (Array.isArray(stored)) listed = decodeKeys(stored);
    } catch {
        // Only the last key is known then.
    }
    const last = await storedPuterKey();
    return last ? [last, ...listed] : listed;
};

/** Whether `buffer` is a key Puter subscribed with: stored here, or in `listed`. */
const earlierPuterKey = async (buffer, listed = []) =>
    [...listed, ...(await storedPuterKeys())].some((key) =>
        sameKey(buffer, key),
    );

/** Puter's keys as stored here, else as the server gives them, else none. */
const puterKeys = async (puter, authToken) => {
    const stored = await storedPuterKeys();
    if (stored.length > 0) return stored;
    try {
        const { publicKey, previousKeys } = await request(
            puter,
            'GET',
            '/push/web/key',
            undefined,
            { authToken, interactiveReauth: false },
        );
        return decodeKeys([
            publicKey,
            ...(Array.isArray(previousKeys) ? previousKeys : []),
        ]);
    } catch {
        return [];
    }
};

/**
 * Subscriptions with Puter's key, at `worker` or anywhere on the origin, each
 * with its registration's scope.
 */
const puterSubscriptions = async (puter, { worker, authToken, nav }) => {
    const registrations = worker
        ? [await nav.serviceWorker.getRegistration(worker.scope ?? worker.url)]
        : await nav.serviceWorker.getRegistrations();
    const found = (
        await Promise.all(
            registrations.map(async (r) => {
                const subscription = await r?.pushManager.getSubscription();
                return subscription ? { subscription, scope: r.scope } : null;
            }),
        )
    ).filter((entry) => entry !== null);
    // The GUI's own worker carries Puter's subscription only.
    if (found.length === 0 || puter.env === 'gui') return found;
    const keys = await puterKeys(puter, authToken);
    return found.filter(({ subscription }) =>
        keys.some((key) =>
            sameKey(subscription.options?.applicationServerKey, key),
        ),
    );
};

const rememberPuterKey = async (publicKey, previousKeys) => {
    try {
        await idbPut(HANDLERS_STORE, SERVER_KEY_ENTRY, publicKey);
        if (Array.isArray(previousKeys)) {
            await idbPut(HANDLERS_STORE, SERVER_KEYS_ENTRY, [
                publicKey,
                ...previousKeys.filter((k) => typeof k === 'string'),
            ]);
        }
    } catch {
        // Only a later key rotation needs it.
    }
};

/**
 * This registration's subscription made with Puter's `key`, or null. One made
 * with Puter's earlier key is ended; on a website, one made with any other key
 * belongs to something else on the site and is left alone.
 */
const currentSubscription = async (
    puter,
    registration,
    key,
    earlier,
    scope,
) => {
    const subscription = await registration.pushManager.getSubscription();
    const existing = subscription?.options?.applicationServerKey;
    if (!subscription || sameKey(existing, key)) return subscription;
    if (
        puter.env === 'web' &&
        existing &&
        !(await earlierPuterKey(existing, earlier))
    ) {
        throw new PuterJSError(
            'This browser already has a push subscription from another service on this site',
            'push_subscription_conflict',
        );
    }
    await subscription.unsubscribe();
    await forgetReceipt(scope);
    return null;
};

/** Announces what `subscribe` gives, then confirms it if the server asks. */
const register = async (
    puter,
    nav,
    subscribe,
    {
        label,
        scope,
        onPending,
        signal,
        interactive,
        whileWanted,
        onAnnounced,
        onSynced,
    },
) => {
    /** @type {ReturnType<typeof nextChallenge> | null} */
    let challenge = null;
    try {
        const { subscription, result } = await whileWanted(async () => {
            const subscription = await subscribe();
            // Before the POST: the confirmation can arrive before it returns.
            challenge = nextChallenge(nav, signal);
            const result = await announce(puter, subscription, {
                label,
                interactive,
                scope,
            });
            if (signal?.aborted) throw turnedOff();
            await onAnnounced?.();
            if (result.status === 'active') {
                await keepReceipt(scope, subscription.endpoint, result.receipt);
                await onSynced?.(subscription.endpoint);
            }
            return { subscription, result };
        });
        if (result.status === 'active') return result.device;
        onPending?.();
        const answer = await challenge.promise;
        if (answer === null) throw turnedOff();
        const { device } = await whileWanted(async () => {
            const verified = await request(
                puter,
                'POST',
                '/push/web/subscriptions/verify',
                {
                    subscription: subscriptionBody(subscription),
                    challenge: answer,
                },
                { interactiveReauth: false },
            );
            await keepReceipt(scope, subscription.endpoint, verified?.receipt);
            await onSynced?.(subscription.endpoint);
            return verified;
        });
        return device;
    } finally {
        challenge?.cancel();
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
 *     interactive?: boolean;
 *     stillWanted?: () => boolean | Promise<boolean>;
 *     withLock?: <T>(run: () => Promise<T>) => Promise<T>;
 *     onAnnounced?: () => Promise<void>;
 *     onSynced?: (endpoint: string) => Promise<void>;
 * }} options
 *   `onPending` runs once the server has the subscription and only its
 *   confirmation is left. Aborting `signal` stops waiting for that
 *   confirmation, with `push_verification_canceled`. `renewRemoved` replaces a
 *   subscription the user removed in Puter instead of rejecting with
 *   `push_device_removed`. `interactive` lets a rejected token open Puter's
 *   sign-in for the key and the subscription; the confirmation never does.
 *   Subscribing and confirming each run in `withLock` while `stillWanted`
 *   holds, else reject with `push_verification_canceled`. `onAnnounced` runs in
 *   the same lock once the server has the subscription.
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
        interactive = false,
        stillWanted = () => true,
        withLock = (run) => run(),
        onAnnounced,
        onSynced,
    },
) {
    const { publicKey, previousKeys } = await request(
        puter,
        'GET',
        '/push/web/key',
        undefined,
        { interactiveReauth: interactive },
    );
    if (typeof publicKey !== 'string' || publicKey === '') {
        throw new PuterJSError(
            "Push notifications aren't available on this deployment",
            'push_unavailable',
        );
    }
    const key = fromBase64Url(publicKey);
    const earlier = decodeKeys(Array.isArray(previousKeys) ? previousKeys : []);
    const registration = await registerWorker(nav, worker, {
        keepSiteWorker: puter.env !== 'gui',
    });
    const scope = registration.scope;

    /** @type {PushSubscription | null} */
    let subscription = null;
    const options = {
        label,
        scope,
        onPending,
        signal,
        interactive,
        onAnnounced,
        onSynced,
        whileWanted: (run) =>
            withLock(async () => {
                if (signal?.aborted || !(await stillWanted()))
                    throw turnedOff();
                return await run();
            }),
    };
    try {
        return await register(
            puter,
            nav,
            async () => {
                subscription =
                    (await currentSubscription(
                        puter,
                        registration,
                        key,
                        earlier,
                        scope,
                    )) ?? (await subscribeWith(registration, key));
                await rememberPuterKey(publicKey, previousKeys);
                return subscription;
            },
            options,
        );
    } catch (error) {
        const renewable =
            RENEWABLE_SUBSCRIPTION_ERRORS.has(error?.code) ||
            (renewRemoved && error?.code === 'push_device_removed');
        if (!renewable || !subscription || signal?.aborted) throw error;
        // A brand-new subscription the push service doesn't know yet, an
        // endpoint another account turned off here, or one the user removed.
        const stale = subscription;
        return await register(
            puter,
            nav,
            async () => {
                await stale.unsubscribe();
                await forgetReceipt(scope);
                return await subscribeWith(registration, key);
            },
            options,
        );
    }
}

/**
 * The server's answer for this browser's subscription at `endpoint`, or null
 * when it can't tell, as on a server without the route. Never throws.
 *
 * @returns {Promise<'active' | 'removed' | 'revoked' | 'unknown' | null>}
 */
export async function webPushState(puter, endpoint) {
    return (await webPushCheck(puter, endpoint))?.state ?? null;
}

/** `webPushState`'s answer with the key the server names as Puter's, if any. */
export async function webPushCheck(puter, endpoint) {
    try {
        const { state, publicKey } = await request(
            puter,
            'POST',
            '/push/web/subscriptions/status',
            { endpoint },
            { interactiveReauth: false },
        );
        if (!SUBSCRIPTION_STATES.has(state)) return null;
        return {
            state,
            publicKey:
                typeof publicKey === 'string' && publicKey !== ''
                    ? publicKey
                    : null,
        };
    } catch {
        return null;
    }
}

/** Whether `subscription` uses Puter's stored key, and `publicKey` if given. */
export async function usesPuterKey(subscription, publicKey = null) {
    const existing = subscription?.options?.applicationServerKey;
    const stored = await storedPuterKey();
    if (!stored || !sameKey(existing, stored)) return false;
    if (publicKey === null) return true;
    try {
        return sameKey(existing, fromBase64Url(publicKey));
    } catch {
        return false;
    }
}

/** Ends Puter's subscriptions in the browser only; resolves their endpoints. */
export async function unsubscribeWebPush(
    puter,
    { worker = null, authToken, nav = globalThis.navigator } = {},
) {
    const found = await puterSubscriptions(puter, {
        worker,
        authToken,
        nav,
    });
    for (const { subscription, scope } of found) {
        try {
            await subscription.unsubscribe();
        } catch {
            // Already gone, or the browser can't tell.
        }
        await forgetReceipt(scope);
    }
    return found.map(({ subscription }) => subscription.endpoint);
}

/** `unsubscribeWebPush`, then the server; resolves whether there was one. */
export async function removeWebPush(
    puter,
    {
        worker = null,
        authToken,
        keepalive = false,
        nav = globalThis.navigator,
    } = {},
) {
    const endpoints = await unsubscribeWebPush(puter, {
        worker,
        authToken,
        nav,
    });
    await Promise.all(
        endpoints.map((endpoint) =>
            request(
                puter,
                'DELETE',
                '/push/web/subscriptions',
                { endpoint },
                { authToken, interactiveReauth: false, keepalive },
            ),
        ),
    );
    return endpoints.length > 0;
}

/** This browser's subscription for `worker`, or null. */
export async function currentWebPush({ worker, nav = globalThis.navigator }) {
    const registration = await nav.serviceWorker.getRegistration(
        worker.scope ?? worker.url,
    );
    return (await registration?.pushManager.getSubscription()) ?? null;
}
