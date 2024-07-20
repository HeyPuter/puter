const cart_product = (obj) => {
    // Get array of keys
    let keys = Object.keys(obj);

    // Generate the Cartesian Product
    return keys.reduce((acc, key) => {
        let appendArrays = Array.isArray(obj[key]) ? obj[key] : [obj[key]];

        let newAcc = [];
        acc.forEach(arr => {
            appendArrays.forEach(item => {
                newAcc.push([...arr, item]);
            });
        });

        return newAcc;
    }, [[]]); // start with the "empty product"
}

const apply_keys = (keys, ...entries) => {
    const l = [];
    for ( const entry of entries ) {
        const o = {};
        for ( let i=0 ; i < keys.length ; i++ ) {
            o[keys[i]] = entry[i];
        }
        l.push(o);
    }
    return l;
}

module.exports = {
    cart_product,
    apply_keys,
};
