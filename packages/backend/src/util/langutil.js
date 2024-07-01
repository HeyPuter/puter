/**
 * whatis is an alterative to typeof that reports what
 * the type of the value actually is for real.
 */
const whatis = thing => {
    if ( Array.isArray(thing) ) return 'array';
    if ( thing === null ) return 'null';
    return typeof thing;
};

module.exports = {
    whatis,
};
