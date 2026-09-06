# PDF upload thumbnails

Create one `createUploadThumbnailGenerator()` callback per GUI upload. The SDK
passes a built-in image generator and preparation cancellation signal as the
callback's second argument. Non-PDF files delegate to that image generator; when
the running SDK predates the callback context (it then passes only the file),
the GUI's bundled copy of the SDK image generator is used instead, so image
thumbnails do not depend on deploy order.

PDF.js and its fonts, CMaps, ICC profiles and WASM decoders are copied into the
versioned `/dist/pdf-thumbnails/` directory during the GUI build. Deploy that
directory with the GUI. `PDFJS_VERSION` must match the exact GUI dependency;
the build rejects mismatches. The SDK and initial GUI bundle contain no PDF.js.
Asset requests begin only for an eligible PDF. Bundled builds load them beside
the GUI bundle, including when it is served from a CDN; unbundled development
uses `/dist/pdf-thumbnails/` on the page's origin. A cross-origin asset host must
allow CORS for the worker, modules, fonts, CMaps, ICC profiles and WASM files.
Cross-origin builds use a local Blob module worker that imports the hosted
worker, so the page's CSP must allow `blob:` workers and imports from that host.

Each PDF gets a disposable module worker. PDF.js uses its loopback transport
inside that worker, so termination stops both parsing and rasterization. Fonts
use PDF.js's outline renderer and canvases use OffscreenCanvas. PDFs requiring
unavailable DOM rendering features, a password, or resources beyond the budgets
retain their normal icon. Empty first pages also retain their normal icon. Browsers lacking the required APIs also skip previews.
All budgets are published in the developer docs' rate-limits-and-quotas page.

Run `npm test -- src/services/pdfThumbnails` from `src/gui` for scheduling tests
and Chromium rendering tests (`npx playwright install chromium` if needed).
The browser tests use the same asset-copy step as production, render real PDF
fixtures, and check first-page pixels, text, rotation, image delegation, failure
recovery and termination of CPU-bound work. The SDK upload suites cover callback
compatibility and cancellation; its HTTP transport tests cover thumbnail
failure, timeout and original-file failure separately.
