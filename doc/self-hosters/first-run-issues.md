# First Run Issues

## "Cannot find package '@heyputer/backend'"

Scenario: You see the following output:

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  Cannot find package '@heyputer/backend'              ┃
┃  📝 this usually happens if you forget `npm install`  ┃
┃  Suggestions:                                         ┃
┃  - try running `npm install`                          ┃
┃  Technical Notes:                                     ┃
┃  - @heyputer/backend is in an npm workspace           ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

1. Ensure you have run `npm install`.
2. [Install build essentials for your distro](#installing-build-essentials),
   then run `npm install` again.

## Installing Build Essentials

### Debian-based distros

```
sudo apt update
sudo apt install build-essential
```

### RHEL-family distros (Fedora, Rocky, etc)

```
sudo dnf groupinstall "Development Tools"
```

### "I use Arch btw"

```
sudo pacman -S base-devel
```

### Alpine

If you're running in Puter's Alpine image then this is already installed.

```
sudo apk add build-base
```

### Gentoo

You know what you're doing; you just wanted to see if we mentioned Gentoo.

## "Could not load the "sharp" module using the freebsd-x64 runtime"

In order to get it to work on FreeBSD, you will need to build sharp from source and link it to the project.

```
pkg install vips
git clone --depth=1 https://github.com/lovell/sharp.git
cd sharp
yarn install
sudo npm link
```

After `npm install` you can link the prebuilt module

```
# cd puter
# npm install
npm link sharp
npm start
```
