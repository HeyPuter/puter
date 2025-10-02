# iframe URL

## Introduction

Puter loads all apps using HTML `<iframe>` tags. This makes it extremely simple for developers to integrate new and existing web apps with Puter within minutes without having to use any SDKs, libraries or frameworks.

If you're self-hosting your app, the URL that is used to load your app (called the **Index URL**) is supplied by you when you published your app on Puter (e.g. `https://www.example-app.com/index.html`). On the other hand if your app is hosted on Puter, the URL is generated automatically by Puter (e.g. `https://app-6176cdbe-812d-441b-b385-9e84a327f959.puter.com/index.html`). Regardless of where your index URL points to, Puter automatically attaches useful information to it for your app to use. For example, if the user has decided to open a file in your app, Puter will attach the file's meta data such as name, size, read/write URLs, etc. to the index URL of your app.

<img src="/images/screenshot_iframe.webp" style="border-radius: 4px;">

As an example, consider the <a href="https://puter.com/app/editor" target="_blank">Editor</a> app on Puter. The Index URL of Editor is `https://editor.puter.com/index.html`; however, when Editor is opened Puter will attach more information to this URL and the final index URL of the iframe will look more like:

<pre>
<code style="background:none; border:1px solid #CCC; border-radius: 4px; padding: 20px; padding-top:0; word-space:normal; max-width: 100%; display: inline-block; line-break: anywhere; white-space: pre-wrap;">
https://editor.puter.com/index.html?puter.app_instance_id=...&puter.item.uid=...&puter.item.name=...&puter.item.read_url=...&puter.item.write_url=...&puter.domain=...
</code>
</pre>
The Editor app can then extract these useful parameters from the URL to do interesting things. For example, `puter.item.name` will contain the name of the file that was opened and `puter.item.write_url` provides a URL the Editor can use to write to the opened file.