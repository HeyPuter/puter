const { PuterFSProvider } = require("./lib/PuterFSProvider");

/**
 * This is a temporary filesystem provider implementation that will
 * proxy calls to either the new PuterFS implementation from the
 * `puterfs` extension (if the method is implemented), or to the
 * soon-to-be-legacy implementation in Puter's core otherwise.
 * 
 * Once all of the methods for PuterFS have been moved to the
 * extension, this temporary proxy provider FS Provider will be
 * removed.
 */
class TmpProxyFSProvider {
    constructor (path, puterfs) {
        this.puterfs = puterfs;
        this.legacyfs = new PuterFSProvider();

        return new Proxy(this, {
            get (target, prop, _receiver) {
                if ( prop in target.puterfs ) {
                    const value = target.puterfs[prop];
                    if ( typeof value === 'function' ) {
                        return value.bind(target.puterfs);
                    }
                    return value;
                }

                const value = target.legacyfs[prop];
                if ( typeof value === 'function' ) {
                    return value.bind(target.legacyfs);
                }
                return value;
            },
        })
    }
}

module.exports = {
    TmpProxyFSProvider,
};
