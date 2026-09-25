---
title: puter.ai.img2txt()
description: Extract text from images and documents using OCR to read printed text, handwriting, and any text-based content.
platforms: [websites, apps, nodejs, workers]
---

Given an image or document, returns the text it contains. Also known as OCR (Optical Character Recognition), this API can be used to extract text from images of printed text, handwriting, or any other text-based content. AWS Textract is the default; Mistral OCR reads multi-page documents and more file formats, returns Markdown, and can fill a JSON schema from the document.

## Syntax

```js
puter.ai.img2txt(image, testMode = false)
puter.ai.img2txt(image, options = {})
puter.ai.img2txt({ source: image, ...options })
```

## Parameters

#### `image` / `source` (String|File|Blob) (required)

A string containing the URL, Puter path, or data URI, or a `File`/`Blob` object containing the source image or document. When calling with an options object, pass it as `{ source: ... }`. See [Input limits](#input-limits) for the accepted formats and sizes.

#### `testMode` (Boolean) (Optional)

A boolean indicating whether you want to use the test API. Defaults to `false`. This is useful for testing your code without using up API credits.

#### `options` (Object) (Optional)

Every call has the same shape; only the model name changes which service reads the input.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | The OCR model to use (see [Models](#models)). The model picks its provider, so `provider` is not needed alongside it. Lookups are case-insensitive. |
| `provider` | `String` | `'aws-textract'` (default) or `'mistral'`. Aliases `'aws'`, `'textract'` and `'mistral-ocr'` are also accepted. Without a `model`, the provider's default model runs. When both are given, the model must belong to the provider. |
| `testMode` | `Boolean` | When `true`, returns a sample response without using credits. Defaults to `false` |

#### Models

| Model | Provider | Notes |
|-------|----------|-------|
| `aws-textract` (alias `textract`) | AWS Textract | Default. Plain text, one line per detected line. |
| `mistral-ocr-latest` (aliases `mistral-ocr-4`, `mistral-ocr-4-1`) | Mistral | Mistral OCR 4.1, the default Mistral model. Markdown output. |
| `mistral-ocr-4-0` | Mistral | Mistral OCR 4.0. |
| `mistral-ocr-2512` (aliases `mistral-ocr-3`, `mistral-ocr-3-0`) | Mistral | Mistral OCR 3, at a lower per-page rate than OCR 4. |

`mistral-ocr-latest` is pinned to OCR 4.1 and moves to a newer model only when Puter adds it. Mistral has deprecated `mistral-ocr-2503`; Puter keeps that name as a compatibility alias for OCR 4.1. Puter rejects the deprecated `mistral-ocr-2505` with `bad_request`. Per-page prices for each model are listed by the API at `GET /metering/allCosts`.

#### AWS Textract options

AWS Textract takes no options beyond `model` and `provider`. It reads a single-page document as a whole, so there is nothing to select or tune; the Mistral options below are ignored.

#### Mistral options

These options apply to Mistral models. AWS Textract ignores them.

| Option | Type | Description |
|--------|------|-------------|
| `pages` | `Array<Number>` | Pages to process, as 0-based indexes |
| `includeImageBase64` | `Boolean` | Include extracted images in the provider response |
| `imageLimit` | `Number` | Maximum number of images to extract |
| `imageMinSize` | `Number` | Minimum height and width of an image to extract |
| `tableFormat` | `String` | `'markdown'` or `'html'`: extract tables in that format instead of leaving them inline |
| `extractHeader` | `Boolean` | Move page headers out of the returned text |
| `extractFooter` | `Boolean` | Move page footers out of the returned text |
| `documentAnnotationFormat` | `Object` | A JSON schema for a document-level annotation: `{ type: 'json_schema', json_schema: { name, schema } }`. When set, `img2txt()` resolves to the annotation instead of the text. Billed per page on top of OCR. |
| `documentAnnotationPrompt` | `String` | Instructions that guide the document annotation |
| `bboxAnnotationFormat` | `Object` | A JSON schema, in the same shape, for annotating each extracted image. Billed per page on top of OCR. |

In both annotation formats, `json_schema` may also be spelled `jsonSchema` and `schema` may be spelled `schemaDefinition`. Any other shape is rejected with `bad_request` before anything is billed.

For more details about each option, see the [Mistral OCR documentation](https://docs.mistral.ai/api/endpoint/ocr).

#### Input limits

| Model | Formats | Maximum size |
|-------|---------|--------------|
| AWS Textract | JPEG, PNG, TIFF, and **single-page** PDF | 10 MB |
| Mistral | PDF (up to 1,000 pages), images (JPEG, PNG, AVIF, TIFF, GIF, HEIC, BMP, WebP), and documents such as DOCX, PPTX, XLSX, EPUB and RTF | 50 MB |

The SDK checks the decoded size of data URI inputs against the selected model's limit before upload: 10 MB for Textract and 36 MB when a Mistral model or provider is specified (a data URI is a third larger than the file, and a request body is capped at 50 MB). URLs and Puter paths are limited by the backend. When neither model nor provider is specified, the SDK checks against 10 MB; explicitly select Mistral for larger inline inputs. SDK size failures use `input_too_large`; backend size failures use `storage_limit_reached`. Textract rejects multi-page PDFs and other formats with `bad_request`; use a Mistral model for those.

## Return value

A `Promise` that resolves to a string.

- By default the string is the recognized text, one line per line: plain text from AWS Textract, Markdown from Mistral.
- When `documentAnnotationFormat` is set, the string is the document annotation: JSON that follows your schema.

The return shape is the same for every model.

## Errors

A rejection carries the error body as the backend sent it: `{ message, code }`.

| Code | Meaning |
| --- | --- |
| `arguments_required`, `source_required` | Raised by the SDK before any request is made: the call had no arguments, or no source. |
| `input_too_large` | Raised by the SDK before any request is made: a `File`, `Blob` or data URI input exceeds the selected model's limit. |
| `storage_limit_reached` | The input is larger than the model accepts (HTTP 413). |
| `bad_request` | The provider or model is unknown or retired, the model does not belong to the named provider, an option is invalid, or Textract cannot read the document. |
| `insufficient_funds` | Your balance cannot cover the first page. Arrives as HTTP 402. |

Other `upstream_*` codes mean the provider rejected the request or was unavailable; the `message` carries the provider's reason.

## Examples

<strong class="example-title">Extract the text contained in an image</strong>

```html;ai-img2txt
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.img2txt('https://assets.puter.site/letter.png').then(puter.print);
    </script>
</body>
</html>
```

<strong class="example-title">Read the same image with Mistral OCR</strong>

```html;ai-img2txt-mistral
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Only the model name changes; the result is still a string.
        puter.ai.img2txt('https://assets.puter.site/letter.png', { model: 'mistral-ocr-latest' })
            .then(puter.print);
    </script>
</body>
</html>
```

<strong class="example-title">Extract structured data with a document annotation</strong>

```html;ai-img2txt-annotation
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const annotation = await puter.ai.img2txt('https://assets.puter.site/letter.png', {
                model: 'mistral-ocr-latest',
                documentAnnotationFormat: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'letter',
                        schema: {
                            type: 'object',
                            properties: {
                                greeting: { type: 'string' },
                                signature: { type: 'string' },
                            },
                            required: ['greeting', 'signature'],
                        },
                    },
                },
            });
            puter.print(JSON.parse(annotation).signature);
        })();
    </script>
</body>
</html>
```
