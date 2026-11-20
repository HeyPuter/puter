const MAX_PINS = 50;
const MAX_DEPTH = 8;
const EDGE_LENGTH = 64;

const mix = (hash, text) => {
    for ( let i = 0; i < text.length; i++ ) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
};

/**
 * A cheap fingerprint of one message: its shape, and each string's length and
 * edges, never its full text. Cache markers move between turns, so they are
 * left out.
 *
 * @param {unknown} value
 * @param {number} [hash]
 * @param {number} [depth]
 * @returns {number}
 */
const fingerprint = (value, hash = 2166136261, depth = 0) => {
    if ( typeof value === 'string' ) {
        return mix(hash, `s${value.length}:${value.slice(0, EDGE_LENGTH)}${value.slice(-EDGE_LENGTH)}`);
    }
    if ( value === null || typeof value !== 'object' ) {
        return mix(hash, `v${String(value)}`);
    }
    if ( depth >= MAX_DEPTH ) return mix(hash, 'deep');
    if ( Array.isArray(value) ) {
        hash = mix(hash, `a${value.length}`);
        for ( const item of value ) hash = fingerprint(item, hash, depth + 1);
        return hash;
    }
    for ( const key of Object.keys(value) ) {
        if ( key === 'cache_control' ) continue;
        hash = fingerprint(value[key], mix(hash, `k${key}`), depth + 1);
    }
    return hash;
};

/**
 * Remembers which model answered after a conversation's requested model
 * declined a turn, so later turns of that conversation skip the declined
 * attempt. A conversation is the same when its messages start with the
 * declined request's messages. Kept in memory for the life of the SDK
 * instance.
 */
export class RefusalPins {
    /** @type {{ requested: unknown, model: string, prefix: number[] }[]} */
    #pins = [];

    /**
     * @param {unknown} requested The `model` the caller asked for.
     * @param {unknown[]} messages
     * @returns {string | undefined} The model to run this conversation on.
     */
    lookup (requested, messages) {
        /** @type {number[]} */
        const seen = [];
        // Newest first: a conversation that fell back twice has two pins.
        for ( let i = this.#pins.length - 1; i >= 0; i-- ) {
            const pin = this.#pins[i];
            if ( pin.requested !== requested ) continue;
            if ( pin.prefix.length > messages.length ) continue;
            const matches = pin.prefix.every((expected, index) => {
                seen[index] ??= fingerprint(messages[index]);
                return seen[index] === expected;
            });
            if ( matches ) return pin.model;
        }
        return undefined;
    }

    /**
     * @param {unknown} requested The `model` the caller asked for.
     * @param {unknown[]} messages The messages of the request that fell back.
     * @param {string} model The model that answered.
     */
    record (requested, messages, model) {
        this.#pins.push({
            requested,
            model,
            prefix: messages.map((message) => fingerprint(message)),
        });
        if ( this.#pins.length > MAX_PINS ) this.#pins.shift();
    }
}
