---
title: Build a Shopping Cart
description: "Learn how to keep a shopping cart in one Puter.js key-value entry, with quantities that stay correct when the user shops from two tabs and a cart that clears itself when abandoned."
tags: [kv, data-modeling]
order: 26
---

A shopping cart is a small list of products with a quantity each. It should
survive a page reload, follow the user to their phone, and count correctly when
the user clicks "Add to cart" in two tabs. With [`puter.kv`](/KV/), the whole
cart can live in one key, with one field per product:

```js
{
    'mug-blue': { name: 'Blue Mug', price: 1200, qty: 2 },
    'tee-m': { name: 'T-Shirt (M)', price: 2000, qty: 1 },
}
```

Each product is stored under its SKU (its product code), as in [Store Items by
ID](/recipes/store-items-by-id/). Prices are in cents, so totals are whole
numbers and never come out as `31.999999`.

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

Step by step:

- `member()` wraps the SKU in brackets and quotes, so a SKU with a dot in it,
  such as `mug.blue`, is saved as one name instead of being split into a path.
  [Store a Set of Unique Values](/recipes/store-unique-values/#store-values-with-dots-or-quotes)
  explains it.
- [`puter.kv.update()`](/KV/update/) creates the cart and the product's entry
  if they don't exist yet. Its third argument sets an expiry in seconds, so the
  cart deletes itself 30 days after the last product was added.
- [`puter.kv.incr()`](/KV/incr/) adds 1 to the quantity on the server. Two tabs
  adding the same product at the same moment end up with a quantity of 2, not
  1. It returns the whole cart, ready to show.

## Change a Quantity

For plus and minus buttons, add or subtract 1 with
[`puter.kv.incr()`](/KV/incr/):

```js
await puter.kv.incr('cart', { [`${ member(sku) }.qty`]: 1 });    // +
await puter.kv.incr('cart', { [`${ member(sku) }.qty`]: -1 });   // −
```

For a number field where the user types a quantity, set it with
[`puter.kv.update()`](/KV/update/):

```js
await puter.kv.update('cart', { [`${ member(sku) }.qty`]: Number(qtyInput.value) });
```

When the minus button takes a quantity to 0, leave the product in the cart and
hide it, rather than removing it right away. If another tab adds the same
product at that moment, removing it would throw that addition away too. Hidden
products are cleaned up at checkout.

## Remove a Product

For an explicit "Remove" button, delete the product with the
[`puter.kv.remove()`](/KV/remove/) method:

```js
await puter.kv.remove('cart', member(sku));
```

To empty the cart, delete the key with [`puter.kv.del()`](/KV/del/):

```js
await puter.kv.del('cart');
```

## Show the Cart and Total

Read the cart, skip products with no quantity, and add up the total:

```js
const cart = await puter.kv.get('cart') ?? {};

const lines = Object.entries(cart)
    .filter(([ , line ]) => line.qty > 0)
    .map(([ sku, line ]) => ({ sku, ...line }));

const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
const totalText = (total / 100).toFixed(2);   // '60.00'
```

## Check Out

The cart is stored in the user's account and written by code running in their
browser, so the user can change anything in it, prices included. Never charge
the price from the cart. At checkout, send only the SKUs and quantities to your
[worker](/recipes/build-an-api/), and have the worker look up the real prices:

```js
const order = lines.map(({ sku, qty }) => ({ sku, qty }));

await puter.workers.exec(`${ API }/checkout`, {
    method: 'POST',
    body: JSON.stringify(order),
});
await puter.kv.del('cart');
```

## Notes

- Only [`puter.kv.update()`](/KV/update/) with a third argument sets the
  expiry. [`puter.kv.incr()`](/KV/incr/) and `update()` without one keep the
  expiry the cart already has.
- The cart belongs to the signed-in user and your app, so it is the same cart in
  every tab and on every device they sign in from.
- If adding the name and price works but the quantity call fails, the product
  is saved without a `qty`. The filter in [Show the Cart and
  Total](#show-the-cart-and-total) skips it, and the next "Add to cart" fixes
  it.
