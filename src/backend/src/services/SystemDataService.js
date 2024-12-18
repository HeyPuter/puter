// METADATA // {"ai-commented":{"service":"xai"}}
const { LLRead } = require("../filesystem/ll_operations/ll_read");
const { Context } = require("../util/context");
const { whatis } = require("../util/langutil");
const { stream_to_buffer } = require("../util/streamutil");
const BaseService = require("./BaseService");


/**
* The `SystemDataService` class extends `BaseService` to provide functionality for interpreting and dereferencing data structures.
* This service handles the recursive interpretation of complex data types including objects and arrays, as well as dereferencing
* JSON-address pointers to fetch and process data from file system nodes. It is designed to:
* - Interpret nested structures by recursively calling itself for each nested element.
* - Dereference JSON pointers, which involves reading from the filesystem, parsing JSON, and optionally selecting nested properties.
* - Manage different data types encountered during operations, ensuring proper handling or throwing errors for unrecognized types.
*/
class SystemDataService extends BaseService {
    /**
    * Recursively interprets the structure of the given data object.
    * This method handles dereferencing and deep interpretation of nested structures.
    * 
    * @param {Object|Array|string|number|boolean|null} data - The data to interpret. 
    *   Can be an object, array, or primitive value.
    * @returns {Promise<Object|Array|string|number|boolean|null>} The interpreted data.
    *   For objects and arrays, this method recursively interprets each element.
    *   For special objects with a '$' property, it performs dereferencing.
    */
    async _init () {}
    

    /**
    * Initializes the SystemDataService.
    * This method is called when the service is instantiated to set up any necessary state or resources.
    * 
    * @async
    * @returns {Promise<void>} A promise that resolves when initialization is complete.
    */
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
    

    /**
    * Recursively interprets and potentially dereferences complex data structures.
    * 
    * This method handles:
    * - Objects with special dereferencing syntax (indicated by the `$` property).
    * - Nested objects and arrays by recursively calling itself on each element.
    * 
    * @param {Object|Array|*} data - The data to interpret, which can be of any type.
    * @returns {Promise<*>} The interpreted result, which could be a primitive, object, or array.
    */
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
