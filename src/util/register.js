/**
 * register registers a class with things that need classes
 * to be registered. When in doubt, register your class.
 * 
 * More specifically this function is here to handle such
 * situations as service scripts not being able to import
 * classes when the frontend is bundled.
 * 
 * @param {*} cls 
 * @param {*} opt_name 
 */
export const register = (cls, opt_name) => {
    (async () => {
        const api = await globalThis.service_script_api_promise;
        api.exp(opt_name || cls.ID.split('.').pop(), cls);
    })()
};
