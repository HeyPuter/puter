const { config } = require("yargs");
const { whatis } = require("./langutil");

const DO_NOT_DEFINE = Symbol('DO_NOT_DEFINE');

const createTransformedValues = (input, options = {}, state = {}) => {
    // initialize state
    if ( ! state.keys ) state.keys = [];

    if ( whatis(input) === 'array' ) {
        if ( options.doNotProcessArrays ) {
            return DO_NOT_DEFINE;
        }
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
            const new_value = createTransformedValues(input[k], options);
            if ( new_value !== DO_NOT_DEFINE ) {
                output[k] = new_value;
            }
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


config.__set_config_object__(createTransformedValues(config, {
    mutateValue: (input, { state }) => {
        const path = state.keys.join('.'); // or jq
        // ....
        if ( should_replace ) {
            return 'replacement';
        } else {
            return DO_NOT_DEFINE;
        }
    }
}))


module.exports = {
    createTransformedValues,
    DO_NOT_DEFINE,
};
