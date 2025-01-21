const cartesianProduct = (obj) => {
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

let obj = {
  a: [1, 2],
  b: ["a", "b"]
};

console.log(cartesianProduct(obj));

module.exports = class CoverageModel {
    constructor (spec) {
        const flat = {};

        const flatten = (object, prefix) => {
            for ( const k in object ) {
                let targetKey = k;
                if ( prefix ) {
                    targetKey = prefix + '.' + k;
                }

                let type = typeof object[k];
                if ( Array.isArray(object[k]) ) type = 'array';

                if ( type === 'object' ) {
                    flatten(object[k], targetKey);
                    continue;
                }

                if ( object[k].length == 0 ) {
                    object[k] = [false, true];
                }

                flat[targetKey] = object[k];
            }
        };
        flatten(spec);

        this.flat = flat;

        const states = cartesianProduct(flat).map(
          values => {
            const o = {};
            const keys = Object.keys(flat);
            for ( let i=0 ; i < keys.length ; i++ ) {
              o[keys[i]] = values[i];
            }
            return o;
          }
        );

        this.states = states;
        this.covered = Array(this.states.length).fill(false);
    }
}