import putility from "@heyputer/putility";

const TeePromise = putility.libs.promise.TeePromise;

/**
 * Manages message events from the window object.
 */
export class XDIncomingService extends putility.concepts.Service {
    _construct () {
        this.filter_listeners_ = [];
        this.tagged_listeners_ = {};
    }

    _init () {
        window.addEventListener('message', async event => {
            for ( const fn of this.filter_listeners_ ) {
                const tp = new TeePromise();
                fn(event, tp);
                if ( await tp ) return;
            }
        });
    }

    register_filter_listener (fn) {
        this.filter_listeners_.push(fn);
    }
}
