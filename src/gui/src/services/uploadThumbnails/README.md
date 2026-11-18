# Upload thumbnails

Create one `createUploadThumbnailGenerator()` callback per GUI upload. The SDK
passes a built-in image generator and preparation cancellation signal as the
callback's second argument. Files that are not PDFs, PSDs, Office documents or
videos delegate to that image generator; when the running SDK predates the callback
context (it then passes only the file), the GUI's bundled copy of the SDK image
generator is used instead, so image thumbnails do not depend on deploy order.

## PSD

Photoshop stores a small JPEG preview in the image resources near the start of
a PSD or PSB. `psd.js` walks those resources, seeking past each one's data, and
hands the preview to the image generator above, which scales it like any other
image. Nothing is rendered, so a document of any size costs a few small reads
and needs no worker or extra assets.

Other editors often save no preview. `psd.js` then scales down the merged image
stored after the layers, raw or RLE-compressed, into a BMP of at most 256 pixels
a side for the same image generator. It reads only the rows that BMP samples, so
the cost follows the document's width, not its size. Transparency is flattened
onto white. Documents that are not RGB or grayscale at 8 or 16 bits per channel,
and documents wide enough to exceed the read budget, retain their normal icon.

## Word documents

A DOCX is a ZIP archive of XML parts. `ooxml.js` lists the archive from the
directory at its end, and `docx.js` inflates only the parts it needs. Some
editors store a JPEG of the first page in the archive; when it is there, it goes
to the image generator as it is.

Otherwise `docx.js` reads the main part up to the first page break and
`page.js` draws that page on a canvas of at most 256 pixels a side: paragraphs
with their font size, weight, color, alignment, indent and spacing, taken from
the document's styles and direct formatting, table cells side by side, and
pictures at their stated size. Text wraps to the page's width and margins, and
paragraphs that start with a right-to-left letter are laid out from the right.
The result is a likeness of the page, not a rendering of it: every font is drawn
as the browser's sans-serif, and headers, footers, borders, shading and floating
positions are not drawn.

`doc.js` reads a Word 97-2003 document, an OLE compound file, by following the
sector chains of its main and table streams to the text. It draws the text alone
on a US Letter page; the format's binary formatting is not read.

Both readers are tried on every Word file, because a `.doc` is sometimes a DOCX
and the reverse; each reader checks the file's signature first. Encrypted
documents, and documents whose first page is blank, retain their normal icon.

## Spreadsheets

An XLSX is the same kind of archive, and a stored first-page JPEG is used the
same way. Otherwise `xlsx.js` reads the first visible worksheet and draws the
480 points at its top-left corner on a square canvas: gridlines, the sheet's
column widths and row heights, each cell's fill, and each cell's text in its
font size, weight, color and alignment. Text aligned left runs on over the empty
cells beside it. Colors come from the cell formats, directly or through the
workbook's theme. Numbers are drawn as stored, so a date shows as its serial
number; number formats, merged cells, borders, charts and pictures are not
drawn. A sheet with nothing in view retains its normal icon.

Office documents are read on the desktop thread, in a few milliseconds each. An
upload reads them one at a time, and the ones still queued when its preparation
deadline passes retain their normal icon.

## Videos

`video.js` loads an MP4, MOV, M4V or WebM file into a detached `<video>`
element, seeks a tenth of the way in (at most 10 seconds), and draws that frame
on a canvas of at most 256 pixels a side. The browser's player does the
demuxing and decoding, reading only the parts of the file it needs, so the cost
does not grow with the file. A video the browser can't play, a file with only
sound, and a video that takes longer than its time limit retain their normal
icon. An upload loads one video at a time, under a preparation deadline of its
own. The page's CSP must allow `blob:` in `media-src`.

## PDF

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

## Budgets and tests

All budgets are published in the developer docs' rate-limits-and-quotas page.

Run `npm test -- src/services/uploadThumbnails` from `src/gui` for scheduling tests
and Chromium rendering tests (`npx playwright install chromium` if needed).
The browser tests use the same asset-copy step as production, render real PDF
fixtures, and check first-page pixels, text, rotation, image delegation, failure
recovery and termination of CPU-bound work. They also decode the thumbnails made
from a PSD fixture's preview and from a fixture's merged image, and check the
pixels of pages drawn from DOCX and DOC fixtures, of a sheet drawn from an XLSX
fixture, and of a frame taken from a video fixture. The parsers' unit tests draw on a
recording canvas, so they assert on the words and positions laid out. The SDK upload suites cover callback
compatibility and cancellation; its HTTP transport tests cover thumbnail
failure, timeout and original-file failure separately.
