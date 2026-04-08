/* eslint-disable */
// TODO: Make these more compatible with eslint
naughtyStrings = [
    "文件.txt",               // Chinese characters
    "файл.txt",              // Cyrillic characters
    "ファイル.txt",           // Japanese characters
    "파일.txt",               // Korean characters
    "ملف.txt",               // Arabic characters
    "फ़ाइल.txt",             // Hindi characters
    "archivo.txt",           // Spanish characters
    "fichier.txt",           // French characters
    "αρχείο.txt",            // Greek characters
    "datei.txt",             // German characters
    "fil.txt",               // Swedish characters
    "קובץ.txt",              // Hebrew characters
    "文件名.txt",             // Chinese characters
    "файлы.txt",             // Russian characters
    "फ़ाइलें.txt",           // Hindi characters
    "📄_emoji.txt",           // Emoji
    "file name with spaces.txt",
    "file-name-with-dashes.txt",
    "file_name_with_underscores.txt",
    "file.name.with.periods.txt",
    "file,name,with,commas.txt",
    "file;name;with;semicolons.txt",
    "file(name)with(parentheses).txt",
    "file[name]with[brackets].txt",
    "file{name}with{braces}.txt",
    "file!name!with!exclamations!.txt",
    "file@name@with@ats.txt",
    "file#name#with#hashes#.txt",
    "file$name$with$dollars$.txt",
    "file%name%with%percentages%.txt",
    "file^name^with^carats^.txt",
    "file&name&with&amps&.txt",
    "file*name*with*asterisks*.txt",
    "file_name_with_long_name_exceeding_255_characters_abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz.txt",
    "file👍name👍with👍thumbs👍up.txt",
    "invisible\u200Bname.txt",                  // Invisible Unicode character (Zero Width Space)
    "invisible\u200Cname.txt",                  // Invisible Unicode character (Zero Width Non-Joiner)
    "invisible\u200Dname.txt",                  // Invisible Unicode character (Zero Width Joiner)
    "invisible\uFEFFname.txt",                  // Invisible Unicode character (Zero Width No-Break Space)
    "invisible\u180Ename.txt",                  // Invisible Unicode character (Mongolian Vowel Separator)
    "hash#tag.txt",
    "percent%20encoded.txt",
    "plus+sign.txt",
    "ampersand&symbol.txt",
    "at@symbol.txt",
    "parentheses(1).txt",
    "brackets[1].txt",
    "curly{braces}.txt",
    "angle<tags>.txt",
    "exclamation!point.txt",
    "question?mark.txt",
    "colon:separated.txt",
    "semicolon;separated.txt",
    "single'quote.txt",
    "double\"quote.txt",
    "backtick`char.txt",
    "tilde~sign.txt",
    "underscore_character.txt",
    "hyphen-character.txt",
    "equal=sign.txt",
    "plus+sign.txt",
    "asterisk*char.txt",
    "caret^char.txt",
    "percent%sign.txt",
    "dollar$sign.txt",
    "pound#sign.txt",
    "at@sign.txt",
    "exclamation!mark.txt",
    "question?mark.txt",
    "backslash\\char.txt",
    "pipe|char.txt",
    "colon:char.txt",
    "semicolon;char.txt",
    "quote'char.txt",
    "double\"quote.txt",
    "backtick`char.txt",
    "braces{char}.txt",
    "brackets[char].txt",
    "parentheses(char).txt",
    "angle<brackets>.txt",
    "ellipsis….txt",
    "accentué.txt",
    "ümlaut.txt",
    "tildeñ.txt",
    "çedilla.txt",
    "špecial.txt",
    "russianЯ.txt",
    "chinese中文.txt",
    "arabicعربى.txt",
    "hebrewעברית.txt",
    "japanese日本語.txt",
    "korean한국어.txt",
    "vietnameseTiếng Việt.txt",
]

