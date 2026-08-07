import { PuterModule } from '../../lib/PuterModule.js';
import { chat } from './chat.js';
import { txt2img } from './image.js';
import { listModelProviders, listModels } from './models.js';
import { img2txt } from './ocr.js';
import { speech2speech } from './sts.js';
import { speech2txt } from './stt.js';
import { listEngines, listVoices, txt2speech } from './tts.js';
import { txt2vid } from './video.js';

/** @typedef {import('../../../types/puter').Puter} Puter */

/**
 * `txt2speech` is callable directly and carries the engine/voice listers.
 * @typedef {typeof txt2speech & {
 *     listEngines: typeof listEngines,
 *     listVoices: typeof listVoices,
 * }} Txt2Speech
 */

/**
 * The `puter.ai` module.
 *
 * Method implementations live in the sibling files as `this`-context
 * functions whose JSDoc (including the per-form `@overload` declarations) is
 * the source of truth for the public signatures; types/modules/ai.d.ts
 * mirrors them for TypeScript consumers of the published SDK.
 */
export class AIModule extends PuterModule {
    /** @type {Txt2Speech} */
    txt2speech;

    // The fields hold the unbound functions so they keep the full overloaded
    // types (`bind` erases overloads); the constructor rebinds them at
    // runtime so destructured calls (`const { chat } = puter.ai`) keep
    // working like the old arrow fields did.
    chat = chat;
    img2txt = img2txt;
    speech2txt = speech2txt;
    speech2speech = speech2speech;
    txt2img = txt2img;
    txt2vid = txt2vid;
    listModels = listModels;
    listModelProviders = listModelProviders;

    /** @param {Puter} puter */
    constructor(puter) {
        super(puter);

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of [
            'chat', 'img2txt', 'speech2txt', 'speech2speech',
            'txt2img', 'txt2vid', 'listModels', 'listModelProviders',
        ] ) {
            methods[name] = methods[name].bind(this);
        }

        this.txt2speech = /** @type {Txt2Speech} */ (/** @type {unknown} */ (
            Object.assign(txt2speech.bind(this), {
                listEngines: listEngines.bind(this),
                listVoices: listVoices.bind(this),
            })
        ));
    }
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle and the legacy `authToken` accessor omitted.
 *
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof AIModule,
 *     'puter' | 'authToken'
 * >} AIConstructor
 */

export const AI = /** @type {AIConstructor} */ (AIModule);
