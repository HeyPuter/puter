In this document we will cover the security model of Puter.js and how it manages apps' access to user data and cloud resources.

## Authentication

If Puter.js is being used in a website, as opposed to a puter.com app, the user will have to authenticate with Puter.com first, or in other words, the user needs to give your website permission before you can use any of the cloud services on their behalf. 

Fortunately, Puter.js handles this automatically and the user will be prompted to sign in with their Puter.com account when your code tries to access any cloud services. If the user is already signed in, they will not be prompted to sign in again. You can build your app as if the user is already signed in, and Puter.js will handle the authentication process for you whenever it's needed.

<figure style="margin: 40px 0;">
    <img src="/assets/img/auth.png" style="width: 100%; max-width: 600px; margin: 0px auto; display:block;">
    <figcaption style="text-align: center; font-size: 13px; color: #777;">The user will be automatically prompted to sign in with their Puter.com account when your code tries to access any cloud services or resources.</figcaption>
</figure>

If Puter.js is being used in an app published on Puter.com, the user will be automatically signed in and your app will have full access to all cloud services. 

## Default permissions

Once the user has been authenticated, your app will get a few things by default:

- **An app directory** in the user's cloud storage. This is where your app can freely store files and directories. The path to this directory will look like `~/AppData/<your-app-id>/`. This directory is automatically created for your app when the user has been authenticated the first time. Your app will not be able to access any files or data outside of this directory by default.

- **A key-value store** in the user's space. Your app will have its own sandboxed key-value store that it can freely write to and read from. Only your app will be able to access this key-value store, and no other apps will be able to access it. Your app will not be able to access any other key-value stores by default either.

<div class="info"><strong>Apps are sandboxed by default!</strong> Apps are not able to access any files, directories, or data outside of their own directory and key-value store within a user's account. This is to ensure that apps can't access any data or resources that they shouldn't have access to.</div>

Your app will also be able to use the following services by default:

- **AI**: Your app will be able to use the AI services provided by Puter.com. This includes chat, txt2img, img2txt, and more.

- **Hosting**: Your app will be able to use puter to create and publish websites on the user's behalf.
