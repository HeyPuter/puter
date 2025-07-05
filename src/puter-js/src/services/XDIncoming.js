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
        globalThis.addEventListener('message', async event => {
            for ( const fn of this.filter_listeners_ ) {
                const tp = new TeePromise();
                fn(event, tp);
                if ( await tp ) return;
            }

            const data = event.data;

            const tag = data.$;
            if ( ! tag ) return;
            if ( ! this.tagged_listeners_[tag] ) return;

            for ( const fn of this.tagged_listeners_[tag] ) {
                fn({ data, source: event.source });
            }
        });
    }

    register_filter_listener (fn) {
        this.filter_listeners_.push(fn);
    }

    register_tagged_listener (tag, fn) {
        if ( ! this.tagged_listeners_[tag] ) {
            this.tagged_listeners_[tag] = [];
        }
        this.tagged_listeners_[tag].push(fn);
    }
}
