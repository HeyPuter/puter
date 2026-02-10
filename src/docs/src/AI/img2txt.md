---
title: puter.ai.img2txt()
description: Extract text from images using OCR to read printed text, handwriting, and any text-based content.
platforms: [websites, apps, nodejs, workers]
---

Given an image, returns the text contained in the image. Also known as OCR (Optical Character Recognition), this API can be used to extract text from images of printed text, handwriting, or any other text-based content. You can choose between AWS Textract (default) or Mistral’s OCR service when you need multilingual or richer annotation output.

## Syntax

```js
puter.ai.img2txt(image, testMode = false)
puter.ai.img2txt(image, options = {})
puter.ai.img2txt({ source: image, ...options })
```

## Parameters

#### `image` / `source` (String|File|Blob) (required)

A string containing the URL or Puter path, or a `File`/`Blob` object containing the source image or file. When calling with an options object, pass it as `{ source: ... }`.

#### `testMode` (Boolean) (Optional)

A boolean indicating whether you want to use the test API. Defaults to `false`. This is useful for testing your code without using up API credits.

#### `options` (Object) (Optional)

Additional settings for the OCR request. Available options depend on the provider.

| Option | Type | Description |
|--------|------|-------------|
| `provider` | `String` | The OCR backend to use. `'aws-textract'` (default) \| `'mistral'` |
| `model` | `String` | OCR model to use (provider-specific) |
| `testMode` | `Boolean` | When `true`, returns a sample response without using credits. Defaults to `false` |

#### AWS Textract Options

Available when `provider: 'aws-textract'` (default):

| Option | Type | Description |
|--------|------|-------------|
| `pages` | `Array<Number>` | Limit processing to specific page numbers (multi-page PDFs) |

For more details about each option, see the [AWS Textract documentation](https://docs.aws.amazon.com/textract/latest/dg/what-is.html).

#### Mistral Options

Available when `provider: 'mistral'`:

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Mistral OCR model to use |
| `pages` | `Array<Number>` | Specific pages to process. Starts from 0 |
| `includeImageBase64` | `Boolean` | Include image URLs in response |
| `imageLimit` | `Number` | Max images to extract |
| `imageMinSize` | `Number` | Minimum height and width of image to extract |
| `bboxAnnotationFormat` | `String` | Specify the format that the model must output for bounding-box annotations |
| `documentAnnotationFormat` | `String` | Specify the format that the model must output for document-level annotations |

For more details about each option, see the [Mistral OCR documentation](https://docs.mistral.ai/api/endpoint/ocr).

Any properties not set fall back to provider defaults.

## Return value

A `Promise` that will resolve to a string containing the text contained in the image.

In case of an error, the `Promise` will reject with an error message.

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