const runWithUploadFlowMode = async (mode, work) => {
    const fs = puter.fs;
    const hadCapabilityFlag = Object.prototype.hasOwnProperty.call(fs, 'signedBatchWriteSupported');
    const previousCapabilityFlag = fs.signedBatchWriteSupported;

    if ( mode === 'legacy' ) {
        fs.signedBatchWriteSupported = false;
    } else if ( mode === 'signed' ) {
        fs.signedBatchWriteSupported = true;
    }

    try {
        return await work();
    } finally {
        if ( hadCapabilityFlag ) {
            fs.signedBatchWriteSupported = previousCapabilityFlag;
        } else {
            delete fs.signedBatchWriteSupported;
        }
    }
};

const toItemsArray = (value) => {
    if ( Array.isArray(value) ) {
        return value;
    }
    if ( value === undefined || value === null ) {
        return [];
    }
    return [value];
};

const isApiPuterComOrigin = () => {
    try {
        const apiOrigin = puter?.fs?.APIOrigin ?? puter?.APIOrigin;
        if ( typeof apiOrigin !== 'string' || apiOrigin.length === 0 ) {
            return false;
        }
        const hostname = new URL(apiOrigin).hostname.replace(/\.$/, '').toLowerCase();
        return hostname === 'api.puter.com';
    } catch (error) {
        return false;
    }
};

