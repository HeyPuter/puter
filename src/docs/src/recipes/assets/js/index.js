import hljs from 'highlight.js';
import 'highlight.js/styles/default.css';
import '@fontsource/inter';

// Reuse the docs' code-block handlers rather than duplicating the clipboard
// logic. Its .example-group and `pathchange` code is inert here — recipe pages
// have neither those elements nor the insta-load router.
import '../../../assets/js/example.js';

import './filter.js';

window.hljs = hljs;
