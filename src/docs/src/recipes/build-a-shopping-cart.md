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

`member()` wraps the SKU in brackets and quotes, so a SKU with a dot in it, like
`mug.blue`, isn't split into a path (see [Store a Set of Unique
Values](/recipes/store-unique-values/#store-values-with-dots-or-quotes)).

[`puter.kv.update()`](/KV/update/) creates the cart and the product if they
don't exist yet. Its third argument sets an expiry in seconds, so an abandoned
cart deletes itself 30 days after the last product was added.

[`puter.kv.incr()`](/KV/incr/) adds 1 to the quantity on the server, so adding
the same product from two tabs at once gives a quantity of 2, not 1. It returns
the whole cart.

## Change a Quantity

For plus and minus buttons, use [`puter.kv.incr()`](/KV/incr/):

```js
await puter.kv.incr('cart', { [`${ member(sku) }.qty`]: 1 });    // plus
await puter.kv.incr('cart', { [`${ member(sku) }.qty`]: -1 });   // minus
```

For a field where the user types a number, use
[`puter.kv.update()`](/KV/update/):

```js
await puter.kv.update('cart', { [`${ member(sku) }.qty`]: Number(qtyInput.value) });
```

When the minus button takes a quantity down to 0, hide the product instead of
removing it right away. If another tab adds the same product at that moment,
removing it would throw that away too. Clean up hidden products at checkout.

## Remove a Product

For a "Remove" button, use the [`puter.kv.remove()`](/KV/remove/) method:

```js
await puter.kv.remove('cart', member(sku));
```

To empty the cart, delete the key with [`puter.kv.del()`](/KV/del/):

```js
await puter.kv.del('cart');
```

## Show the Cart and Total

Read the cart, skip anything with no quantity, and add up the total:

```js
const cart = await puter.kv.get('cart') ?? {};

const lines = Object.entries(cart)
    .filter(([ , line ]) => line.qty > 0)
    .map(([ sku, line ]) => ({ sku, ...line }));

const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
const totalText = (total / 100).toFixed(2);   // '60.00'
```

## Check Out

The cart is stored in the user's account and written by code in their browser,
so they can change anything in it, including prices. Never charge based on the
prices in the cart. At checkout, send just the SKUs and quantities to your
[worker](/recipes/build-an-api/) and look up the real prices there:

```js
const order = lines.map(({ sku, qty }) => ({ sku, qty }));

await puter.workers.exec(`${ API }/checkout`, {
    method: 'POST',
    body: JSON.stringify(order),
});
await puter.kv.del('cart');
```

## Notes

- Only `update()` with a third argument sets the expiry. `incr()`, and
  `update()` without one, keep whatever expiry the cart already has.
- If saving the name and price works but the quantity call fails, the product is
  saved without a `qty`. The filter above skips it, and the next "Add to cart"
  fixes it.
