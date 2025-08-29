const { whatis } = require("./langutil");

const createTransformedValues = (input, options = {}, state = {}) => {
    // initialize state
    if ( ! state.keys ) state.keys = [];

    if ( whatis(input) === 'array' ) {
        const output = [];
        for ( let i=0 ; i < input.length; i++ ) {
            const value = input[i];
            state.keys.push(i);
            output.push(createTransformedValues(value, options));
            state.keys.pop();
        }
        return output;
    }
    if ( whatis(input) === 'object' ) {
        const output = {};
        Object.setPrototypeOf(output, input);
        for ( const k in input ) {
            state.keys.push(k);
            output[k] = createTransformedValues(input[k], options);
            state.keys.pop();
        }
        return output;
    }
    let value = input;
    if ( options.mutateValue ) {
        value = options.mutateValue(value, { options, state });
    }
    return value;
};

module.exports = {
    createTransformedValues,
};
