// Note: this logs AFTER all imports because imports are hoisted
logger.info('start -> async initialization');

import './util/TeePromise.js';
import './util/Component.js';
import './UI/Components/Glyph.js';

logger.info('end -> async initialization');
globalThis.init_promise.resolve();
