// name: 'Channel' does not behave the same as Golang's channel construct; it
//   behaves more like an EventEmitter.
class Channel {
    constructor () {
        this.listeners_ = [];
    }

    // compare(EventService): EventService has an 'on' method,
    //   but it accepts a 'selector' argument to narrow the scope of events
    on (callback) {
        // wet: EventService also creates an object like this
        const det = {
            detach: () => {
                const idx = this.listeners_.indexOf(callback);
                if ( idx !== -1 ) {
                    this.listeners_.splice(idx, 1);
                }
            }
        };

        this.listeners_.push(callback);

        return det;
    }

    emit (...a) {
        for ( const lis of this.listeners_ ) {
            lis(...a);
        }
    }
}

class ChannelFeature {
    install_in_instance (instance) {
        const channels = instance._get_merged_static_array('CHANNELS');

        instance.channels = {};
        for ( const name of channels ) {
            instance.channels[name] = new Channel(name);
        }
    }
}

module.exports = {
    ChannelFeature,
};
