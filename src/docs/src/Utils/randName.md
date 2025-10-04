A function that generates a domain-safe name by combining a random adjective, a random noun, and a random number (between 0 and 9999). The result is returned as a string with components separated by hyphens by default. You can change the separator by passing a string as the first argument to the function.

## Syntax

```js
puter.randName()
puter.randName(separator)
```

## Parameters

#### `separator` (String)
The separator to use between components. Defaults to `-`.

## Examples

<strong class="example-title">Generate a random name</strong>

<div style="position: relative;">


```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.print(puter.randName());
    </script>
</body>
</html>
```

</div>