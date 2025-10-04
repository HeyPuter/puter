Returns the storage space capacity and usage for the current user.

<div class="info">
<svg style="margin-right:15px;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="48px" height="48px" viewBox="0 0 48 48" stroke-width="2"><g stroke-width="2" transform="translate(0, 0)"><circle data-color="color-2" data-stroke="none" cx="24" cy="35" r="1" fill="#ffffff"></circle><circle cx="24" cy="24" r="22" fill="none" stroke="#fff" stroke-linecap="square" stroke-miterlimit="10" stroke-width="2" stroke-linejoin="miter"></circle><line data-color="color-2" x1="24" y1="12" x2="24" y2="28" fill="none" stroke="#ffffff" stroke-linecap="square" stroke-miterlimit="10" stroke-width="2" stroke-linejoin="miter"></line><circle data-color="color-2" cx="24" cy="35" r="1" fill="none" stroke="#ffffff" stroke-linecap="square" stroke-miterlimit="10" stroke-width="2" stroke-linejoin="miter"></circle></g></svg>
This method requires permission to access the user's storage space. If the user has not granted permission, the method will return an error.</div>

## Syntax
```js
puter.fs.space()
```

## Parameters
None.

## Return value
A `Promise` that will resolve to an object with the following properties:
- `capacity` (Number): The total amount of storage capacity available to the user, in bytes.
- `used` (Number): The amount of storage space used by the user, in bytes.


## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Retrieves the storage space capacity and usage for the current user, and prints them to the browser console
        puter.space().then((space)=>{
            console.log(space)
        });
    </script>
</body>
</html>
```