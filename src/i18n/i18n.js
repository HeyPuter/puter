import translations from './translations/translations.js';

window.ListSupportedLanugages = function () {
    var result = [];
    translations.keys.forEach(function (key) {
        result.push(translations[key]);
    });
    return result;
};

window.i18n = function (key, replacements = [], encode_html = true) {
    if(typeof replacements === 'boolean' && encode_html === undefined){
        encode_html = replacements;
        replacements = [];
    }else if(Array.isArray(replacements) === false){
        replacements = [replacements];
    }

    // if locale is not set, default to en
    if(!translations[window.locale])
        window.locale = 'en';

    let str = translations[window.locale].dictionary[key];
    
    if (!str) {
        str = key;
    }
    str = encode_html ? html_encode(str) : str;
    // replace %% occurrences with the values in replacements
    // %% is for simple text replacements
    // %strong% is for <strong> tags
    // e.g. "Hello, %strong%" => "Hello, <strong>World</strong>"
    // e.g. "Hello, %%" => "Hello, World"
    // e.g. "Hello, %strong%, %%!" => "Hello, <strong>World</strong>, Universe!"
    for (let i = 0; i < replacements.length; i++) {
        // sanitize the replacement
        replacements[i] = encode_html ? html_encode(replacements[i]) : replacements[i];
        // find first occurrence of %strong%
        let index = str.indexOf('%strong%');
        // find first occurrence of %%
        let index2 = str.indexOf('%%');
        // decide which one to replace
        if (index === -1 && index2 === -1) {
            break;
        } else if (index === -1) {
            str = str.replace('%%', replacements[i]);
        } else if (index2 === -1) {
            str = str.replace('%strong%', '<strong>' + replacements[i] + '</strong>');
        } else if (index < index2) {
            str = str.replace('%strong%', '<strong>' + replacements[i] + '</strong>');
        } else {
            str = str.replace('%%', replacements[i]);
        }
    }
    return str;
}

export default {};