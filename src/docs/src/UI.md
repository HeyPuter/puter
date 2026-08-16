---
title: UI
description: Create a rich UI and interactions in the Puter desktop environment.
---

The UI API provides a comprehensive set of tools for creating rich user interfaces and interacting with the Puter desktop environment. It includes window management, dialogs, and desktop integration features.

## Available Functions

### Authentication
- **[`puter.ui.authenticateWithPuter()`](/UI/authenticateWithPuter/)** - Authenticate with Puter

### Dialogs and Alerts
- **[`puter.ui.alert()`](/UI/alert/)** - Show alert dialogs
- **[`puter.ui.notify()`](/UI/notify/)** - Show desktop notifications
- **[`puter.ui.prompt()`](/UI/prompt/)** - Show input prompts
- **[`puter.ui.showFeedbackDialog()`](/UI/showFeedbackDialog/)** - Let the user send feedback to your app's developer

### Window Management
- **[`puter.ui.createWindow()`](/UI/createWindow/)** - Create new windows
- **[`puter.ui.setWindowTitle()`](/UI/setWindowTitle/)** - Set window title
- **[`puter.ui.setWindowSize()`](/UI/setWindowSize/)** - Set window dimensions
- **[`puter.ui.setWindowPosition()`](/UI/setWindowPosition/)** - Set window position
- **[`puter.ui.setWindowWidth()`](/UI/setWindowWidth/)** - Set window width
- **[`puter.ui.setWindowHeight()`](/UI/setWindowHeight/)** - Set window height
- **[`puter.ui.setWindowX()`](/UI/setWindowX/)** - Set window X position
- **[`puter.ui.setWindowY()`](/UI/setWindowY/)** - Set window Y position
- **[`puter.ui.showWindow()`](/UI/showWindow/)** - Show the application's window
- **[`puter.ui.hideWindow()`](/UI/hideWindow/)** - Hide the application's window

### File Pickers
- **[`puter.ui.showOpenFilePicker()`](/UI/showOpenFilePicker/)** - Show file open dialog
- **[`puter.ui.showSaveFilePicker()`](/UI/showSaveFilePicker/)** - Show file save dialog
- **[`puter.ui.showDirectoryPicker()`](/UI/showDirectoryPicker/)** - Show directory picker

### System Integration
- **[`puter.ui.launchApp()`](/UI/launchApp/)** - Launch other applications
- **[`puter.ui.parentApp()`](/UI/parentApp/)** - Get parent application info
- **[`puter.exit()`](/UI/exit/)** - Exit the application
- **[`puter.ui.setMenubar()`](/UI/setMenubar/)** - Set application menubar
- **[`puter.ui.getLanguage()`](/UI/getLanguage/)** - Get current language/locale code

### Event Handling
- **[`puter.ui.on()`](/UI/on/)** - Register event handlers
- **[`puter.ui.onItemsOpened()`](/UI/onItemsOpened/)** - Handle items opened by user action
- **[`puter.ui.onLaunchedWithItems()`](/UI/onLaunchedWithItems/)** - Handle launch with items
- **[`puter.ui.wasLaunchedWithItems()`](/UI/wasLaunchedWithItems/)** - Check if launched with items
- **[`puter.ui.onWindowClose()`](/UI/onWindowClose/)** - Handle window close events

### Additional UI Elements
- **[`puter.ui.contextMenu()`](/UI/contextMenu/)** - Show a context menu at the cursor
- **[`puter.ui.hideSpinner()`](/UI/hideSpinner/)** - Hide spinner
- **[`puter.ui.showColorPicker()`](/UI/showColorPicker/)** - Show color picker
- **[`puter.ui.showFontPicker()`](/UI/showFontPicker/)** - Show font picker
- **[`puter.ui.showSpinner()`](/UI/showSpinner/)** - Show spinner
- **[`puter.ui.socialShare()`](/UI/socialShare/)** - Share content socially
