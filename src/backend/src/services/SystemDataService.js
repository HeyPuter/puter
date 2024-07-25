const { LLRead } = require("../filesystem/ll_operations/ll_read");
const { Context } = require("../util/context");
const { whatis } = require("../util/langutil");
const { stream_to_buffer } = require("../util/streamutil");
const BaseService = require("./BaseService");

class SystemDataService extends BaseService {
    async _init () {}
    
    async interpret (data) {
        if ( whatis(data) === 'object' && data.$ ) {
            return await this.dereference_(data);
        }
        if ( whatis(data) === 'object' ) {
            const new_o = {};
            for ( const k in data ) {
                new_o[k] = await this.interpret(data[k]);
            }
            return new_o;
        }
        if ( whatis(data) === 'array' ) {
            const new_a = [];
            for ( const v of data ) {
                new_a.push(await this.interpret(v));
            }
            return new_a;
        }
        return data;
    }
    
    async dereference_ (data) {
        const svc_fs = this.services.get('filesystem');
        if ( data.$ === 'json-address' ) {
            const node = await svc_fs.node(data.path);
            const ll_read = new LLRead();
            const stream = await ll_read.run({
                actor: Context.get('actor'),
                fsNode: node,
            });
            const buffer = await stream_to_buffer(stream);
            const json = buffer.toString('utf8');
            let result = JSON.parse(json);
            result = await this.interpret(result);
            if ( data.selector ) {
                const parts = data.selector.split('.');
                for ( const part of parts ) {
                    result = result[part];
                }
            }
            return result;
        }
        throw new Error(`unrecognized data type: ${data.$}`);
    }
}

module.exports = {
    SystemDataService,
};