window.fsTests = [
    {
        name: "testFSWrite",
        description: "Test writing text content to a new file and verify it returns a valid UID",
        test: async function() {
            try {
                let randName = puter.randName();
                const result = await puter.fs.write(randName, 'testValue');
                assert(result.uid, "Failed to write to file");
                pass("testFSWrite passed");
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    throw("testFSWrite failed to delete file:", error);
                }
            } catch (error) {
                if(puter.debugMode)
                    console.log(error);
                throw("testFSWrite failed:", error);
            }    
        }
    },
    {
        name: "testFSRead",
        description: "Test reading text content from a file and verify it matches the written content",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.write(randName, 'testValue');
                const result = await (await puter.fs.read(randName)).text();
                assert(result === 'testValue', "Failed to read from file");
                pass("testFSRead passed");
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSRead failed to delete file:", error);
                }
            } catch (error) {
                fail("testFSRead failed:", error);
            }    
        }
    },
    {
        name: "testFSWriteWithoutData",
        description: "Test creating an empty file without providing content data",
        test: async function() {
            try {
                let randName = puter.randName();
                const result = await puter.fs.write(randName);
                assert(result.uid, "Failed to write to file");
                pass("testFSWriteWithoutData passed");
                if(randName !== result.name) {
                    fail(`testFSWriteWithoutData failed: Names do not match ${randName} ${result.name}`);
                }
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSWriteWithoutData failed to delete file:", error);
                }
            } catch (error) {
                fail("testFSWriteWithoutData failed:", error);
            }    
        }
    },
    {
        name: "testFSReadWithoutData",
        description: "Test reading from an empty file and verify it returns an empty string",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.write(randName);
                const result = await (await puter.fs.read(randName)).text();
                assert(result === '', "Failed to read from file");
                pass("testFSReadWithoutData passed");
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSReadWithoutData failed to delete file:", error);
                }
            } catch (error) {
                fail("testFSReadWithoutData failed:", error);
            }    
        }
    },
    {
        name: "testFSWriteToExistingFile",
        description: "Test overwriting an existing file with new content",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.write(randName, 'testValue');
                const result = await puter.fs.write(randName, 'updatedValue');
                assert(result.uid, "Failed to write to file");
                pass("testFSWriteToExistingFile passed");
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSWriteToExistingFile failed to delete file:", error);
                }
            } catch (error) {
                fail("testFSWriteToExistingFile failed:", error);
            }    
        }
    },
    {
        name: "testFSWriteToExistingFileWithoutOverwriteAndDedupe",
        description: "Test writing to an existing file with overwrite and dedupe disabled - should fail",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.write(randName, 'testValue');
                const result = await puter.fs.write(randName, 'updatedValue', { overwrite: false, dedupeName: false });
                assert(!result.uid, "Failed to write to file");
                fail("testFSWriteToExistingFileWithoutOverwriteAndDedupe failed");
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSWriteToExistingFileWithoutOverwriteAndDedupe failed to delete file:", error);
                }
            } catch (error) {
                pass("testFSWriteToExistingFileWithoutOverwriteAndDedupe passed");
            }
        }
    },
    {
        name: "testFSWriteToExistingFileWithoutOverwriteButWithDedupe",
        description: "Test writing to an existing file with overwrite disabled but dedupe enabled - should create new file",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.write(randName, 'testValue');
                const result = await puter.fs.write(randName, 'updatedValue', { overwrite: false, dedupeName: true });
                assert(result.uid, "Failed to write to file");
                pass("testFSWriteToExistingFileWithoutOverwriteButWithDedupe passed");
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSWriteToExistingFileWithoutOverwriteButWithDedupe failed to delete file:", error);
                }
            } catch (error) {
                fail("testFSWriteToExistingFileWithoutOverwriteButWithDedupe failed:", error);
            }    
        }
    },
    {
        name: "testFSWriteToExistingFileWithOverwriteButWithoutDedupe",
        description: "Test writing to an existing file with overwrite enabled but dedupe disabled - should overwrite",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.write(randName, 'testValue');
                const result = await puter.fs.write(randName, 'updatedValue', { overwrite: true, dedupeName: false });
                assert(result.uid, "Failed to write to file");
                pass("testFSWriteToExistingFileWithOverwriteButWithoutDedupe passed");
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSWriteToExistingFileWithOverwriteButWithoutDedupe failed to delete file:", error);
                }
            } catch (error) {
                fail("testFSWriteToExistingFileWithOverwriteButWithoutDedupe failed:", error);
            }    
        }
    },
    {
        name: "testFSCreateDir",
        description: "Test creating a new directory and verify it returns a valid UID",
        test: async function() {
            try {
                let randName = puter.randName();
                const result = await puter.fs.mkdir(randName);
                assert(result.uid, "Failed to create directory");
                pass("testFSCreateDir passed");
            } catch (error) {
                fail("testFSCreateDir failed:", error);
            }    
        }
    },
    {
        name: "testFSReadDir",
        description: "Test reading directory contents after creating multiple files within it",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.mkdir(randName);
                await puter.fs.write(randName + '/file1', 'testValue');
                await puter.fs.write(randName + '/file2', 'testValue');
                await puter.fs.write(randName + '/file3', 'testValue');
                const result = await puter.fs.readdir(randName);
                assert(result.length === 3, "Failed to read directory");
                pass("testFSReadDir passed");
            } catch (error) {
                fail("testFSReadDir failed:", error);
            }    
        }
    },
    {
        name: "testFSDelete",
        description: "Test deleting a file and verify it no longer exists",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.write(randName, 'testValue');
                const result = await puter.fs.delete(randName);
                assert(!result.uid, "Failed to delete file");
                pass("testFSDelete passed");
            } catch (error) {
                fail("testFSDelete failed:", error);
            }    
        }
    },
    {
        name: "testFSDeleteDir",
        description: "Test deleting a directory containing multiple files",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.mkdir(randName);
                await puter.fs.write(randName + '/file1', 'testValue');
                await puter.fs.write(randName + '/file2', 'testValue');
                await puter.fs.write(randName + '/file3', 'testValue');
                const result = await puter.fs.delete(randName);
                assert(!result.uid, "Failed to delete directory");
                pass("testFSDeleteDir passed");
            } catch (error) {
                fail("testFSDeleteDir failed:", error);
            }    
        }
    },
    {
        name: "testFSDeleteNonExistentFile",
        description: "Test attempting to delete a non-existent file and verify it returns a valid response",
        test: async function() {
            try {
                let randName = puter.randName();
                const result = await puter.fs.delete(randName);
                assert(!result.uid, "Failed to delete non-existent file");
                pass("testFSDeleteNonExistentFile passed");
            } catch (error) {
                if(error.code !== "subject_does_not_exist")
                    fail("testFSDeleteNonExistentFile failed:", error);
                else
                    pass("testFSDeleteNonExistentFile passed");
            }    
        }
    },
    {
        name: "testFSReadNonExistentFile",
        description: "Test attempting to read from a non-existent file and verify it returns a valid response",
        test: async function() {
            try {
                let randName = puter.randName();
                const result = await puter.fs.read(randName);
                fail("testFSReadNonExistentFile failed");
            } catch (error) {
                if(error.code !== "subject_does_not_exist")
                    fail("testFSReadNonExistentFile failed:", error);
                else
                    pass("testFSReadNonExistentFile passed");
            }    
        }
    },
    {
        name: "testFSWriteWithSpecialCharacters",
        description: "Test writing text content to a file with special characters and verify it returns a valid UID",
        test: async function() {
            let randName
            try {
                randName = 'testFileWithSpecialCharacte rs!@#$%^&*()_+{}|:"<>?`~'
                const result = await puter.fs.write(randName, 'testValue', { specialCharacters: true });
                assert(result.uid, "Failed to write to file");
                pass("testFSWriteWithSpecialCharacters passed");
            } catch (error) {
                fail("testFSWriteWithSpecialCharacters failed:", error);
            }    

            // delete the file
            try {
                await puter.fs.delete(randName);
            } catch (error) {
                fail("testFSWriteWithSpecialCharacters failed to delete file:", error);
            }
        }
    },
    {
        name: "testFSReadWithSpecialCharacters",
        description: "Test reading text content from a file with special characters and verify it matches the written content",
        test: async function() {
            try {
                let randName = 'testFileWithSpecialCharacte rs!@#$%^&*()_+{}|:"<>?`~'
                await puter.fs.write(randName, 'testValue');
                const result = await (await puter.fs.read(randName)).text();
                assert(result === 'testValue', "Failed to read from file");
                pass("testFSReadWithSpecialCharacters passed");
            } catch (error) {
                fail("testFSReadWithSpecialCharacters failed:", error);
            }    
        }
    },
    {
        name: "testFSWriteLargeFile",
        description: "Test writing large text content to a file and verify it returns a valid UID",
        test: async function() {
            try {
                let randName = puter.randName();
                const result = await puter.fs.write(randName, 'testValue'.repeat(100000));
                assert(result.uid, "Failed to write to file");
                pass("testFSWriteLargeFile passed");
            } catch (error) {
                fail("testFSWriteLargeFile failed:", error);
            }    
        }
    },
    {
        name: "testFSReadLargeFile",
        description: "Test reading large text content from a file and verify it matches the written content",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.write(randName, 'testValue'.repeat(100000));
                const result = await (await puter.fs.read(randName)).text();
                assert(result === 'testValue'.repeat(100000), "Failed to read from file");
                pass("testFSReadLargeFile passed");
            } catch (error) {
                fail("testFSReadLargeFile failed:", error);
            }    
        }
    },
    {
        name: "testFSRenameFile",
        description: "Test renaming a file and verify the old file is gone",
        test: async function() {
            try {
                let randName = puter.randName();
                let randName2 = puter.randName();
                await puter.fs.write(randName, 'testValue');
                const result = await puter.fs.rename(randName, randName2);
                assert(result.name, "Failed to rename file");
                pass("testFSRenameFile passed");
                // check that the old file is gone
                try {
                    await puter.fs.read(randName);
                    fail("testFSRenameFile failed to delete old file");
                } catch (error) {
                    if(error.code !== "subject_does_not_exist")
                        fail("testFSRenameFile failed to delete old file:", error);
                    else
                        pass("testFSRenameFile passed");
                }
            } catch (error) {
                fail("testFSRenameFile failed:", error);
            }    
        }
    },
    {
        name: "testFSMoveFile",
        description: "Test moving a file to a new directory and verify the old file is gone",
        test: async function() {
            try {
                let randName = puter.randName();
                let randName2 = puter.randName();
                await puter.fs.write(randName, 'testValue');
                await puter.fs.mkdir(randName2);
                let result = await puter.fs.move(randName, randName2);
                assert(result.moved, "Failed to move file");
                // check that the old file is gone
                try {
                    await puter.fs.read(randName);
                    fail("testFSMoveFile failed to delete old file");
                } catch (error) {
                    if(error.code !== "subject_does_not_exist")
                        fail("testFSMoveFile failed to delete old file:", error);
                    else
                        pass("testFSMoveFile passed");
                }
            } catch (error) {
                fail("testFSMoveFile failed:", error);
            }    
        }
    },
    {
        name: "testFSCopyFile",
        description: "Test copying a file to a new directory and verify the old file is still there",
        test: async function() {
            try {
                let randName = puter.randName();
                let randName2 = puter.randName();
                await puter.fs.write(randName, 'testValue');
                await puter.fs.mkdir(randName2);
                let result = await puter.fs.copy(randName, randName2);
                assert(Array.isArray(result) && result[0].copied.uid, "Failed to copy file");
                // check that the old file is still there
                try {
                    await puter.fs.read(randName);
                    pass("testFSCopyFile passed");
                } catch (error) {
                    fail("testFSCopyFile failed to keep old file:", error);
                }
            } catch (error) {
                fail("testFSCopyFile failed:", error);
            }    
        }
    },
    {
        name: "testFSCopyFileWithNewName",
        description: "Test copying a file to a new directory with a new name and verify the old file is still there",
        test: async function() {
            try {
                let randName = puter.randName();
                let randName2 = puter.randName();
                await puter.fs.write(randName, 'testValue');
                await puter.fs.mkdir(randName2);
                let result = await puter.fs.copy(randName, randName2, { newName: 'newName' });
                assert(Array.isArray(result) && result[0].copied.uid, "Failed to copy file");
                // check file name
                assert(result[0].copied.name === 'newName', "Failed to copy file with new name");
                // check that the old file is still there
                try {
                    await puter.fs.read(randName);
                    pass("testFSCopyFileWithNewName passed");
                } catch (error) {
                    fail("testFSCopyFileWithNewName failed to keep old file:", error);
                }
            } catch (error) {
                fail("testFSCopyFileWithNewName failed:", error);
            }    
        }
    },
    {
        name: "testFSStat",
        description: "Test getting file metadata and verify it returns a valid UID",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.write(randName, 'testValue');
                let result = await puter.fs.stat(randName);
                assert(result.uid, "Failed to stat file");
                pass("testFSStat passed");
            } catch (error) {
                fail("testFSStat failed:", error);
            }    
        }
    },
    {
        name: "testFSStatDir",
        description: "Test getting directory metadata and verify it returns a valid UID",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.mkdir(randName);
                let result = await puter.fs.stat(randName);
                assert(result.uid, "Failed to stat directory");
                pass("testFSStatDir passed");
            } catch (error) {
                fail("testFSStatDir failed:", error);
            }    
        }
    },
    {
        name: "testFSStatNonExistent",
        description: "Test attempting to get metadata from a non-existent file or directory and verify it returns a valid response",
        test: async function() {
            try {
                let randName = puter.randName();
                let result = await puter.fs.stat(randName);
                fail("testFSStatNonExistent failed");
            } catch (error) {
                if(error.code !== "subject_does_not_exist")
                    fail("testFSStatNonExistent failed:", error);
                else
                    pass("testFSStatNonExistent passed");
            }    
        }
    },
    {
        name: "testFSDeleteDirWithFiles",
        description: "Test deleting a directory containing multiple files and verify it no longer exists",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.mkdir(randName);
                await puter.fs.write(randName + '/file1', 'testValue');
                await puter.fs.write(randName + '/file2', 'testValue');
                await puter.fs.write(randName + '/file3', 'testValue');
                const result = await puter.fs.delete(randName, { recursive: true });
                assert(!result.uid, "Failed to delete directory");
                pass("testFSDeleteDirWithFiles passed");
            } catch (error) {
                fail("testFSDeleteDirWithFiles failed:", error);
            }    
        }
    },
    {
        name: "testFSStatDirReturnsAttrs",
        description: "Test getting directory metadata and verifying it returns the expected attributes",
        test: async function() {
            try {
                let randName = puter.randName();
                await puter.fs.mkdir(randName);
                let result = await puter.fs.stat(randName);
                assert(result.name && typeof result.name === 'string', "Failed to stat directory (name)");
                assert(result.path && typeof result.path === 'string', "Failed to stat directory (path)");
                assert(result.immutable !== undefined, "Failed to stat directory (immutable)");
                assert(result.metadata !== undefined, "Failed to stat directory (metadata)");
                assert(result.modified !== undefined, "Failed to stat directory (modified)");
                assert(result.created !== undefined, "Failed to stat directory (created)");
                assert(result.accessed !== undefined, "Failed to stat directory (accessed)");
                assert(result.size !== undefined, "Failed to stat directory (size)");
                assert(result.layout !== undefined, "Failed to stat directory (layout)");
                assert(result.owner !== undefined && typeof result.owner === 'object', "Failed to stat directory (owner)");
                assert(result.dirname !== undefined && typeof result.dirname === 'string', "Failed to stat directory (dirname)");
                assert(result.parent_id !== undefined && typeof result.parent_id === 'string', "Failed to stat directory (parent_id)");
                // todo this will fail for now until is_dir is turned into boolean
                assert(result.is_dir !== undefined && typeof result.is_dir === 'boolean' && result.is_dir === true, "Failed to stat directory (is_dir)");
                assert(result.is_empty !== undefined && typeof result.is_empty === 'boolean', "Failed to stat directory (is_empty)");
                pass("testFSStatDirReturnsAttrs passed");
            } catch (error) {
                throw("testFSStatDirReturnsAttrs failed:", error);
            }    
        }
    },
    {
        name: "testFSReadWithWriteResult",
        description: "Test reading text content from a file using the object returned by write()",
        test: async function() {
            try {
                let randName = puter.randName();
                let writeResult = await puter.fs.write(randName, 'testValue');
                let result = await (await puter.fs.read(writeResult)).text();
                assert(result === 'testValue', "Failed to read from file");
                pass("testFSReadWithWriteResult passed");
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSReadWithWriteResult failed to delete file:", error);
                }
            } catch (error) {
                fail("testFSReadWithWriteResult failed:", error);
            }    
        }
    },
    {
        name: "testFSStatWithWriteResult",
        description: "Test getting file metadata using the object returned by write()",
        test: async function() {
            try {
                let randName = puter.randName();
                let writeResult = await puter.fs.write(randName, 'testValue');
                let result = await puter.fs.stat(writeResult);
                assert(result.uid, "Failed to stat file");
                pass("testFSStatWithWriteResult passed");
                // delete the file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSStatWithWriteResult failed to delete file:", error);
                }
            } catch (error) {
                fail("testFSStatWithWriteResult failed:", error);
            }    
        }
    },
    {
        name: "testFSWriteWithNaughtyStrings",
        description: "Test writing text content to files with names from naughtyStrings and verify it returns a valid UID",
        test: async function() {
            try {
                let randName = puter.randName();
                for(let i = 0; i < naughtyStrings.length; i++) {
                    let filename = randName + naughtyStrings[i];
                    let result = await puter.fs.write(filename, 'testValue');
                    assert(result.uid, "Failed to write to file");
                    // check name
                    assert(result.name === filename, "Failed to write to file with naughty name: " + filename);
                    // delete the file
                    try {
                        await puter.fs.delete(filename);
                    } catch (error) {
                        fail("testFSWriteWithNaughtyStrings failed to delete file: " + filename, error);
                    }
                }
                pass("testFSWriteWithNaughtyStrings passed");
            } catch (error) {
                console.log(error);
                fail("testFSWriteWithNaughtyStrings failed:", error);
            }    
        }
    },
    {
        name: "testFSWriteReadBinaryFile",
        description: "Test writing and reading binary file data and verify it remains intact",
        test: async function() {
            try {
                let randName = puter.randName() + '.webp';
                
                // Create some binary data - a simple byte array representing a small binary file
                const binaryData = new Uint8Array([
                    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
                    0x18, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9D, 0x01, 0x2A, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00,
                    0x34, 0x25, 0xA4, 0x00, 0x03, 0x70, 0x00, 0xFE, 0xFB, 0xFD, 0x50, 0x00
                ]);
                
                // Write the binary data to a file
                const writeResult = await puter.fs.write(randName, binaryData);
                assert(writeResult.uid, "Failed to write binary file");
                
                // Read the binary data back
                const readResult = await puter.fs.read(randName);
                const readBinaryData = new Uint8Array(await readResult.arrayBuffer());
                
                // Verify the binary data is identical
                assert(readBinaryData.length === binaryData.length, "Binary data length mismatch");
                for (let i = 0; i < binaryData.length; i++) {
                    assert(readBinaryData[i] === binaryData[i], `Binary data mismatch at byte ${i}: expected ${binaryData[i]}, got ${readBinaryData[i]}`);
                }
                
                pass("testFSWriteReadBinaryFile passed");
                
                // Clean up - delete the test file
                try {
                    await puter.fs.delete(randName);
                } catch (error) {
                    fail("testFSWriteReadBinaryFile failed to delete file:", error);
                }
            } catch (error) {
                fail("testFSWriteReadBinaryFile failed:", error);
            }    
        }
    },
    {
        name: "testFSAppDirectoryIsolation",
        description: "Test that filesystem operations are properly sandboxed to the app directory and cannot access files outside of it",
        test: async function() {
            try {
                // Test 1: Try to access parent directory with ../
                try {
                    await puter.fs.readdir('~/Desktop');
                    fail("testFSAppDirectoryIsolation failed: Should not be able to read Desktop directory");
                } catch (error) {
                    if (error.code !== "subject_does_not_exist") {
                        fail("testFSAppDirectoryIsolation failed: Wrong error code for Desktop directory access: " + error.code);
                    }
                }
                
                // Test 2: Try to access absolute path outside app directory
                try {
                    await puter.fs.read('/some/absolute/path.txt');
                    fail("testFSAppDirectoryIsolation failed: Should not be able to read absolute paths");
                } catch (error) {
                    if (error.code !== "access_denied" && error.code !== "invalid_path" && error.code !== "subject_does_not_exist") {
                        fail("testFSAppDirectoryIsolation failed: Wrong error code for absolute path access: " + error.code);
                    }
                }
                
                // Test 3: Try to write outside app directory
                try {
                    await puter.fs.write('../escape_file.txt', 'should not work');
                    fail("testFSAppDirectoryIsolation failed: Should not be able to write outside app directory");
                } catch (error) {
                    if (error.code !== "subject_does_not_exist") {
                        fail("testFSAppDirectoryIsolation failed: Wrong error code for writing outside directory: " + error.code);
                    }
                }
                
                // Test 4: Try to create directory outside app directory
                try {
                    await puter.fs.mkdir('../escape_dir');
                    fail("testFSAppDirectoryIsolation failed: Should not be able to create directory outside app directory");
                } catch (error) {
                        if (error.code !== "subject_does_not_exist") {
                            fail("testFSAppDirectoryIsolation failed: Wrong error code for creating directory outside: " + error.code);
                    }
                }
                
                // Test 5: Try to access home directory directly
                try {
                    await puter.fs.read('~/some_file.txt');
                    fail("testFSAppDirectoryIsolation failed: Should not be able to read from home directory");
                } catch (error) {
                    if (error.code !== "access_denied" && error.code !== "invalid_path" && error.code !== "subject_does_not_exist") {
                        fail("testFSAppDirectoryIsolation failed: Wrong error code for home directory access: " + error.code);
                    }
                }
                
                pass("testFSAppDirectoryIsolation passed");
            } catch (error) {
                fail("testFSAppDirectoryIsolation failed:", error);
            }
        }
    },
    {
        name: "testFSWriteParityBetweenSignedAndLegacyFlow",
        description: "Test write() parity between default upload flow (signed when available) and forced legacy fallback flow",
        test: async function() {
            const rootDir = puter.randName();
            const defaultPath = `${rootDir}/default-parity-write.txt`;
            const legacyPath = `${rootDir}/legacy-parity-write.txt`;
            const defaultContent = `default-flow-content-${Date.now()}`;
            const legacyContent = `legacy-flow-content-${Date.now()}`;
            const defaultFlowLabel = isApiPuterComOrigin() ? 'signed-preferred' : 'legacy-default';

            try {
                await puter.fs.mkdir(rootDir);

                const defaultResult = await puter.fs.write(defaultPath, defaultContent, {
                    overwrite: true,
                    dedupeName: false,
                });
                const legacyResult = await runWithUploadFlowMode('legacy', async () => {
                    return await puter.fs.write(legacyPath, legacyContent, {
                        overwrite: true,
                        dedupeName: false,
                    });
                });

                assert(defaultResult && defaultResult.uid, "Default flow write failed");
                assert(legacyResult && legacyResult.uid, "Legacy flow write failed");

                const defaultRead = await (await puter.fs.read(defaultPath)).text();
                const legacyRead = await (await puter.fs.read(legacyPath)).text();

                assert(defaultRead === defaultContent, "Default flow wrote unexpected content");
                assert(legacyRead === legacyContent, "Legacy flow wrote unexpected content");
                assert(typeof defaultResult.name === 'string' && defaultResult.name.length > 0, "Default flow write returned invalid name");
                assert(typeof legacyResult.name === 'string' && legacyResult.name.length > 0, "Legacy flow write returned invalid name");

                pass(`testFSWriteParityBetweenSignedAndLegacyFlow passed (${defaultFlowLabel})`);
            } catch (error) {
                fail("testFSWriteParityBetweenSignedAndLegacyFlow failed:", error);
            } finally {
                try {
                    await puter.fs.delete(rootDir, { recursive: true });
                } catch (cleanupError) {
                }
            }
        }
    },
    {
        name: "testFSBatchUploadParityBetweenSignedAndLegacyFlow",
        description: "Test upload() parity for batched files between default upload flow (signed when available) and forced legacy fallback flow",
        test: async function() {
            const rootDir = puter.randName();
            const defaultDir = `${rootDir}/default-batch`;
            const legacyDir = `${rootDir}/legacy-batch`;
            const defaultFlowLabel = isApiPuterComOrigin() ? 'signed-preferred' : 'legacy-default';
            const defaultFiles = [
                new File([`alpha-default-${Date.now()}`], 'alpha.txt', { type: 'text/plain' }),
                new File([`beta-default-${Date.now()}`], 'beta.txt', { type: 'text/plain' }),
            ];
            const legacyFiles = [
                new File([`alpha-legacy-${Date.now()}`], 'alpha.txt', { type: 'text/plain' }),
                new File([`beta-legacy-${Date.now()}`], 'beta.txt', { type: 'text/plain' }),
            ];

            try {
                await puter.fs.mkdir(rootDir);
                await puter.fs.mkdir(defaultDir, { createMissingParents: true });
                await puter.fs.mkdir(legacyDir, { createMissingParents: true });

                const defaultUploadResult = await puter.fs.upload(defaultFiles, defaultDir, {
                    overwrite: true,
                    dedupeName: false,
                    strict: true,
                });

                const legacyUploadResult = await runWithUploadFlowMode('legacy', async () => {
                    return await puter.fs.upload(legacyFiles, legacyDir, {
                        overwrite: true,
                        dedupeName: false,
                        strict: true,
                    });
                });

                const defaultItems = toItemsArray(defaultUploadResult);
                const legacyItems = toItemsArray(legacyUploadResult);

                assert(defaultItems.length === defaultFiles.length, "Default flow batch upload returned unexpected number of items");
                assert(legacyItems.length === legacyFiles.length, "Legacy flow batch upload returned unexpected number of items");

                for ( let i = 0; i < defaultFiles.length; i++ ) {
                    const defaultItem = defaultItems[i];
                    const legacyItem = legacyItems[i];
                    const expectedName = defaultFiles[i].name;
                    const defaultContent = await (await puter.fs.read(`${defaultDir}/${expectedName}`)).text();
                    const legacyContent = await (await puter.fs.read(`${legacyDir}/${expectedName}`)).text();

                    assert(defaultItem && defaultItem.uid, `Default flow item ${i} missing uid`);
                    assert(legacyItem && legacyItem.uid, `Legacy flow item ${i} missing uid`);
                    assert(defaultContent === await defaultFiles[i].text(), `Default flow content mismatch for ${expectedName}`);
                    assert(legacyContent === await legacyFiles[i].text(), `Legacy flow content mismatch for ${expectedName}`);
                }

                pass(`testFSBatchUploadParityBetweenSignedAndLegacyFlow passed (${defaultFlowLabel})`);
            } catch (error) {
                fail("testFSBatchUploadParityBetweenSignedAndLegacyFlow failed:", error);
            } finally {
                try {
                    await puter.fs.delete(rootDir, { recursive: true });
                } catch (cleanupError) {
                }
            }
        }
    },
];
