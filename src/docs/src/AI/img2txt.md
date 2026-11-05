---
title: puter.ai.img2txt()
description: Extract text from images and documents using OCR to read printed text, handwriting, and any text-based content.
platforms: [websites, apps, nodejs, workers]
---

Given an image or document, returns the text it contains.

Also known as OCR (Optical Character Recognition), this API can be used to extract text from images of printed text, handwriting, or any other text-based content. AWS Textract is the default; Mistral OCR reads multi-page documents and more file formats, returns Markdown, and can fill a JSON schema from the document.

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
| `model` | `String` | The OCR model to use. See [Model-specific features](#model-specific-features) for the models. The model picks its provider, so `provider` is not needed alongside it. Lookups are case-insensitive. |
| `provider` | `String` | Either `'aws-textract'` (default) or `'mistral'`. Aliases `'aws'`, `'textract'` and `'mistral-ocr'` are also accepted. Without a `model`, the provider's default model runs. When both are given, the model must belong to the provider. |
| `testMode` | `Boolean` | When `true`, returns a sample response without using credits. Defaults to `false` |

Some models accept additional options or handle these options differently. See [Model-specific features](#model-specific-features).

## Return value

A `Promise` that resolves to a string, the recognized text, one line per line. The text's format depends on the model, and some model options change what the string holds. See [Model-specific features](#model-specific-features).

The return shape is the same for every model.

## Errors

A rejection carries the error body as the backend sent it: `{ message, code }`.

| Code | Meaning |
| --- | --- |
| `arguments_required`, `source_required` | Raised by the SDK before any request is made: the call had no arguments, or no source. |
| `input_too_large` | Raised by the SDK before any request is made: a `File`, `Blob` or data URI input exceeds the selected model's limit. |
| `input_too_large` | The input is larger than the model accepts (HTTP 413). |
| `bad_request` | The provider or model is unknown or retired, the model does not belong to the named provider, an option is invalid, or Textract cannot read the document. |
| `insufficient_funds` | Your balance cannot cover the whole document, checked before the provider runs. Arrives as HTTP 402. See [OCR limits](/rate-limits-and-quotas#ocr) for how pages are counted. |

Other `upstream_*` codes mean the provider rejected the request or was unavailable; the `message` carries the provider's reason.

## Input limits

Each model accepts its own formats and sizes, listed in its section under [Model-specific features](#model-specific-features). The SDK checks the decoded size of a data URI against the selected model's limit before upload. When neither `model` nor `provider` is specified, it checks against the default model's limit. URLs and Puter paths are limited by the backend. An input over the limit fails with `input_too_large`.

## Model-specific features

### AWS Textract models

The model is `aws-textract` (alias `textract`), the default for every call. It returns plain text, one line per detected line.

AWS Textract reads JPEG, PNG, TIFF, and **single-page** PDF, up to 10 MB. It rejects multi-page PDFs and other formats with `bad_request`. Use a Mistral model for those.

AWS Textract takes no options beyond `model` and `provider`. It reads a single-page document as a whole, so there is nothing to select or tune; the Mistral options below are ignored.

### Mistral models

The default Mistral model is `mistral-ocr-latest` (aliases `mistral-ocr-4`, `mistral-ocr-4-1`), which is Mistral OCR 4.1. It stays on OCR 4.1 and moves to a newer model only when Puter adds it. Mistral OCR 3 is `mistral-ocr-2512` (aliases `mistral-ocr-3`, `mistral-ocr-3-0`), at a lower per-page rate than OCR 4. Both return Markdown.

Mistral reads PDF (up to 1,000 pages), images (JPEG, PNG, AVIF, TIFF, GIF, HEIC, BMP, WebP), and documents such as DOCX, PPTX, XLSX, EPUB and RTF, up to 50 MB. The SDK checks a data URI against 36 MB, because a data URI is a third larger than the file and a request body is capped at 50 MB. Select a Mistral model or provider to send a data URI over 10 MB, since without either the SDK checks against AWS Textract's limit.

| Option | Type | Description |
|--------|------|-------------|
| `pages` | `Array<Number>` | Pages to process, as 0-based indexes |
| `includeImageBase64` | `Boolean` | Include extracted images in the provider response |
| `imageLimit` | `Number` | Maximum number of images to extract |
| `imageMinSize` | `Number` | Minimum height and width of an image to extract |
| `tableFormat` | `String` | Either `'markdown'` or `'html'`: extract tables in that format instead of leaving them inline |
| `extractHeader` | `Boolean` | Move page headers out of the returned text |
| `extractFooter` | `Boolean` | Move page footers out of the returned text |
| `documentAnnotationFormat` | `Object` | A JSON schema for a document-level annotation: `{ type: 'json_schema', json_schema: { name, schema } }`. When set, `img2txt()` resolves to the annotation instead of the text, as JSON that follows your schema. Billed per page on top of OCR. |
| `documentAnnotationPrompt` | `String` | Instructions that guide the document annotation |
| `bboxAnnotationFormat` | `Object` | A JSON schema, in the same shape, for annotating each extracted image. Billed per page on top of OCR. |

In both annotation formats, `json_schema` may also be spelled `jsonSchema` and `schema` may be spelled `schemaDefinition`. Any other shape is rejected with `bad_request` before anything is billed.

For more details about each option, see the [Mistral OCR documentation](https://docs.mistral.ai/api/endpoint/ocr).

## Examples

### Extract the text contained in an image

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

### Read the same image with Mistral OCR

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

### Extract structured data with a document annotation

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
