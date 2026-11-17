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

These fixtures contain no user documents or production credentials.
