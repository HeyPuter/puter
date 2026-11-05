---
title: Build a Shopping Cart
description: "Learn how to build a shopping cart with Puter.js that keeps the right quantities across tabs and clears itself when abandoned."
tags: [kv, data-modeling]
order: 26
---

A shopping cart needs to survive a page reload, show up on the user's other
devices, and keep the right quantities even if they add things from two tabs.
With [`puter.kv`](/KV/), the whole cart can be stored in one key, with one field
per product:

```js
{
    'mug-blue': { name: 'Blue Mug', price: 1200, qty: 2 },
    'tee-m': { name: 'T-Shirt (M)', price: 2000, qty: 1 },
}
```

Each product is stored under its SKU (product code), like in [Store Items by
ID](/recipes/store-items-by-id/). Prices are in cents, so totals are always
whole numbers and you don't get results like `31.999999`.

## Add to the Cart

Adding a product saves its name and price, then adds 1 to its quantity:

```js
const member = (value) => `["${ value.replace(/["\\]/g, '\\$&') }"]`;

async function addToCart (product) {
    const item = member(product.sku);

    await puter.kv.update('cart', {
        [`${ item }.name`]: product.name,
        [`${ item }.price`]: product.price,
    }, 60 * 60 * 24 * 30);

    return await puter.kv.incr('cart', { [`${ item }.qty`]: 1 });
}
```

The `member()` helper wraps the SKU in brackets and quotes, so a SKU with a dot
in it, like `mug.blue`, isn't split into a path (see [Store a Set of Unique
Values](/recipes/store-unique-values/#store-values-with-dots-or-quotes)).

[`puter.kv.update()`](/KV/update/) creates the cart and the product if they
don't exist yet. Its third argument is a TTL in seconds, so an abandoned cart
deletes itself 30 days after the last product was added.

[`puter.kv.incr()`](/KV/incr/) adds 1 to the quantity on the server, so adding
the same product from two tabs at once gives a quantity of 2, not 1. It keeps
the cart's TTL and returns the whole cart.

## Change a Quantity

For a plus button, call `addToCart()` again. For a minus button, subtract 1 with
[`puter.kv.incr()`](/KV/incr/), and add it back if the quantity was already 0,
as in [Add Counters](/recipes/add-counters/#count-down):

```js
async function removeOne (sku) {
    const path = `${ member(sku) }.qty`;
    const cart = await puter.kv.incr('cart', { [path]: -1 });

    if ( cart[sku].qty < 0 ) {
        return await puter.kv.incr('cart', { [path]: 1 });   // it was already 0
    }
    return cart;
}
```

A product at 0 stays in the cart and is hidden when you show it. If another tab
adds the same product at that moment, removing it would throw that away too.

For a field where the user types a number, use
[`puter.kv.update()`](/KV/update/):

```js
async function setQuantity (sku, qty) {
    return await puter.kv.update('cart', { [`${ member(sku) }.qty`]: qty });
}
```

## Remove a Product

For a "Remove" button, use the [`puter.kv.remove()`](/KV/remove/) method:

```js
async function removeFromCart (sku) {
    return await puter.kv.remove('cart', member(sku));
}
```

## Show the Cart and Total

Read the cart, skip products with no quantity, and add up the total:

```js
async function loadCart () {
    const cart = await puter.kv.get('cart') ?? {};

    const lines = Object.entries(cart)
        .filter(([ , line ]) => line.qty > 0 && line.price !== undefined)
        .map(([ sku, line ]) => ({ sku, ...line }));

    const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
    return { lines, total };
}

const { lines, total } = await loadCart();
const totalText = (total / 100).toFixed(2);   // '60.00'
```

The filter also skips a product with only some of its fields, which is left
when one of the two calls in `addToCart()` fails, or when a tab changes a
product that another tab just removed.

## Check Out

The cart is stored in the user's account and written by code in their browser,
so they can change anything in it, including prices. At checkout, send only the
SKUs and quantities to your [worker](/recipes/build-an-api/), look up the real
prices there, and charge those:

```js
const API = 'https://shop-api.puter.work';

async function checkout () {
    const { lines } = await loadCart();
    const order = lines.map(({ sku, qty }) => ({ sku, qty }));

    const res = await puter.workers.exec(`${ API }/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
    });
    if ( res.ok ) {
        await puter.kv.del('cart');
    }
    return res;
}
```

Once the order goes through, deleting the key with [`puter.kv.del()`](/KV/del/)
empties the cart. [`puter.workers.exec()`](/Workers/exec/) resolves for every
status code, like `fetch()`, so check `res.ok` first.

## Full Code

```js
const API = 'https://shop-api.puter.work';

const member = (value) => `["${ value.replace(/["\\]/g, '\\$&') }"]`;

async function addToCart (product) {
    const item = member(product.sku);

    await puter.kv.update('cart', {
        [`${ item }.name`]: product.name,
        [`${ item }.price`]: product.price,
    }, 60 * 60 * 24 * 30);

    return await puter.kv.incr('cart', { [`${ item }.qty`]: 1 });
}

async function removeOne (sku) {
    const path = `${ member(sku) }.qty`;
    const cart = await puter.kv.incr('cart', { [path]: -1 });

    if ( cart[sku].qty < 0 ) {
        return await puter.kv.incr('cart', { [path]: 1 });   // it was already 0
    }
    return cart;
}

async function setQuantity (sku, qty) {
    return await puter.kv.update('cart', { [`${ member(sku) }.qty`]: qty });
}

async function removeFromCart (sku) {
    return await puter.kv.remove('cart', member(sku));
}

async function loadCart () {
    const cart = await puter.kv.get('cart') ?? {};

    const lines = Object.entries(cart)
        .filter(([ , line ]) => line.qty > 0 && line.price !== undefined)
        .map(([ sku, line ]) => ({ sku, ...line }));

    const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
    return { lines, total };
}

async function checkout () {
    const { lines } = await loadCart();
    const order = lines.map(({ sku, qty }) => ({ sku, qty }));

    const res = await puter.workers.exec(`${ API }/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
    });
    if ( res.ok ) {
        await puter.kv.del('cart');
    }
    return res;
}
```
