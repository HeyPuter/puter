---
title: puter.ui.showFeedbackDialog()
description: Opens a dialog the user can use to send feedback to your app.
platforms: [ websites, apps]
---

Opens a dialog the user can use to send you — the app's developer — feedback about your app. The message is delivered by Puter: it is stored and emailed to the email address on your Puter account. The feedback never passes through your app's code, and the dialog tells the user their username will be shared with you so you can follow up.

Inside Puter, the dialog is rendered by the desktop environment. On a website, a puter.com popup hosts the dialog (signing the user in first if needed).

**Feedback is opt-in.** Users can only send feedback if you've enabled it for your app by setting `feedbackEnabled`:

```js
await puter.apps.update('my-app', { feedbackEnabled: true });
```

If feedback isn't enabled, the dialog tells the user the app isn't accepting feedback. To protect you and your users, Puter enforces limits on the size and frequency of feedback messages.

## Syntax
```js
puter.ui.showFeedbackDialog()
```

## Parameters
None.

## Return value
A `Promise` that resolves to `true` if the user submitted feedback, and `false` if the dialog was dismissed or feedback is unavailable. It never rejects.

## Examples

```html;ui-show-feedback-dialog
<html>
<body>
    <button id="feedback">Send us feedback</button>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        document.getElementById('feedback').addEventListener('click', async () => {
            const sent = await puter.ui.showFeedbackDialog();
            if (sent) {
                puter.print('Thanks for your feedback!');
            }
        });
    </script>
</body>
</html>
```
