/**
 * Options for `puter.peer.serve()` and `puter.peer.connect()`.
 *
 * @typedef {Object} PuterPeerOptions
 * @property {RTCIceServer[]} [iceServers] Custom ICE servers (STUN/TURN) to use instead of the
 * Puter-managed relays.
 * @property {boolean} [forceRelay] Route every candidate through a TURN relay.
 * @property {string} [anonToken] Take part without a Puter session. Any uuid; it identifies this
 * guest for the duration of the session and skips the sign-in prompt.
 * @property {string} [turnGrant] A grant from `puter.peer.createGuestGrant()`, letting a guest with
 * no session use the Puter-managed relays on the granting account's allowance.
 * @property {string} [name] `serve()` only: serve under a room name instead of a generated invite
 * code. Lowercase letters, digits and hyphens, 3-64 characters.
 * @property {string} [guestGrant] `serve()` only: a grant handed to guests through the signaller.
 * Renew it with `server.setGuestGrant()`.
 * @property {number} [port] Internal loopback port used by supported Puter environments.
 */

/**
 * Metadata about a peer user.
 *
 * @typedef {Object} PuterPeerUser
 * @property {string} username
 * @property {string} uuid
 */

/** @typedef {string | Blob | ArrayBuffer | ArrayBufferView} PuterPeerMessage */
/** @typedef {RTCSessionDescription | RTCSessionDescriptionInit} PuterPeerDescription */
/** @typedef {RTCIceCandidate | RTCIceCandidateInit} PuterPeerIceCandidate */

export {};
