// Small, deterministic PDFs with real cross-reference tables, generated without a PDF library.
import { deflateSync } from 'node:zlib';

/**
 * A two-page PDF: a red first page with text, or with an image when `scanned`, and a blue second page. The image
 * states `imageSize` pixels a side. It holds one red pixel of data, or every pixel when `filled`.
 */
export const createPdf = ({ rotation = 0, scanned = false, imageSize = 1, filled = false } = {}) => {
    // Hex text keeps the PDF a plain string. A filled image is deflated first, so it stays small.
    const pixels = filled
        ? deflateSync(Buffer.alloc(imageSize * imageSize * 3, Buffer.from([255, 0, 0]))).toString('hex')
        : 'ff0000';
    const imageFilter = filled ? '[/ASCIIHexDecode /FlateDecode]' : '/ASCIIHexDecode';
    const content = scanned
        ? 'q 300 0 0 600 0 0 cm /Im1 Do Q'
        : '1 0 0 rg 0 0 300 600 re f BT /F1 36 Tf 1 1 1 rg 20 300 Td (Thumbnail) Tj ET';
    const stream = data => `<< /Length ${data.length} >>\nstream\n${data}\nendstream`;
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 7 0 R] /Count 2 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 600] /Rotate ${rotation} /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        stream(content),
        `<< /Type /XObject /Subtype /Image /Width ${imageSize} /Height ${imageSize} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${imageFilter} /Length ${pixels.length + 1} >>\nstream\n${pixels}>\nendstream`,
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 600] /Contents 8 0 R >>',
        stream('0 0 1 rg 0 0 300 600 re f'),
    ];
    let pdf = '%PDF-1.7\n';
    const offsets = [0];
    for ( const [index, object] of objects.entries() ) {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for ( const offset of offsets.slice(1) ) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return pdf;
};
