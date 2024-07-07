let memoized_common_template_vars_ = null;
const get_common_template_vars = () => {
    const path_ = require('path');
    if ( memoized_common_template_vars_ !== null ) {
        return memoized_common_template_vars_;
    }

    const code_root = path_.resolve(__dirname, '../../');

    memoized_common_template_vars_ = {
        code_root,
    };

    return memoized_common_template_vars_;
}

module.exports = {
    get_common_template_vars,
};
