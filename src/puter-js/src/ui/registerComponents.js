/**
 * registerComponents - Auto-registers all Puter web components.
 * Called during SDK initialization in index.js.
 */

import PuterAlert from './components/PuterAlert.js';
import PuterPrompt from './components/PuterPrompt.js';
import PuterNotification from './components/PuterNotification.js';
import PuterContextMenu from './components/PuterContextMenu.js';
import PuterSpinner from './components/PuterSpinner.js';

const components = [
    ['puter-alert', PuterAlert],
    ['puter-prompt', PuterPrompt],
    ['puter-notification', PuterNotification],
    ['puter-context-menu', PuterContextMenu],
    ['puter-spinner', PuterSpinner],
];

export function registerComponents () {
    if ( typeof globalThis.HTMLElement === 'undefined' || !globalThis.customElements ) {
        return;
    }

    for ( const [tag, cls] of components ) {
        if ( ! customElements.get(tag) ) {
            customElements.define(tag, cls);
        }
    }
}

export default registerComponents;
