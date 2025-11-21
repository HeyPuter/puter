export const is_valid_uuid = ( uuid ) => {
    let s = `${ uuid}`;
    s = s.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    return !!s;
};

export const is_valid_uuid4 = ( uuid ) => {
    return is_valid_uuid(uuid);
};

export const is_specifically_uuidv4 = ( uuid ) => {
    let s = `${ uuid}`;

    s = s.match(/^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i);
    if ( ! s ) {
        return false;
    }
    return true;
};

export const is_valid_url = ( url ) => {
    let s = `${ url}`;

    try {
        new URL(s);
        return true;
    } catch (e) {
        return false;
    }
};

const path_excludes = () => /[\x00-\x1F]/g;

// this characters are not allowed in path names because
// they might be used to trick the user into thinking
// a filename is different from what it actually is.
const safety_excludes = [
    /[\u202A-\u202E]/, // RTL and LTR override
    /[\u200E-\u200F]/, // RTL and LTR mark
    /[\u2066-\u2069]/, // RTL and LTR isolate
    /[\u2028-\u2029]/, // line and paragraph separator
    /[\uFF01-\uFF5E]/, // fullwidth ASCII
    /[\u2060]/, // word joiner
    /[\uFEFF]/, // zero width no-break space
    /[\uFFFE-\uFFFF]/, // non-characters
];

export const is_valid_path = (path, {
    no_relative_components,
    allow_path_fragment,
} = {}) => {
    if ( typeof path !== 'string' ) return false;
    if ( path.length < 1 ) false;
    if ( path_excludes().test(path) ) return false;
    for ( const exclude of safety_excludes ) {
        if ( exclude.test(path) ) return false;
    }

    if ( ! allow_path_fragment ) {
        if ( path[0] !== '/' && path[0] !== '.' ) {
            return false;
        }
    }

    if ( no_relative_components ) {
        const components = path.split('/');
        for ( const component of components ) {
            if ( component === '' ) continue;
            const name_without_dots = component.replace(/\./g, '');
            if ( name_without_dots.length < 1 ) return false;
        }
    }

    return true;
};
