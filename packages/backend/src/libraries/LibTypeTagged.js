const { whatis } = require("../util/langutil");

class LibTypeTagged extends use.Library {
    process (o) {
        const could_be = whatis(o) === 'object' || Array.isArray(o);
        if ( ! could_be ) return {
            $: 'error',
            code: 'invalid-type',
            message: 'should be object or array',
        };
        
        const intermediate = this.get_intermediate_(o);
        
        if ( ! intermediate.type ) return {
            $: 'error',
            code: 'missing-type-param',
            message: 'type parameter is missing',
        };
        
        return this.intermediate_to_standard_(intermediate);
    }
    
    intermediate_to_standard_ (intermediate) {
        const out = {};
        out.$ = intermediate.type;
        for ( const k in intermediate.meta ) {
            out['$' + k] = intermediate.meta[k];
        }
        for ( const k in intermediate.body ) {
            out[k] = intermediate.body[k];
        }
        return out;
    }
    
    get_intermediate_ (o) {
        if ( Array.isArray(o) ) {
            return this.process_array_(o);
        }
        
        if ( o['$'] === '$meta-body' ) {
            return this.process_structured_(o);
        }
        
        return this.process_standard_(o);
    }
    
    process_array_ (a) {
        if ( a.length <= 1 || a.length > 3 ) return {
            $: 'error',
            code: 'invalid-array-length',
            message: 'tag-typed arrays should have 1-3 elements',
        };
        
        const [type, body = {}, meta = {}] = a;
        
        return { $: '$', type, body, meta };
    }
    
    process_structured_ (o) {
        if ( ! o.hasOwnProperty('type') ) return {
            $: 'error',
            code: 'missing-type-property',
            message: 'missing "type" property'
        };
        
        return { $: '$', ...o };
    }
    
    process_standard_ (o) {
        const type = o.$;
        const meta = {};
        const body = {};
        
        for ( const k in o ) {
            if ( k === '$' ) continue;
            if ( k.startsWith('$') ) {
                meta[k.slice(1)] = o[k];
            } else {
                body[k] = o[k];
            }
        }
        
        return { $: '$', type, meta, body };
    }
}

module.exports = LibTypeTagged;