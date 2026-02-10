
# INSTALL.md

## Node.js & npm Installation Guide


## 1. Arch Linux / Manjaro

```bash
# Update package database
sudo pacman -Syu

# Install Node.js and npm
sudo pacman -S nodejs npm

# Verify installation
node -v
npm -v
````

---

## 2. Debian / Ubuntu

```bash
# Update package database and install curl
sudo apt update
sudo apt install -y curl

# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Reload shell
source ~/.bashrc     # Or source ~/.zshrc if using Zsh

# Install latest Node.js and npm
nvm install node

# Verify installation
node -v
npm -v
```

---

## 3. CentOS / RHEL

```bash
# Install curl if missing
sudo yum install -y curl

# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash


# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Reload shell
source ~/.bashrc     # Or source ~/.zshrc if using Zsh

# Install latest Node.js and npm
nvm install node

# Verify installation
node -v
npm -v
```

---

## 4. Fedora

```bash
# Update system
sudo dnf update -y

# Install Node.js and npm from modules
sudo dnf module list nodejs       # Check available versions
sudo dnf module enable nodejs:18  # Example: enable Node 18 LTS
sudo dnf install -y nodejs npm

# Verify installation
node -v
npm -v
```

---

## 5. openSUSE

```bash
# Refresh repositories
sudo zypper refresh

# Install Node.js and npm
sudo zypper install -y nodejs npm

# Verify installation
node -v
npm -v
```

---

## 6. Using nvm (Optional, Recommended)

`nvm` allows installing multiple Node.js versions and switching between them easily:

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Reload shell
source ~/.bashrc     # Or source ~/.zshrc if using Zsh

# Install latest Node.js and npm
nvm install node

# Or install latest LTS version
nvm install --lts

# Switch Node versions
nvm use node

# Verify installation
node -v
npm -v
```

