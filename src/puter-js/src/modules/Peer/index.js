import { fetchUrl } from '../../lib/networkUtils.js';
import { PuterModule } from '../../lib/PuterModule.js';
import { PuterPeerConnection } from './PuterPeerConnection.js';
import { PuterPeerServer } from './PuterPeerServer.js';

/** @typedef {import('../../../types/modules/peer').PuterPeerOptions} PuterPeerOptions */

export { PuterPeerServer } from './PuterPeerServer.js';
export { PuterPeerConnection } from './PuterPeerConnection.js';

class Peer extends PuterModule {
    #signallerUrl;
    #turnServers;
    #fallbackIceServers;
    #turnTTL;
    #turnStartedAt;
    #turnFailed;

    /**
     * Fetches TURN relay credentials ahead of time so connections start
     * faster. Optional — `serve()` and `connect()` call it when needed — and
     * it resolves either way: if relays can't be loaded, connecting falls back
     * to the default ICE servers.
     *
     * @returns {Promise<void>}
     */
    async ensureTurnRelays () {
        if ( this.#turnFailed ) return;
        if ( this.#turnServers && Date.now() - this.#turnStartedAt < this.#turnTTL * 1000 ) return;

        const response = await fetchUrl(`${this.APIOrigin}/peer/generate-turn`, {
            method: 'POST',
            includePuterAuth: true,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if ( ! response.ok ) {
            this.#turnFailed = true;
            return;
        }

        const { iceServers, ttl } = await response.json();
        this.#turnServers = iceServers;
        this.#turnTTL = ttl;
        this.#turnStartedAt = Date.now();
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

    async #resolvePeerConfig (options) {
        await this.#loadMetadata();
        let iceServers;
        if ( options?.iceServers ) {
            iceServers = options.iceServers;
        } else {
            await this.ensureTurnRelays();
            if ( this.#turnServers ) {
                iceServers = this.#turnServers;
            } else {
                iceServers = this.#fallbackIceServers;
                console.warn('Unable to use TURN relays. Some connections may fail.');
            }
        }

        return {
            authToken: this.authToken,
            iceServers,
            signallerUrl: this.#signallerUrl,
            forceRelay: options?.forceRelay
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

export default Peer;
