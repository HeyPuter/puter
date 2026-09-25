# PDF thumbnail fixtures

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

These fixtures contain no user documents or production credentials.
