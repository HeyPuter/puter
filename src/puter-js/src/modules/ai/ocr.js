import * as utils from '../../lib/utils.js';
import { dataUriByteLength, isBlobLike, isPlainObject } from './lib/args.js';

/** @typedef {import('./types.js').Img2TxtOptions} Img2TxtOptions */

/**
 * The recognition result shapes the OCR drivers return.
 * @typedef {{
 *     blocks?: { type?: string, text?: string }[],
 *     pages?: { markdown?: string }[],
 *     document_annotation?: string,
 *     text?: string,
 * }} OcrResult
 */

const DEFAULT_MAX_INPUT_SIZE = 10 * 1024 * 1024;
// Inline sources travel as base64 in a JSON body capped at 50 MB.
const MISTRAL_MAX_INPUT_SIZE = 36 * 1024 * 1024;

// The unified OCR driver picks the provider from `options.provider`.
const OCR_DRIVER = 'ai-ocr';

/**
 * Reduce the recognition result to a string: the requested document
 * annotation when there is one, the recognized text otherwise.
 * @param {OcrResult | null | undefined} result
 * @param {boolean} [wantsAnnotation]
 * @returns {string}
 */
const toText = (result, wantsAnnotation = false) => {
    if ( ! result ) return '';
    if ( wantsAnnotation && typeof result.document_annotation === 'string' ) {
        return result.document_annotation;
    }
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

    const requestedModel = typeof options.model === 'string' ? options.model.trim().toLowerCase() : '';
    const requestedProvider = typeof options.provider === 'string' ? options.provider.trim().toLowerCase() : '';
    const maxInputSize = requestedModel.startsWith('mistral-ocr-') ||
        (!requestedModel && ['mistral', 'mistral-ocr'].includes(requestedProvider))
        ? MISTRAL_MAX_INPUT_SIZE
        : DEFAULT_MAX_INPUT_SIZE;

    if ( typeof options.source === 'string' &&
        options.source.startsWith('data:') &&
        dataUriByteLength(options.source) > maxInputSize ) {
        throw { message: `Input size cannot be larger than ${ maxInputSize}`, code: 'input_too_large' };
    }

    return await utils.makeDriverMethod({
        iface: 'puter-ocr',
        driver: OCR_DRIVER,
        method: 'recognize',
        argNames: ['source'],
        puter,
        testMode: testMode ?? false,
        transform: async (result) => toText(result, options.documentAnnotationFormat !== undefined),
    })(options);
}
