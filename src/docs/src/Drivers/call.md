A low-level function that allows you to call any driver on any interface. This function is useful when you want to call a driver that is not directly exposed by Puter.js's high-level API or for when you need more control over the driver call.

## Syntax
```js
puter.drivers.call(interface, driver, method)
puter.drivers.call(interface, driver, method, args = {})
```

## Parameters
#### `interface` (String) (Required)
The name of the interface you want to call.

#### `driver` (String) (Required)
The name of the driver you want to call.

#### `method` (String) (Required)
The name of the method you want to call on the driver.

#### `args` (Array) (Optional)
An object containing the arguments you want to pass to the driver.

## Return value

A `Promise` that will resolve to the result of the driver call. The result can be of any type, depending on the driver you are calling.

In case of an error, the `Promise` will reject with an error message.
