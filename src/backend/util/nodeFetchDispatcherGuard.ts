/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Importing npm `undici` has a process-wide side effect: if the global
// dispatcher slots — `Symbol.for('undici.globalDispatcher.N')`, shared with
// Node's built-in fetch — are empty, undici's module initializer installs its
// own Agent there. From that moment EVERY plain `fetch()` in the process
// (the AI provider SDKs, everything) is silently served by the npm copy of
// undici instead of the copy bundled with — and security-patched by — Node.
//
// The hijack is irreversible once it happens: loading npm undici also makes
// Node's bundled fetch machinery initialize, and the bundled copy only
// claims the slot at that initialization — evicting the npm Agent afterwards
// just leaves plain fetch() throwing `assert(dispatcher)`. So the one
// winning move is to claim the slot for Node FIRST: a data: fetch never
// touches the network but synchronously installs the bundled dispatcher.
//
// This module must therefore be imported before `undici` — it intentionally
// imports nothing itself, and secureHttp.ts (the backend's only undici
// importer) imports it before importing undici.
//
// Newer undici reads the `.2` slot and older undici the `.1` slot, and both
// copies can share the process, so every present slot gets wrapped.
const PRIMARY_SLOT = Symbol.for('undici.globalDispatcher.2');
const LEGACY_SLOT = Symbol.for('undici.globalDispatcher.1');
const DISPATCHER_SLOTS = [PRIMARY_SLOT, LEGACY_SLOT];
const globalSlots = globalThis as unknown as Record<symbol, unknown>;

void fetch('data:text/plain,dispatcher-guard').catch(() => {
    // data: fetch cannot fail meaningfully; if it ever does, the slot is
    // simply claimed by whichever copy of undici initializes first.
});

// AI generation endpoints (Gemini image/video, etc.) can hold a response
// back for minutes while generating; undici kills any request whose response
// headers haven't arrived within 5 minutes (UND_ERR_HEADERS_TIMEOUT), and the
// provider SDKs go through plain fetch with no way to extend that. Wrap the
// claimed dispatcher to give every plain fetch a 10-minute budget instead.
// secureFetch is unaffected: it passes its own explicit dispatchers, keeping
// undici's tighter defaults for user-supplied URLs.
const OUTBOUND_FETCH_TIMEOUT_MS = 10 * 60 * 1000;
// Symbol.for so a re-imported copy of this module (fresh module registry,
// same process) recognizes an already-wrapped dispatcher and doesn't re-wrap.
// A set, not a marker property: compose() can return a Proxy, which would
// write the marker through to the unwrapped dispatcher.
const WRAPPED_DISPATCHERS = Symbol.for('puter.outboundFetchTimeouts');
const wrappedDispatchers = (globalSlots[WRAPPED_DISPATCHERS] ??=
    new WeakSet<object>()) as WeakSet<object>;

type DispatchFn = (opts: Record<string, unknown>, handler: unknown) => boolean;
interface ComposableDispatcher {
    compose: (
        interceptor: (dispatch: DispatchFn) => DispatchFn,
    ) => ComposableDispatcher;
}

const withOutboundTimeouts =
    (dispatch: DispatchFn): DispatchFn =>
    (opts, handler) =>
        // Defaults first so a per-request timeout, if one is ever passed,
        // still wins.
        dispatch(
            {
                headersTimeout: OUTBOUND_FETCH_TIMEOUT_MS,
                bodyTimeout: OUTBOUND_FETCH_TIMEOUT_MS,
                ...opts,
            },
            handler,
        );

// Newer undici negotiates HTTP/2, whose 256 KB default per-stream receive
// window caps a download at about window / RTT. That undici keeps a wrapper of
// its Agent in the legacy slot, so swap in a same-class Agent with larger
// windows and re-wrap it there.
const H2_WINDOWS = {
    initialWindowSize: 4 * 1024 * 1024,
    connectionWindowSize: 16 * 1024 * 1024,
};
type DispatcherClass = new (options: unknown) => ComposableDispatcher;
const primary = globalSlots[PRIMARY_SLOT] as ComposableDispatcher | undefined;
const legacy = globalSlots[LEGACY_SLOT] as ComposableDispatcher | undefined;
if (
    primary &&
    legacy &&
    primary !== legacy &&
    primary.constructor.name === 'Agent' &&
    !wrappedDispatchers.has(primary)
) {
    const agent = new (primary.constructor as DispatcherClass)({
        h2Options: H2_WINDOWS,
    });
    globalSlots[PRIMARY_SLOT] = agent;
    globalSlots[LEGACY_SLOT] = new (legacy.constructor as DispatcherClass)(
        agent,
    );
}

for (const slot of DISPATCHER_SLOTS) {
    const claimed = globalSlots[slot] as ComposableDispatcher | undefined;
    if (
        !claimed ||
        typeof claimed.compose !== 'function' ||
        wrappedDispatchers.has(claimed)
    )
        continue;
    const wrapped = claimed.compose(withOutboundTimeouts);
    wrappedDispatchers.add(wrapped);
    globalSlots[slot] = wrapped;
}

export {};
