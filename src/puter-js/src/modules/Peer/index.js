import { fetchUrl } from '../../lib/networkUtils.js';
import { PuterModule } from '../../lib/PuterModule.js';
import { PuterPeerConnection } from './PuterPeerConnection.js';
import { PuterPeerServer } from './PuterPeerServer.js';

/** @typedef {import('./types.js').PuterPeerOptions} PuterPeerOptions */

export { PuterPeerServer } from './PuterPeerServer.js';
export { PuterPeerConnection } from './PuterPeerConnection.js';

export class PeerModule extends PuterModule {
    #signallerUrl;
    #turnServers;
    #fallbackIceServers;
    #turnTTL;
    #turnStartedAt;
    #turnFailed;
    #turnSource;

    /**
     * Creates a grant that lets guests without a Puter session use the
     * Puter-managed relays.
     *
     * @returns {Promise<{ grant: string, expiresAt: number }>}
     */
    async createGuestGrant () {
        const response = await fetchUrl(`${this.APIOrigin}/peer/turn-grant`, {
            method: 'POST',
            includePuterAuth: true,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if ( ! response.ok ) throw new Error('Failed to create a guest grant.');
        return await response.json();
    }

    /**
     * Fetches TURN relay credentials ahead of time so connections start
     * faster. Optional — `serve()` and `connect()` call it when needed — and
     * it resolves either way: if relays can't be loaded, connecting falls back
     * to the default ICE servers.
     *
     * @param {{ turnGrant?: string }} [options]
     * @returns {Promise<RTCIceServer[] | undefined>} the relays, if there are any
     */
    async ensureTurnRelays (options = {}) {
        // Credentials are tied to whoever is paying for them, so a change of
        // source invalidates both the cached servers and a previous failure —
        // otherwise a guest who tried before holding a grant would be stuck
        // with the fallback for the rest of the page's life.
        const source = options.turnGrant ? `grant:${options.turnGrant}` : 'session';
        if ( source !== this.#turnSource ) {
            this.#turnSource = source;
            this.#turnServers = undefined;
            this.#turnFailed = false;
        }

        if ( this.#turnFailed ) return undefined;
        if ( this.#turnServers && Date.now() - this.#turnStartedAt < this.#turnTTL * 1000 ) {
            return this.#turnServers;
        }

        try {
            const response = options.turnGrant
                ? await fetchUrl(`${this.APIOrigin}/peer/guest-turn`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ grant: options.turnGrant }),
                })
                : await fetchUrl(`${this.APIOrigin}/peer/generate-turn`, {
                    method: 'POST',
                    includePuterAuth: true,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });

            if ( ! response.ok ) {
                if ( this.#turnSource === source ) this.#turnFailed = true;
                return undefined;
            }

            const { iceServers, ttl } = await response.json();
            // Loads for two sources can overlap, and the cache holds one. The
            // credentials are still returned to whoever asked for them; only
            // the source that is current now gets to cache.
            if ( this.#turnSource === source ) {
                this.#turnServers = iceServers;
                this.#turnTTL = ttl;
                this.#turnStartedAt = Date.now();
            }
            return iceServers;
        } catch {
            // Relays are an optimisation, not a requirement: an unreachable
            // endpoint or an unreadable reply leaves the fallback to serve.
            if ( this.#turnSource === source ) this.#turnFailed = true;
            return undefined;
        }
    }

    async #loadMetadata () {
        if ( this.#signallerUrl ) return;
        const response = await fetchUrl(`${this.APIOrigin}/peer/signaller-info`);
        if ( ! response.ok ) {
            throw new Error('Failed to get signaller info from Puter.');
        }
        const { url, fallbackIce } = await response.json();
        this.#fallbackIceServers = fallbackIce;
        this.#signallerUrl = url;
    }

    async #authenticateForPeerAction (action) {
        if ( this.authToken || this.puter.env !== 'web' ) return;
        try {
            await this.puter.ui.authenticateWithPuter();
        } catch (e) {
            throw new Error(`Need authentication to ${action} but failed to authenticate with Puter.`);
        }
    }

    async #iceServersFor (options) {
        if ( options?.iceServers ) return options.iceServers;
        const iceServers = await this.ensureTurnRelays(options ?? {});
        if ( iceServers ) return iceServers;
        console.warn('Unable to use TURN relays. Some connections may fail.');
        return this.#fallbackIceServers;
    }

    async #resolvePeerConfig (options) {
        await this.#loadMetadata();
        const iceServers = await this.#iceServersFor(options);
        return {
            authToken: this.authToken,
            iceServers,
            signallerUrl: this.#signallerUrl,
            forceRelay: options?.forceRelay,
        };
    }

    /**
     * Creates a peer server and starts it, resolving to the server once it has
     * an invite code. Requires authentication.
     *
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<PuterPeerServer>}
     */
    async serve (options) {
        if ( !options?.anonToken ) await this.#authenticateForPeerAction('create a server');
        const peerConfig = await this.#resolvePeerConfig(options);
        const server = new PuterPeerServer(peerConfig);
        await server.start(options);
        return server;
    }

    /**
     * Connects to a peer server using an invite code from `serve()`, resolving
     * once the offer has been exchanged. Requires authentication.
     *
     * @param {string} invitecode
     * @param {PuterPeerOptions} [options]
     * @returns {Promise<PuterPeerConnection>}
     */
    async connect (invitecode, options) {
        if ( !options?.anonToken ) await this.#authenticateForPeerAction('connect to a server');
        const peerConfig = await this.#resolvePeerConfig(options);
        // Connecting is the impolite side: it makes the opening offer and
        // keeps it when the two ends collide.
        const conn = new PuterPeerConnection(peerConfig, { polite: false });
        await conn.connect(invitecode, options);
        return conn;
    }
}

/**
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof PeerModule,
 *     'puter' | 'authToken'
 * >} PeerConstructor
 */

export const Peer = /** @type {PeerConstructor} */ (PeerModule);

export default Peer;
