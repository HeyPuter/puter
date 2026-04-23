// Microcents per page — Textract $1.50/1000 pages = 150,000 µ¢/page.
// Mistral OCR $1/1000 pages, annotations $3/1000 pages.
export const OCR_COSTS = {
    'aws-textract:detect-document-text:page': 150000,
    'mistral-ocr:ocr:page': 100000,
    'mistral-ocr:annotations:page': 300000,
} as const;
