# Upload thumbnail fixtures

`pdf.js` builds small test PDFs with correct cross-reference offsets: a red first
page with text or an image and a blue second page. It supports page rotation and
oversized image declarations without requiring a PDF generation dependency.

`encrypted.pdf` is a blank 300 × 600 point page generated with pypdf solely for
the password-protection failure test:

```python
from pypdf import PdfWriter
writer = PdfWriter()
writer.add_blank_page(width=300, height=600)
writer.encrypt('test-only-password')
writer.write('encrypted.pdf')
```

`psd.js` builds Photoshop documents (PSD and PSB) section by section, with any
list of image resources and any merged image, stored raw or RLE-compressed. The
default document is 1 × 1 and carries a thumbnail resource holding a 160 × 80
red JPEG, encoded once with sharp.

`docx.js` builds Word documents (DOCX) as ZIP archives, deflated with Node's
zlib, from a main part's body and optional styles, media and stored thumbnail.
`doc.js` builds Word 97-2003 documents as OLE compound files, sector by sector,
with the text in one-byte or UTF-16 pieces. Both were checked against other
readers when written: `unzip -t` for the archives, and `file` and the Python
`olefile` package for the compound files.

`xlsx.js` builds spreadsheets (XLSX) the same way, from the content of a
worksheet and optional shared strings, styles and theme colors. It was checked
by loading its output with the Python `openpyxl` package.

`video.mp4` is two seconds of 160 × 80 VP9 video: black for the first tenth of a
second, then green. It was recorded in Chromium, which can play it without
proprietary codecs, from a canvas:

```js
const stream = canvas.captureStream(30);
const recorder = new MediaRecorder(stream, { mimeType: 'video/mp4;codecs=vp9', videoBitsPerSecond: 60000 });
```

`canvas.js` stands in for OffscreenCanvas in tests that run without a browser,
recording each piece of text, fill, line and image drawn.

These fixtures contain no user documents or production credentials.
