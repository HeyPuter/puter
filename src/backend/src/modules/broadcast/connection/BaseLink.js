const { AdvancedBase } = require("@heyputer/putility");
const { ChannelFeature } = require("../../../traits/ChannelFeature");

class BaseLink extends AdvancedBase {
    static FEATURES = [
        new ChannelFeature(),
    ];
    static CHANNELS = ['message'];

    static MODULES = {
        crypto: require('crypto'),
    };

    static AUTHENTICATING = {};
    static ONLINE = {};
    static OFFLINE = {};

    send (data) {
        if ( this.state !== this.constructor.ONLINE ) {
            return false;
        }

        return this._send(data);
    }

    constructor () {
        super();
        this.state = this.constructor.AUTHENTICATING;
    }
}

module.exports = {
    BaseLink,
};
