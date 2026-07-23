import * as utils from '../../lib/utils.js';
import { isBlobLike, isPlainObject } from './lib/args.js';

/** @typedef {import('../../../types/modules/ai').Img2TxtOptions} Img2TxtOptions */

/**
 * The recognition result shapes the OCR drivers return.
 * @typedef {{
 *     blocks?: { type?: string, text?: string }[],
 *     pages?: { markdown?: string }[],
 *     document_annotation?: string,
 *     text?: string,
 * }} OcrResult
 */

const MAX_INPUT_SIZE = 10 * 1024 * 1024;

const normalizeProvider = (value) => {
    if ( ! value ) return 'aws-textract';
    const normalized = String(value).toLowerCase();
    if ( ['aws', 'textract', 'aws-textract'].includes(normalized) ) return 'aws-textract';
    if ( ['mistral', 'mistral-ocr'].includes(normalized) ) return 'mistral';
    return 'aws-textract';
};

/**
 * Reduce the provider-specific recognition result to plain text.
 * @param {OcrResult | null | undefined} result
 * @returns {string}
 */
const toText = (result) => {
    if ( ! result ) return '';
    if ( Array.isArray(result.blocks) && result.blocks.length ) {
        let str = '';
        for ( const block of result.blocks ) {
            if ( typeof block?.text !== 'string' ) continue;
            if ( !block.type || block.type === 'text/textract:LINE' || block.type.startsWith('text/') ) {
                str += `${block.text }\n`;
            }
        }
        if ( str.trim() ) return str;
    }
    if ( Array.isArray(result.pages) && result.pages.length ) {
        const markdown = result.pages
            .map(page => (page?.markdown || '').trim())
            .filter(Boolean)
            .join('\n\n');
        if ( markdown.trim() ) return markdown;
    }
    if ( typeof result.document_annotation === 'string' ) {
        return result.document_annotation;
    }
    if ( typeof result.text === 'string' ) {
        return result.text;
    }
    return '';
};

/**
 * @overload
 * @param {string | File | Blob} source
 * @param {boolean} [testMode]
 * @returns {Promise<string>}
 */
/**
 * @overload
 * @param {string | File | Blob} source
 * @param {Img2TxtOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<string>}
 */
/**
 * @overload
 * @param {Img2TxtOptions} options
 * @param {boolean} [testMode]
 * @returns {Promise<string>}
 */
/**
 * Documented forms:
 *   img2txt(source, [testMode])
 *   img2txt(source, [options], [testMode])
 *   img2txt({ source, provider, testMode, ... }, [testMode])
 *
 * @this {import('./index.js').AIModule}
 * @param {string | File | Blob | Img2TxtOptions} [sourceOrOptions]
 * @param {Img2TxtOptions | boolean} [optionsOrTestMode]
 * @param {boolean | Img2TxtOptions} [testModeOrOptions]
 * @returns {Promise<string>}
 */
export async function img2txt (sourceOrOptions, optionsOrTestMode, testModeOrOptions) {
    const { puter } = this;
    if ( sourceOrOptions === undefined && optionsOrTestMode === undefined && testModeOrOptions === undefined ) {
        throw { message: 'Arguments are required', code: 'arguments_required' };
    }

    /** @type {Img2TxtOptions} */
    let options = {};
    if ( isPlainObject(sourceOrOptions) ) {
        options = { ...sourceOrOptions };
    } else {
        options.source = sourceOrOptions;
    }

    let testMode = false;
    for ( const value of [optionsOrTestMode, testModeOrOptions] ) {
        if ( typeof value === 'boolean' ) {
            testMode = testMode || value;
        } else if ( isPlainObject(value) ) {
            options = { ...options, ...value };
        }
    }

    if ( typeof options.testMode === 'boolean' ) {
        testMode = options.testMode;
    }

    const provider = normalizeProvider(options.provider);
    delete options.provider;
    delete options.testMode;

    if ( ! options.source ) {
        throw { message: 'Source is required', code: 'source_required' };
    }

    if ( isBlobLike(options.source) ) {
        options.source = await utils.blobToDataUri(options.source);
    } else if ( options.source?.source && isBlobLike(options.source.source) ) {
        // Support shape { source: Blob }
        options.source = await utils.blobToDataUri(options.source.source);
    }

    if ( typeof options.source === 'string' &&
        options.source.startsWith('data:') &&
        options.source.length > MAX_INPUT_SIZE ) {
        throw { message: `Input size cannot be larger than ${ MAX_INPUT_SIZE}`, code: 'input_too_large' };
    }

    return await utils.make_driver_method(['source'], 'puter-ocr', provider, 'recognize', {
        puter,
        test_mode: testMode ?? false,
        transform: async (result) => toText(result),
    })(options);
}
