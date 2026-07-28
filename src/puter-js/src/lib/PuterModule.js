/** @typedef {import('../../types/puter').Puter} Puter */

/**
 * Base for the `puter.*` modules. Holds the owning Puter instance and reads
 * auth state off it live, so a token or origin change is visible everywhere
 * at once and there is nothing to keep in sync.
 *
 * A module that holds a connection open (rather than reading state per call)
 * can subscribe with `puter.onAuthStateChanged()` to rebuild it.
 */
export class PuterModule {
    /** @param {Puter} puter */
    constructor (puter) {
        /** @type {Puter} */
        this.puter = puter;
    }

    /** @returns {string | null | undefined} */
    get authToken () {
        return this.puter.authToken;
    }

    /** @returns {string} */
    get APIOrigin () {
        return this.puter.APIOrigin;
    }

    /** @returns {string | undefined} */
    get appID () {
        return this.puter.appID;
    }
}
