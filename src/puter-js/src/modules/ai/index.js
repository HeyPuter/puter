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
 * The `puter.ai` module. Holds a reference to the owning Puter instance and
 * reads auth state from it live — nothing is copied out, so token and origin
 * changes on the instance apply to in-flight modules immediately.
 *
 * Method implementations live in the sibling files as `this`-context
 * functions whose JSDoc (including the per-form `@overload` declarations) is
 * the source of truth for the public signatures; types/modules/ai.d.ts
 * mirrors them for TypeScript consumers of the published SDK.
 */
export class AIModule {
    /** @type {Puter} */
    puter;

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
        this.puter = puter;

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

    // Kept for backward compatibility: these used to be copied fields kept
    // in sync by set{AuthToken,APIOrigin}; they now read through live.
    get authToken() {
        return this.puter.authToken;
    }

    get APIOrigin() {
        return this.puter.APIOrigin;
    }

    get appID() {
        return this.puter.appID;
    }

    // No-ops: auth state is read from the Puter instance at call time. The
    // module registry still invokes these on token/origin changes.
    setAuthToken() {}

    setAPIOrigin() {}
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
