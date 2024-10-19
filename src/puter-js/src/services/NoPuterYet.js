import putility from "@heyputer/putility";

/**
 * Runs commands on the special `window.when_puter_happens` global, for
 * situations where the `puter` global doesn't exist soon enough.
 */
export class NoPuterYetService extends putility.concepts.Service {
    _init () {
        if ( ! window.when_puter_happens ) return;
        if ( puter && puter.env !== 'gui' ) return;

        if ( ! Array.isArray(window.when_puter_happens) ) {
            window.when_puter_happens = [window.when_puter_happens];
        }

        for ( const fn of window.when_puter_happens ) {
            fn({ context: this._.context });
        }
    }  
}
