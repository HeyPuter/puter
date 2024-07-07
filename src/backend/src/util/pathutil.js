const { AdvancedBase } = require("@heyputer/puter-js-common");

/**
 * PathBuilder implements the builder pattern for building paths.
 * This makes it clear which path fragments are allowed to traverse
 * to parent directories.
 */
class PathBuilder extends AdvancedBase {
    static MODULES = {
        path: require('path'),
    }

    constructor() {
        super();
        this.path_ = '';
    }

    static create () {
        return new PathBuilder();
    }

    static add (fragment, options) {
        return PathBuilder.create().add(fragment, options);
    }

    static resolve (fragment) {
        const p = PathBuilder.create();
        const require = p.require;
        const node_path = require('path');
        fragment = node_path.resolve(fragment);
        return p.add(fragment).build();
    }
    
    add (fragment, options) {
        const require = this.require;
        const node_path = require('path');

        options = options || {};
        if ( ! options.allow_traversal ) {
            fragment = node_path.normalize(fragment);
            fragment = fragment.replace(/(\.+\/|\.+\\)/g, '');
            if ( fragment === '..' ) {
                fragment = '';
            }
        }

        this.path_ = this.path_
            ? node_path.join(this.path_, fragment)
            : fragment;

        return this;
    }

    build () {
        return this.path_;
    }
}

module.exports = {
    PathBuilder,
};
