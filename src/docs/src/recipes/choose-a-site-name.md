---
title: Choose a Site Name
description: "Learn how to turn what a user types into a valid Puter.js site name, explain why a name was refused, and suggest one that is free."
tags: [hosting]
order: 57
---

When your app [publishes a website](/recipes/add-website-publishing/) for a
user, the site name becomes its address, such as
`https://grace-portfolio.puter.site`. Users will type names with spaces,
capitals and emoji, pick names someone else already has, or pick a name that is
not allowed.

[`puter.hosting.create()`](/Hosting/create/) rejects in each of these cases with
an error `code` that says why. This recipe turns the user's text into a name
that is likely to work, explains a refusal in plain words, and offers names
that are free.

## Turn Text Into a Name

A site name can use lowercase letters, digits and hyphens. It cannot start or
end with a hyphen, and it can be at most 64 characters long. Turn whatever the
user typed into that shape before you call the API:

```js
function toSiteName(text) {
    return text
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')    // é -> e
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 64)
        .replace(/^-+|-+$/g, '');
}

toSiteName("Grace's Portfolio!");    // 'grace-s-portfolio'
toSiteName('Café Menu 2026');        // 'cafe-menu-2026'
```

Show the result as the user types, so they see the address they will get
before they publish. When it comes out empty, such as for a name made only of
emoji, ask them to type something else.

## Explain Why a Name Was Refused

Each refusal has its own `code`. Map the ones a user can fix to a message:

```js
const NAME_ERRORS = {
    conflict: 'That name is taken. Try another one.',
    subdomain_reserved: 'That name is reserved. Try another one.',
    bad_request: 'Use only lowercase letters, numbers and hyphens.',
    subdomain_limit_reached: 'You have reached the limit of sites for your account. Delete one to publish another.',
};

async function tryCreate(name, dir) {
    try {
        return { site: await puter.hosting.create(name, dir) };
    } catch (e) {
        const message = NAME_ERRORS[e?.code];
        if (!message) throw e;
        return { code: e.code, message };
    }
}
```

- `conflict`: someone already has the name. Names are shared by every Puter
  user, so this includes names your user has never seen.
- `subdomain_reserved`: the name is kept back, such as `www`, `api`, `blog`,
  `dev` or `test`.
- `bad_request`: the name breaks the rules above. `create()` also rejects with
  `bad_request` when the folder does not exist, so check the folder first if
  your app could pass one that is missing.
- `subdomain_limit_reached`: the account has as many sites as it is allowed.
  A different name does not help here.

Any other error is not about the name, so let it reach your normal error
handling.

## Suggest a Free Name

There is no call that checks whether a name is free.
[`puter.hosting.get()`](/Hosting/get/) is for the user's own sites, and a name
can be refused even when no site uses it, such as a reserved name. The only
reliable answer is from `create()` itself, so try to create the site and move
on to the next name when it is taken.

Start with the user's own name, then add a number, then fall back to a random
name from [`puter.randName()`](/Utils/randName/):

```js
async function createWithFreeName(wanted, dir) {
    const base = toSiteName(wanted).slice(0, 60).replace(/-+$/, '') || puter.randName();
    const candidates = [base, `${base}-2`, `${base}-3`, puter.randName()];

    for (const name of candidates) {
        const result = await tryCreate(name, dir);
        if (result.site) return result.site;
        if (result.code !== 'conflict' && result.code !== 'subdomain_reserved') {
            throw new Error(result.message);
        }
    }

    throw new Error('Could not find a free name. Try another one.');
}

const site = await createWithFreeName('Grace Portfolio', 'sites/grace');
site.subdomain;    // 'grace-portfolio', or 'grace-portfolio-2' if that was taken
```

`base` is cut to 60 characters so the `-2` and `-3` endings still fit in 64,
and any hyphen the cut leaves at the end is removed.

Only names that are taken or reserved move on to the next candidate. A name
that breaks the rules or an account at its limit would fail the same way for
every candidate, so the loop stops and shows the message.

If you would rather let the user choose, catch the first `conflict`, show
`base-2` and `base-3` as suggestions, and try the one they pick.

## Notes

- Once a site exists, its name cannot be changed. To move a site to a new
  name, create a site under the new name for the same folder, then delete the
  old one with [`puter.hosting.delete()`](/Hosting/delete/). Links to the old
  address stop working.
- A deleted name can be taken by anyone, so delete an old site only once you
  no longer need its address.
