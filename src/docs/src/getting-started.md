
## Installation

To begin using Puter.js, simply add it to your HTML file using the following script tag:

```html
<script src="https://js.puter.com/v2/"></script>
```

That's it! You're now ready to start using Puter.js in your web application. No need to install any dependencies or set up a server. No API keys or configuration required.

## Basic Usage
Once you've added the Puter.js script to your web application, a global `puter` object will be available for you to use. This object contains all of the functionality provided by Puter.js. For example, to use GPT-5 nano, you can call the `puter.ai.chat` function:

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.chat(`Why did the chicken cross the road?`).then(puter.print);
    </script>
</body>
</html>
```

This is all you need to use GPT-5 nano in your app. No backend code, no configuration, and no API keys. Just include the Puter.js script, and you're ready to start.

## Where to Go From Here

To learn more about the capabilities of Puter.js and how to use them in your web application, check out

- [Tutorials](https://developer.puter.com/tutorials): Step-by-step guides to help you get started with Puter.js and build powerful applications.

- [Playground](https://docs.puter.com/playground): Experiment with Puter.js in your browser and see the results in real-time. Many examples are available to help you understand how to use Puter.js effectively.

- [Examples](https://docs.puter.com/examples): A collection of code snippets and full applications that demonstrate how to use Puter.js to solve common problems and build innovative applications.