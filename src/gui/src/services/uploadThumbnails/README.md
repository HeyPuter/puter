# Upload thumbnails

Create one `createUploadThumbnailGenerator()` callback per GUI upload. The SDK
passes a built-in image generator and preparation cancellation signal as the
callback's second argument. Files that are not PDFs, Illustrator files, PSDs,
Office documents, packaged documents, videos, HEIC photos, audio files, source
code, JSON, CSV or Markdown delegate to that image generator; when the running SDK
predates the callback context (it then passes only the file), the GUI's bundled
copy of the SDK image generator is used instead, so image thumbnails do not depend
on deploy order.

A thumbnail of a PDF, a Word document, a spreadsheet, a presentation, an iWork
file, an OpenDocument file, a source file, a JSON or CSV file, or a Markdown file
is a picture of a page.
The Files tab shows it in the grid views and shows the file's type icon in list
rows, where a page would be a blank square. `kinds.js` holds the names that make
a file a document, for the generator and for the icon helper alike.

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
cells beside it, and a sheet set to run right to left is laid out from the right
edge. Colors come from the cell formats: given directly, taken from the
workbook's theme, or picked from the standard palette. Numbers are drawn as stored, so a date shows as its serial
number; number formats, merged cells, borders, charts and pictures are not
drawn. A sheet with nothing in view retains its normal icon.

## Presentations

A PPTX is the same kind of archive again, and PowerPoint stores a first-slide
JPEG in it by default, which is used as it is. Otherwise `pptx.js` finds the
first slide the presentation lists, then the layout it builds on, that layout's
master and the master's theme, and draws the slide on a canvas of its own shape,
at most 256 pixels a side:

- the background the slide, its layout or its master gives it, a color or a
  picture;
- what the master and the layout add to every slide, under the slide's own
  shapes: everything of theirs that is not a placeholder;
- each shape's fill, for boxes and ellipses, each picture in its box, and each
  shape's text, wrapped to the box and set at its top, middle or bottom.

A placeholder that states no position takes its layout's, or else its master's,
and its text takes its size, weight, color, alignment, indent and list marker
from the same chain, ending in the master's text styles. Colors named after the
theme go through the master's map of names, so a dark deck draws dark. Groups
place their shapes through their own space. A gradient is drawn as its first
color; lines, tables, charts, shadows, rotation and shapes other than boxes and
ellipses are not drawn. A slide with nothing to draw retains its normal icon.

A thumbnail stored in the file is whatever its editor last saved there. A deck
written by a tool that copies a template can carry the template's.

Office documents are read on the desktop thread, in a few milliseconds each. An
upload reads them one at a time, and the ones still queued when its preparation
deadline passes retain their normal icon.

## Videos

`video.js` loads an MP4, MOV, M4V or WebM file into a detached `<video>`
element, seeks a tenth of the way in (at most 10 seconds), and draws that frame
on a canvas of at most 256 pixels a side. The browser's player does the
demuxing and decoding, reading only the parts of the file it needs, so the cost
does not grow with the file.

Two things are there for WebKit. The video is preloaded in full (`auto`),
because with only the metadata preloaded WebKit holds a seek back for a second.
And the frame is drawn only once the player has one: WebKit reports the seek
before it can paint the frame, and a frame drawn then is black. Chromium has the
frame when the seek ends and presents no other, so it draws at once. A video the browser can't play, a file with only
sound, and a video that takes longer than its time limit retain their normal
icon. An upload loads one video at a time, under a preparation deadline of its
own. When either deadline passes, the file in progress is given up on too. The page's CSP must allow `blob:` in `media-src`.

## PDF

An Illustrator file (`.ai`) saved with PDF compatibility, which is Illustrator's
default, starts with a PDF of the artwork and is rendered as one. One saved
without it starts as PostScript and retains its normal icon; the renderer is not
loaded for it.

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
retain their normal icon. A page's image may be up to 16 megapixels, which
covers a 300 dpi scan and a 12 megapixel photo; PDF.js scales it down to the
canvas budget to draw it. Decoding one that large takes a few hundred megabytes
for well under a second, inside the disposable worker. Empty first pages also retain their normal icon. Browsers lacking the required APIs also skip previews.

## Packaged documents

Some formats are archives that carry a picture of the document, made by the
editor that saved it. `embedded.js` lists the archive with `zip.js` and hands
that picture to the image generator as it is stored:

- Pages, Numbers and Keynote keep `preview.jpg`, about 1000 pixels across, and a
  smaller `preview-web.jpg`. Files from before 2013 keep
  `QuickLook/Thumbnail.jpg`.
- OpenDocument text, spreadsheets and presentations keep
  `Thumbnails/thumbnail.png`.
- Sketch keeps `previews/preview.png`.
- An EPUB has a cover. Its container names the package document, which says
  which of the book's files is the cover: by a property on the file in EPUB 3,
  by a `cover` entry in the metadata in EPUB 2. A book that says neither usually
  still calls its cover one, which is the last thing tried.

Nothing is rendered, so the thumbnail is the editor's own. What kind of image it
is, and how many pixels it has, comes from its own first bytes, and a picture
over 16 megapixels is passed over for the next one the file holds, since it
would be decoded at full size. A file with none of these, such as a template
or a text file with the name a Keynote file has, retains its normal icon. These
files go through the same queue as Office documents, and each picture is scaled
before the next file is opened, since a book's cover can be large and a library
is many books.

## HEIC

A HEIC or HEIF photo is an HEVC picture, or a grid of them, in a container of
boxes. Safari decodes these itself, so the image generator is given the file
first. Where that fails, `heif.js` reads the file's index (`meta`), takes the
small copy of the photo that phones store beside it, or else the photo's own
picture or tiles, and hands the coded data to the browser's `VideoDecoder`,
which uses the HEVC decoder the device has. The frames are drawn, turned and
mirrored as the photo's properties say, onto a canvas of at most 256 pixels a
side.

