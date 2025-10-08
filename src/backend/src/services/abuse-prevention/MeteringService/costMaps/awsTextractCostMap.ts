// AWS Textract Cost Map (page-based pricing for OCR)
// 
// This map defines per-page pricing (in microcents) for AWS Textract OCR API.
// Pricing is based on the Detect Document Text API: $1.50 per 1,000 pages.
// Each entry is the cost per page for the specified API.
// 
// Pattern: "aws-textract:{api}:page"
// Example: "aws-textract:detect-document-text:page" → 150 microcents per page
// 
// Note: 1,000,000 microcents = $0.01 USD. $1.50 per 1,000 pages = 150 microcents per page.
//
export const AWS_TEXTRACT_COST_MAP = {
    // Detect Document Text API: $1.50 per 1,000 pages (150 microcents per page)
    "aws-textract:detect-document-text:page": 150,
};