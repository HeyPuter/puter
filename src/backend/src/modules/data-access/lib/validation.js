import validator from 'validator';
import APIError from '../../../api/APIError.js';

/**
 * Validates a string value with optional maxlen and regex constraints.
 * @param {string} value - The value to validate
 * @param {object} meta - Metadata for the validation
 * @param {string} meta.key - The field name (for error messages)
 * @param {number} [meta.maxlen] - Maximum length allowed
 * @param {RegExp} [meta.regex] - Regex pattern the string must match
 */
export const validate_string = (value, { key, maxlen, regex }) => {
    if ( typeof value !== 'string' ) {
        throw APIError.create('field_invalid', null, { key });
    }
    if ( maxlen !== undefined && value.length > maxlen ) {
        throw APIError.create('field_too_long', null, { key, max_length: maxlen });
    }
    if ( regex !== undefined && !regex.test(value) ) {
        throw APIError.create('field_invalid', null, { key });
    }
};

/**
 * Validates an image-base64 value (data URL for images).
 * Checks for proper prefix and XSS characters.
 * @param {string} value - The value to validate
 * @param {object} meta - Metadata for the validation
 * @param {string} meta.key - The field name (for error messages)
 */
export const validate_image_base64 = (value, { key }) => {
    if ( typeof value !== 'string' ) {
        throw APIError.create('field_invalid', null, { key });
    }
    if ( ! value.startsWith('data:image/') ) {
        throw APIError.create('field_invalid', null, { key });
    }
    // XSS character check from image-base64 prop type
    const xss_chars = ['<', '>', '&', '"', "'", '`'];
    if ( xss_chars.some(char => value.includes(char)) ) {
        throw APIError.create('field_invalid', null, { key });
    }
};

/**
 * Validates a URL value with optional maxlen constraint.
 * Uses the validator library, allowing localhost.
 * @param {string} value - The value to validate
 * @param {object} meta - Metadata for the validation
 * @param {string} meta.key - The field name (for error messages)
 * @param {number} [meta.maxlen] - Maximum length allowed
 */
export const validate_url = (value, { key, maxlen }) => {
    if ( typeof value !== 'string' ) {
        throw APIError.create('field_invalid', null, { key });
    }
    if ( maxlen !== undefined && value.length > maxlen ) {
        throw APIError.create('field_too_long', null, { key, max_length: maxlen });
    }
    // URL validation using validator library (same as url prop type)
    let valid = validator.isURL(value);
    if ( ! valid ) {
        valid = validator.isURL(value, { host_whitelist: ['localhost'] });
    }
    if ( ! valid ) {
        throw APIError.create('field_invalid', null, { key });
    }
};

/**
 * Validates a JSON value (must be an object or array).
 * @param {*} value - The value to validate
 * @param {object} meta - Metadata for the validation
 * @param {string} meta.key - The field name (for error messages)
 */
export const validate_json = (value, { key }) => {
    if ( typeof value !== 'object' ) {
        throw APIError.create('field_invalid', null, { key });
    }
};

/**
 * Validates an array where each element is a string.
 * @param {*} value - The value to validate
 * @param {object} meta - Metadata for the validation
 * @param {string} meta.key - The field name (for error messages)
 */
export const validate_array_of_strings = (value, { key }) => {
    if ( ! Array.isArray(value) ) {
        throw APIError.create('field_invalid', null, { key });
    }
    for ( const item of value ) {
        if ( typeof item !== 'string' ) {
            throw APIError.create('field_invalid', null, { key });
        }
    }
};
