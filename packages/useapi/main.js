const globalwith = (vars, fn) => {
    const original_values = {};
    const keys = Object.keys(vars);

    for ( const key of keys ) {
        if ( key in globalThis ) {
            original_values[key] = globalThis[key];
        }
        globalThis[key] = vars[key];
    }

    try {
        return fn();
    } finally {
        for ( const key of keys ) {
            if ( key in original_values ) {
                globalThis[key] = original_values[key];
            } else {
                delete globalThis[key];
            }
        }
    }
};

const aglobalwith = async (vars, fn) => {
    const original_values = {};
    const keys = Object.keys(vars);

    for ( const key of keys ) {
        if ( key in globalThis ) {
            original_values[key] = globalThis[key];
        }
        globalThis[key] = vars[key];
    }

    try {
        return await fn();
    } finally {
        for ( const key of keys ) {
            if ( key in original_values ) {
                globalThis[key] = original_values[key];
            } else {
                delete globalThis[key];
            }
        }
    }
};

let default_fn = () => {
    const use = name => {
        const parts = name.split('.');
        let obj = use;
        for ( const part of parts ) {
            if ( ! obj[part] ) {
                obj[part] = {};
            }
            obj = obj[part];
        }

        return obj;
    };
    const library = {
        use,
        def: (name, value) => {
            const parts = name.split('.');
            let obj = use;
            for ( const part of parts.slice(0, -1) ) {
                if ( ! obj[part] ) {
                    obj[part] = {};
                }
                obj = obj[part];
            }

            obj[parts[parts.length - 1]] = value;
        },
        withuse: fn => {
            return globalwith({
                use,
                def: library.def,
            }, fn);
        },
        awithuse: async fn => {
            return await aglobalwith({
                use,
                def: library.def,
            }, fn);
        }
    };

    return library;
};

const useapi = function useapi () {
    return default_fn();
};

// We export some things on the function itself
useapi.globalwith = globalwith;

module.exports = useapi;
