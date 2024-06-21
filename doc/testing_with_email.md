# Testing with Email

Testing anything involving email is really simple using [mailhog](https://github.com/mailhog/MailHog)

### Step 1: Configure email service

In your `config.json` for Puter (`volatile/config/config.json` usually, `/var/puter/config.json` in containers),
add this entry to the `"services`" map:

```javascript
    "services": {
        
        // ... there are probably other service configs
        
        "email": {
            "host": "localhost",
            "port": 1025
        }
    }
```

### Step 2: Install and run mailhog

Follow the instructions on [MailHog](https://github.com/mailhog/MailHog)'s
repository, or install through your distro's package manager.

Run the command: `mailhog`.

You should now have an inbox at [http://127.0.0.1:8025](http://127.0.0.1:8025).

Every email that Puter sends will show up on this page.
