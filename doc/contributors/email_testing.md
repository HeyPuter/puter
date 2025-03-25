# Local Email Testing
- The local email testing is done through [MailHog](https://github.com/mailhog/MailHog) which provides email testing through a local email server.
## Prerequisites
- Following the general instruction i.e. adding in `volatile/config/config.json`
   ```json
    "email": {
    "host": "localhost",
    "port": 1025
    }
   ```
- Having MailHog installed in your machine.
```bash
# Install MailHog
wget https://github.com/mailhog/MailHog/releases/download/v1.0.1/MailHog_linux_amd64
chmod +x MailHog_linux_amd64
./MailHog_linux_amd64
```
- Nodemailer to send email to SMTP server running in your machine.
   To install nodemailer:
``` zsh
npm install nodemailer
```

## Access Web Interface
The MailHog UI can be accessed at [http://127.0.0.1:8025/](http://127.0.0.1:8025/).
All sent emails and their recipients can be viewed here.

## Using Nodemailer to Send Emails via SMTP, which will appear in the MailHog instance.
- Using nodemailer as the transport method to send emails using SMTP which would be visible in MailHog instance.

```javascript
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    host: "localhost", // SMTP server (MailHog in this case)
    port: 1025,        // Default MailHog SMTP port
    secure: false      // No SSL/TLS required
});

const mailOptions = {
    from: "no-reply@example.com",
    to: "test@example.com",
    subject: "Hello from Nodemailer!",
    text: "This is a test email sent using Nodemailer."
};

transporter.sendMail(mailOptions)
    .then(info => console.log("Email sent:", info.response))
    .catch(error => console.error("Error:", error));
```
- Once the email is sent, you can see it in the MailHog web interface as shown in the screenshot below.
<img src="image.png" alt="Alt text" width="300" height="200">

## TroubleShooting
- If the Mailhog is not working :
```bash
ps aux | grep MailHog
#Ensure it is running
```


