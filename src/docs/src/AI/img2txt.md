Given an image will return the text contained in the image. Also known as OCR (Optical Character Recognition), this API can be used to extract text from images of printed text, handwriting, or any other text-based content.

## Syntax
```js
puter.ai.img2txt(image, testMode = false)
```

## Parameters
#### `image` (String|File|Blob) (required)
A string containing the URL, or path (on Puter) of the image you want to recognize, or a `File` or `Blob` object containing the image. 

#### `testMode` (Boolean) (Optional)
A boolean indicating whether you want to use the test API. Defaults to `false`. This is useful for testing your code without using up API credits.

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
        puter.ai.img2txt('https://cdn.handwrytten.com/www/2020/02/home-hero-photo2%402x.png').then(puter.print);
    </script>
</body>
</html>
```
