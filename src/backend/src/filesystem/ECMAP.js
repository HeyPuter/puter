const { Context } = require("../util/context");
const { NodeUIDSelector, NodePathSelector, NodeInternalIDSelector } = require("./node/selectors");

const LOG_PREFIX = '\x1B[31;1m[[\x1B[33;1mEC\x1B[32;1mMAP\x1B[31;1m]]\x1B[0m';

/**
 * The ECMAP class is a memoization structure used by FSNodeContext
 * whenever it is present in the execution context (AsyncLocalStorage).
 * It is assumed that this object is transient and invalidation of stale
 * entries is not necessary.
 * 
 * The name ECMAP simple means Execution Context Map, because the map
 * exists in memory at a particular frame of the execution context.
 */
class ECMAP {
    static SYMBOL = Symbol('ECMAP');
    
    constructor () {
        this.identifier = require('uuid').v4();
        
        // entry caches
        this.uuid_to_fsNodeContext = {};
        this.path_to_fsNodeContext = {};
        this.id_to_fsNodeContext = {};
        
        // identifier association caches
        this.path_to_uuid = {};
        this.uuid_to_path = {};
        
        this.unlinked = false;
    }
    
    /**
     * unlink() clears all references from this ECMAP to ensure that it will be
     * GC'd. This is called by ECMAP.arun() after the callback has resolved.
     */
    unlink () {
        this.unlink = true;
        this.uuid_to_fsNodeContext = null;
        this.path_to_fsNodeContext = null;
        this.id_to_fsNodeContext = null;
        this.path_to_uuid = null;
        this.uuid_to_path = null;
    }
    
    get logPrefix () {
        return `${LOG_PREFIX} \x1B[36[1m${this.identifier}\x1B[0m`;
    }
    
    log (...a) {
        if ( ! process.env.LOG_ECMAP ) return;
        console.log(this.logPrefix, ...a);
    }
    
    get_fsNodeContext_from_selector (selector) {
        if ( this.unlinked ) return null;

        this.log('GET', selector.describe());
        const retvalue = (() => {
            let value;
            if ( selector instanceof NodeUIDSelector ) {
                value = this.uuid_to_fsNodeContext[selector.value];
                if ( value ) return value;
                
                let maybe_path = this.uuid_to_path[value];
                if ( ! maybe_path ) return;
                value = this.path_to_fsNodeContext[maybe_path];
                if ( value ) return value;
            }
            else
            if ( selector instanceof NodePathSelector ) {
                value = this.path_to_fsNodeContext[selector.value];
                if ( value ) return value;
                
                let maybe_uid = this.path_to_uuid[value];
                value = this.uuid_to_fsNodeContext[maybe_uid];
                if ( value ) return value;
            }
        })();
        if ( retvalue ) {
            this.log('\x1B[32;1m <<<<< ECMAP HIT >>>>> \x1B[0m');
        } else {
            this.log('\x1B[31;1m <<<<< ECMAP MISS >>>>> \x1B[0m');
        }
        return retvalue;
    }
    
    store_fsNodeContext_to_selector (selector, node) {
        if ( this.unlinked ) return null;

        this.log('STORE', selector.describe());
        if ( selector instanceof NodeUIDSelector ) {
            this.uuid_to_fsNodeContext[selector.value] = node;
        }
        if ( selector instanceof NodePathSelector ) {
            this.path_to_fsNodeContext[selector.value] = node;
        }
        if ( selector instanceof NodeInternalIDSelector ) {
            this.id_to_fsNodeContext[selector.service+':'+selector.id] = node;
        }
    }
    
    store_fsNodeContext (node) {
        if ( this.unlinked ) return;

        this.store_fsNodeContext_to_selector(node.selector, node);
    }
    
    static async arun (cb) {
        let context = Context.get();
        if ( ! context.get(this.SYMBOL) ) {
            const ins = new this();
            context = context.sub({
                [this.SYMBOL]: ins,
            });
            const result = await context.arun(cb);
            ins.unlink();
            context.unlink();
            return result;
        }
        return await cb();
    }
}

module.exports = { ECMAP };
