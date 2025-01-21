/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const lib = {};

// SO: 40031688
lib.buf2hex = (buffer) => { // buffer is an ArrayBuffer
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

// Tiny inline little-endian integer library
lib.get_int = (n_bytes, array8, signed=false) => {
    return (v => signed ? v : v >>> 0)(
        array8.slice(0,n_bytes).reduce((v,e,i)=>v|=e<<8*i,0));
}
lib.to_int = (n_bytes, num) => {
    return (new Uint8Array()).map((_,i)=>(num>>8*i)&0xFF);
}

class ATStream {
    constructor ({ delegate, acc, transform, observe }) {
        this.delegate = delegate;
        if ( acc ) this.acc = acc;
        if ( transform ) this.transform = transform;
        if ( observe ) this.observe = observe;
        this.state = {};
        this.carry = [];
    }
    [Symbol.asyncIterator]() { return this; }
    async next_value_ () {
        if ( this.carry.length > 0 ) {
            return {
                value: this.carry.shift(),
                done: false,
            };
        }
        return await this.delegate.next();
    }
    async acc ({ value }) {
        return value;
    }
    async next_ () {
        for (;;) {
            const ret = await this.next_value_();
            if ( ret.done ) return ret;
            const v = await this.acc({
                state: this.state,
                value: ret.value,
                carry: v => this.carry.push(v),
            });
            if ( this.carry.length > 0 && v === undefined ) {
                throw new Error(`no value, but carry value exists`);
            }
            if ( v === undefined ) continue;
            // We have a value, clear the state!
            this.state = {};
            if ( this.transform ) {
                const new_value = await this.transform(
                    { value: ret.value });
                return { ...ret, value: new_value };
            }
            return { ...ret, value: v };
        }
    }
    async next () {
        const ret = await this.next_();
        if ( this.observe && !ret.done ) {
            this.observe(ret);
        }
        return ret;
    }
    async enqueue_ (v) {
        this.queue.push(v);
    }
}

const NewCallbackByteStream = () => {
    let listener;
    let queue = [];
    const NOOP = () => {};
    let signal = NOOP;
    (async () => {
        for (;;) {
            const v = await new Promise((rslv, rjct) => {
                listener = rslv;
            });
            queue.push(v);
            signal();
        }
    })();
    const stream = {
        [Symbol.asyncIterator](){
            return this;
        },
        async next () {
            if ( queue.length > 0 ) {
                return {
                    value: queue.shift(),
                    done: false,
                };
            }
            await new Promise(rslv => {
                signal = rslv;
            });
            signal = NOOP;
            const v = queue.shift();
            return { value: v, done: false };
        }
    };
    stream.listener = data => {
        listener(data);
    };
    return stream;
}

const NewVirtioFrameStream = byteStream => {
    return new ATStream({
        delegate: byteStream,
        async acc ({ value, carry }) {
            if ( ! this.state.buffer ) {
                if ( this.state.hold ) {
                    const old_val = value;
                    let size = this.state.hold.length + value.length;
                    value = new Uint8Array(size);
                    value.set(this.state.hold, 0);
                    value.set(old_val, this.state.hold.length);
                }
                if ( value.length < 4 ) {
                    this.state.hold = value;
                    return undefined;
                }
                const size = lib.get_int(4, value);
                // 512MiB limit in case of attempted abuse or a bug
                // (assuming this won't happen under normal conditions)
                if ( size > 512*(1024**2) ) {
                    throw new Error(`Way too much data! (${size} bytes)`);
                }
                value = value.slice(4);
                this.state.buffer = new Uint8Array(size);
                this.state.index = 0;
            }
                
            const needed = this.state.buffer.length - this.state.index;
            if ( value.length > needed ) {
                const remaining = value.slice(needed);
                console.log('we got more bytes than we needed',
                    needed,
                    remaining,
                    value.length,
                    this.state.buffer.length,
                    this.state.index,
                );
                carry(remaining);
            }
            
            const amount = Math.min(value.length, needed);
            const added = value.slice(0, amount);
            this.state.buffer.set(added, this.state.index);
            this.state.index += amount;
            
            if ( this.state.index > this.state.buffer.length ) {
                throw new Error('WUT');
            }
            if ( this.state.index == this.state.buffer.length ) {
                return this.state.buffer;
            }
        }
    });
};

const wisp_types = [
    {
        id: 3,
        label: 'CONTINUE',
        describe: ({ payload }) => {
            return `buffer: ${lib.get_int(4, payload)}B`;
        },
        getAttributes ({ payload }) {
            return {
                buffer_size: lib.get_int(4, payload),
            };
        }
    },
    {
        id: 5,
        label: 'INFO',
        describe: ({ payload }) => {
            return `v${payload[0]}.${payload[1]} ` +
                lib.buf2hex(payload.slice(2));
        },
        getAttributes ({ payload }) {
            return {
                version_major: payload[0],
                version_minor: payload[1],
                extensions: payload.slice(2),
            }
        }
    },
];

class WispPacket {
    static SEND = Symbol('SEND');
    static RECV = Symbol('RECV');
    constructor ({ data, direction, extra }) {
        this.direction = direction;
        this.data_ = data;
        this.extra = extra ?? {};
        this.types_ = {
            1: { label: 'CONNECT' },
            2: { label: 'DATA' },
            4: { label: 'CLOSE' },
        };
        for ( const item of wisp_types ) {
            this.types_[item.id] = item;
        }
    }
    get type () {
        const i_ = this.data_[0];
        return this.types_[i_];
    }
    get attributes () {
        if ( ! this.type.getAttributes ) return {};
        const attrs = {};
        Object.assign(attrs, this.type.getAttributes({
            payload: this.data_.slice(5),
        }));
        Object.assign(attrs, this.extra);
        return attrs;
    }
    toVirtioFrame () {
        const arry = new Uint8Array(this.data_.length + 4);
        arry.set(lib.to_int(4, this.data_.length), 0);
        arry.set(this.data_, 4);
        return arry;
    }
    describe () {
        return this.type.label + '(' +
            (this.type.describe?.({
                payload: this.data_.slice(5),
            }) ?? '?') + ')';
    }
    log () {
        const arrow =
            this.direction === this.constructor.SEND ? '->' :
            this.direction === this.constructor.RECV ? '<-' :
            '<>' ;
        console.groupCollapsed(`WISP ${arrow} ${this.describe()}`);
        const attrs = this.attributes;
        for ( const k in attrs ) {
            console.log(k, attrs[k]);
        }
        console.groupEnd();
    }
    reflect () {
        const reflected = new WispPacket({
            data: this.data_,
            direction:
                this.direction === this.constructor.SEND ?
                    this.constructor.RECV :
                this.direction === this.constructor.RECV ?
                    this.constructor.SEND :
                undefined,
            extra: {
                reflectedFrom: this,
            }
        });
        return reflected;
    }
}

for ( const item of wisp_types ) {
    WispPacket[item.label] = item;
}

const NewWispPacketStream = frameStream => {
    return new ATStream({
        delegate: frameStream,
        transform ({ value }) {
            return new WispPacket({
                data: value,
                direction: WispPacket.RECV,
            });
        },
        observe ({ value }) {
            value.log();
        }
    });
}

class WispClient {
    constructor ({
        packetStream,
        sendFn,
    }) {
        this.packetStream = packetStream;
        this.sendFn = sendFn;
    }
    send (packet) {
        packet.log();
        this.sendFn(packet);
    }
}

module.exports = {
    NewVirtioFrameStream,
    NewWispPacketStream,
    WispPacket,
};