Nothing is decoded in script and no decoder is shipped. Whether the device can
decode the photo is asked before any of it is read, so a browser or a device
with no HEVC decoder costs one small read and the photo retains its normal icon.
That is the case in Firefox, and in Chrome on a machine whose hardware has none.
`VideoDecoder` exists only on pages served over HTTPS or from localhost.

An upload decodes one photo at a time, under a preparation deadline of its own.

## Audio

`audio.js` finds the cover art an audio file keeps with its tags and hands it to
the image generator as it is stored, a JPEG or a PNG as a rule:

- an MP3's ID3v2 tag, versions 2.2 to 2.4, in its `APIC` (or `PIC`) frame;
- a FLAC's picture block, also behind an ID3 tag put in front of the file;
- an MP4 audio file's `covr` atom, at `moov` / `udta` / `meta` / `ilst`.

The picture marked as the front cover is preferred, and the first one otherwise.
Only the tags are read: the reader steps over other frames, blocks and the audio
itself by their stated sizes, and the cover is a slice of the file that is not
read until it is decoded. What kind of image it is comes from its own first
bytes, not from the type its tag states. A tag that is unsynchronised, or a
picture that is compressed or encrypted, is left alone, and a file with no cover
retains its normal icon.

An album is many files that each hold the same cover, often a large one, so an
upload finds and scales one cover before it opens the next file, under a
preparation deadline of its own.

## Source code, JSON, CSV and Markdown

Neither kind of file has a page of its own, so `text.js` gives them one: the
shape of US Letter at well under half its size, which leaves about 24 lines of
code legible enough to tell one file from another. Only the first 16 KiB of the
file is read. Text that isn't UTF-8 is read in the Windows code page, which
Excel saves a CSV in by default. A file with a NUL in that much of it is not
text, and keeps its normal icon, as does a file with nothing but blank lines.

`code.js` draws a JavaScript or CSS file as an editor shows it: in the
browser's monospace font, a tab as four spaces, and each line running off the
right edge of the page rather than wrapping. One pattern per language picks out
the comments, strings, keywords, numbers and names, and each kind has a color.
The patterns are a likeness of the language, not a parser: a regular expression
literal is not recognized, and a CSS property is told from a selector by
whether a `;` or `}` comes before the next `{`. Adding a language is a name in
`kinds.js` and a pattern in `code.js`.

JSON is drawn the same way, with keys colored apart from the strings they hold,
and with comments, which settings files such as `tsconfig.json` hold. A JSON
file whose first line holds a comma is written on one line, as minified JSON
is, so `code.js` lays it out first as a formatter would: one member or element
to a line, two spaces in a level. That layout stops after 64 lines, more than a
page shows, and indents no deeper than 16 levels, so a file of nothing but
brackets costs no more than any other.

`csv.js` draws a CSV file as a spreadsheet opens it, through the sheet drawer
`xlsx.js` uses: gridlines, cells of the default size, numbers aligned right and
other text left. Dates, times and amounts of money count as numbers, as they do
in a spreadsheet. A number wider than its cell is drawn from its left edge, so
its leading digits show. A field in quotes may hold the delimiter, a line break
or a quote written twice, as RFC 4180 has it. The delimiter is the one a first
line such as `sep=;` names, which Excel reads and hides, or else the one of
`,`, `;`, tab and `|` that the first line holds the most of, outside quotes.
Nothing in a cell is evaluated: a formula is drawn as the text it is. A file
whose fields are all empty keeps its normal icon.

`markdown.js` turns a Markdown file into the blocks `page.js` draws: headings
sized by level, paragraphs, list items with their markers, quotes, fenced code
and tables, with bold, italic, code and link text inside them. Front matter,
comments, rules, pictures, badges and HTML tags are left out; the text between
tags is kept, an `<h1>` to `<h6>` is drawn as a heading, a `<br>` breaks the
line, and a block centered with `align` or `<center>` is drawn centered.

An upload draws and scales one of these files at a time, under a preparation
deadline shorter than the other kinds have, because a project folder holds
thousands of them. The files still queued at the deadline keep their icon
until the dashboard shows them, which makes their thumbnails then. For these
files the dashboard downloads only the 16 KiB that is read, so a large bundle
costs no more than a small script.

## Budgets and tests

All budgets are published in the developer docs' rate-limits-and-quotas page.

Run `npm test -- src/services/uploadThumbnails` from `src/gui` for scheduling tests
and Chromium rendering tests (`npx playwright install chromium` if needed).
The browser tests use the same asset-copy step as production, render real PDF
fixtures, and check first-page pixels, text, rotation, image delegation, failure
recovery and termination of CPU-bound work. They also decode the thumbnails made
from a PSD fixture's preview and from a fixture's merged image, and check the
pixels of pages drawn from DOCX and DOC fixtures, of a sheet drawn from an XLSX
fixture, of a slide drawn from a PPTX fixture, of a frame taken from a video fixture, of
covers stored in MP3, FLAC and MP4 audio fixtures, of pages drawn from JavaScript, CSS, JSON and
Markdown text, and of a sheet drawn from CSV text. The browser the suite installs has
no HEVC decoder, so there the HEIC test checks that a photo is skipped without an
error; in a browser that has one, the same test checks the decoded pixels. `heif.test.js`
covers the reader against a stand-in for the decoder. The parsers' unit tests draw on a
recording canvas, so they assert on the words and positions laid out. The SDK upload suites cover callback
compatibility and cancellation; its HTTP transport tests cover thumbnail
failure, timeout and original-file failure separately.
