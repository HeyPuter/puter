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
    "file_name_with_long_name_exceeding_255_characters_abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz.txt",
    "file👍name👍with👍thumbs👍up.txt",
    "file😂name😂with😂emojis😂.txt",
    "file🌍name🌍with🌍globe🌍emojis🌍.txt",
    "file🔥name🔥with🔥fire🔥emoji🔥.txt",
    "file🎉name🎉with🎉party🎉popper🎉emoji🎉.txt",
    "file💼name💼with💼briefcase💼emoji💼.txt",
    "file🍔name🍔with🍔burger🍔emoji🍔.txt",
    "file🚀name🚀with🚀rocket🚀emoji🚀.txt",
    "file👽name👽with👽alien👽emoji👽.txt",
    "file🌈name🌈with🌈rainbow🌈emoji🌈.txt",
    "file🍆name🍆with🍆eggplant🍆emoji🍆.txt",
    "file🍑name🍑with🍑peach🍑emoji🍑.txt",
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

window.fsTests = [
    testFSWrite = async ()=>{
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
    },
    testFSRead = async ()=>{
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
    },
    testFSWriteWithoutData = async ()=>{
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
    },
    testFSReadWithoutData = async ()=>{
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
    },
    testFSWriteToExistingFile = async ()=>{
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
    },
    testFSWriteToExistingFileWithoutOverwriteAndDedupe = async ()=>{
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
    
    },
    testFSWriteToExistingFileWithoutOverwriteButWithDedupe = async ()=>{
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
    },
    testFSWriteToExistingFileWithOverwriteButWithoutDedupe = async ()=>{
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
    },
    // create a directory
    testFSCreateDir = async ()=>{
        try {
            let randName = puter.randName();
            const result = await puter.fs.mkdir(randName);
            assert(result.uid, "Failed to create directory");
            pass("testFSCreateDir passed");
        } catch (error) {
            fail("testFSCreateDir failed:", error);
        }    
    },

    // write a number of files to a directory and list them
    testFSReadDir = async ()=>{
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
    },

    // create a file then delete it
    testFSDelete = async ()=>{
        try {
            let randName = puter.randName();
            await puter.fs.write(randName, 'testValue');
            const result = await puter.fs.delete(randName);
            assert(!result.uid, "Failed to delete file");
            pass("testFSDelete passed");
        } catch (error) {
            fail("testFSDelete failed:", error);
        }    
    },

    // create a directory, write a number of files to it, then delete it
    testFSDeleteDir = async ()=>{
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
    },

    // attempt to delete a non-existent file
    testFSDeleteNonExistentFile = async ()=>{
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
    },

    // attempt to access a non-existent file
    testFSReadNonExistentFile = async ()=>{
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
    },

    testFSWriteWithSpecialCharacters = async ()=>{
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
    },

    testFSReadWithSpecialCharacters = async ()=>{
        try {
            let randName = 'testFileWithSpecialCharacte rs!@#$%^&*()_+{}|:"<>?`~'
            await puter.fs.write(randName, 'testValue');
            const result = await (await puter.fs.read(randName)).text();
            assert(result === 'testValue', "Failed to read from file");
            pass("testFSReadWithSpecialCharacters passed");
        } catch (error) {
            fail("testFSReadWithSpecialCharacters failed:", error);
        }    
    },

    testFSWriteLargeFile = async ()=>{
        try {
            let randName = puter.randName();
            const result = await puter.fs.write(randName, 'testValue'.repeat(100000));
            assert(result.uid, "Failed to write to file");
            pass("testFSWriteLargeFile passed");
        } catch (error) {
            fail("testFSWriteLargeFile failed:", error);
        }    
    },

    testFSReadLargeFile = async ()=>{
        try {
            let randName = puter.randName();
            await puter.fs.write(randName, 'testValue'.repeat(100000));
            const result = await (await puter.fs.read(randName)).text();
            assert(result === 'testValue'.repeat(100000), "Failed to read from file");
            pass("testFSReadLargeFile passed");
        } catch (error) {
            fail("testFSReadLargeFile failed:", error);
        }    
    },

    testFSRenameFile = async ()=>{
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
    },

    testFSMoveFile = async ()=>{
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
    },
    
    testFSCopyFile = async ()=>{
        try {
            let randName = puter.randName();
            let randName2 = puter.randName();
            await puter.fs.write(randName, 'testValue');
            await puter.fs.mkdir(randName2);
            let result = await puter.fs.copy(randName, randName2);
            assert(Array.isArray(result) && result[0].uid, "Failed to copy file");
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
    },

    // copy a file to a directory with newName option
    testFSCopyFileWithNewName = async ()=>{
        try {
            let randName = puter.randName();
            let randName2 = puter.randName();
            await puter.fs.write(randName, 'testValue');
            await puter.fs.mkdir(randName2);
            let result = await puter.fs.copy(randName, randName2, { newName: 'newName' });
            assert(Array.isArray(result) && result[0].uid, "Failed to copy file");
            // check file name
            assert(result[0].name === 'newName', "Failed to copy file with new name");
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
    },

    testFSStat = async ()=>{
        try {
            let randName = puter.randName();
            await puter.fs.write(randName, 'testValue');
            let result = await puter.fs.stat(randName);
            assert(result.uid, "Failed to stat file");
            pass("testFSStat passed");
        } catch (error) {
            fail("testFSStat failed:", error);
        }    
    },

    testFSStatDir = async ()=>{
        try {
            let randName = puter.randName();
            await puter.fs.mkdir(randName);
            let result = await puter.fs.stat(randName);
            assert(result.uid, "Failed to stat directory");
            pass("testFSStatDir passed");
        } catch (error) {
            fail("testFSStatDir failed:", error);
        }    
    },

    testFSStatNonExistent = async ()=>{
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
    },

    // create a directory, write a number of files to it, then delete it
    testFSDeleteDirWithFiles = async ()=>{
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
    },
    // check if stat on a directory returns name, path, is_dir
    testFSStatDirReturnsAttrs = async ()=>{
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
    },

    // test read() with the object returned by write()
    testFSReadWithWriteResult = async ()=>{
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
    },

    // test stat() with the object returned by write()
    testFSStatWithWriteResult = async ()=>{
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
    },

    // test creating files with names from naughtyStrings
    testFSWriteWithNaughtyStrings = async ()=>{
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
    },
];