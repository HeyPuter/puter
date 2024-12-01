var input = document.querySelector('textarea[name=edit-app-filetype-association]'),
    tagify = new Tagify(input, {
        enforceWhitelist : true,
        delimiters       : null,
        whitelist : [
          // Document file types
          ".doc", ".docx", ".pdf", ".txt", ".odt", ".rtf", ".tex",
          // Spreadsheet file types
          ".xls", ".xlsx", ".csv", ".ods",
          // Image file types
          ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".svg", ".webp",
          // Video file types
          ".mp4", ".avi", ".mov", ".wmv", ".mkv", ".flv", ".webm",
          // Audio file types
          ".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a",
          // Code file types
          ".js", ".ts", ".html", ".css", ".json", ".xml", ".php", ".py", ".java", ".cpp",
          // Archive file types
          ".zip", ".rar", ".7z", ".tar", ".gz",
          // Other
          ".exe", ".dll", ".iso"
        ],
        callbacks        : {
            add    : console.log,  // callback when adding a tag
            remove : console.log   // callback when removing a tag
        }
    })
