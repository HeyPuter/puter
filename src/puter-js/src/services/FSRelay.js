import putility from '@heyputer/putility';

const example =     {
        "id": "f485f1ba-de07-422c-8c4b-c2da057d4a44",
        "uid": "f485f1ba-de07-422c-8c4b-c2da057d4a44",
        "is_dir": true,
        "immutable": true,
        "name": "FromParentWindow",
    };

export class FSRelayService extends putility.concepts.Service {
    async _init () {
        const services = this._.context.services;
        const util = this._.context.util;
        const svc_xdIncoming = services.get('xd-incoming');
        svc_xdIncoming.register_tagged_listener('puter-fs', event => {
            util.rpc.send(event.source, event.data.$callback, [example]);
        });
    }
}
