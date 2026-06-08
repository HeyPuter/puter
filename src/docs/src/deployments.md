---
title: Deployments
description: Deploy your Puter.js app anywhere, or host your website directly on Puter.
---

Once you've integrated Puter.js into your app, the next step is getting it online.

Puter.js is a regular JavaScript library, so your app deploys like any other website. You can ship it to any hosting platform you already use, or host it directly on [Puter](https://puter.com).

## Deploy anywhere

Because Puter.js runs entirely in the browser, there's no special backend to provision. Build your app as you normally would and serve the output from any static or web hosting provider, such as <a href="https://vercel.com" rel="nofollow">Vercel</a>, <a href="https://pages.cloudflare.com" rel="nofollow">Cloudflare Pages</a>, <a href="https://www.netlify.com" rel="nofollow">Netlify</a>, or <a href="https://pages.github.com" rel="nofollow">GitHub Pages</a>.

<div class="info">Your app should be served by a web server, like any of the hosting providers above.</div>

No extra configuration is required. Your app keeps talking to Puter's services from the browser, wherever it's hosted.

## Deploy to Puter

Puter can also host your website for you, on a free `*.puter.site` subdomain.

### Publish from puter.com

The quickest way to publish a website is to upload it on [puter.com](https://puter.com) and publish it.

<ol>
    <li>
        Right-click on the desktop and create a new folder for your website's files.
        <figure style="margin: 30px 0;">
            <img src="https://developer.puter.com/assets/img/free-hosting/create-directory.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
        </figure>
    </li>
    <li>
        Open the folder, right-click inside it, and choose <strong>Upload Here</strong> to upload your website's files (your <code>index.html</code> and any other assets).
        <figure style="margin: 30px 0;">
            <img src="https://developer.puter.com/assets/img/free-hosting/upload-here.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
        </figure>
    </li>
    <li>
        Right-click the folder and choose <strong>Publish as Website</strong>.
        <figure style="margin: 30px 0;">
            <img src="https://developer.puter.com/assets/img/free-hosting/publish-website.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
        </figure>
    </li>
    <li>
        Pick a subdomain and click <strong>Publish</strong>. Your site goes live instantly at <code>https://your-subdomain.puter.site</code>.
        <figure style="margin: 30px 0;">
            <img src="https://developer.puter.com/assets/img/free-hosting/published.webp" style="width: 100%; max-width: 600px; margin: 0 auto; display: block; border-radius: 6px;">
        </figure>
    </li>
</ol>

<!-- ### Automate with GitHub Actions

If your code lives on GitHub, you can redeploy your site automatically on every push using the [Puter Subdomain Deploy Action](https://github.com/HeyPuter/puter-subdomain-deploy-action).

Add a workflow file at `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Puter

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy website
        uses: HeyPuter/puter-subdomain-deploy-action@v1
        with:
          subdomain: my-site            # publishes to my-site.puter.site
          source_path: dist             # the folder to deploy (e.g. your build output)
          puter_path: ~/sites/my-site   # where to store the files on Puter
          puter_token: ${{ secrets.PUTER_TOKEN }}
```

<div class="info">Store your Puter auth token as a GitHub Actions secret named <code>PUTER_TOKEN</code>. See the <a href="https://github.com/HeyPuter/puter-subdomain-deploy-action">action's README</a> for how to obtain a token and for the full list of options.</div>

If your project has a build step, run it before the deploy step (for example `npm ci && npm run build`) and point `source_path` at the build output. -->
