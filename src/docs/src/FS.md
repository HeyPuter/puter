---
title: FS
description: Store and manage data in the cloud with Puter.js file system API.
---

The Cloud Storage API lets you store and manage data in the cloud.

It comes with a comprehensive but familiar file system operations including write, read, delete, move, and copy for files, plus powerful directory management features like creating directories, listing contents, and much more.

With Puter.js, you don't need to worry about setting up storage infrastructure such as configuring buckets, managing CDNs, or ensuring availability, since everything is handled for you. Additionally, with the [User-Pays Model](/user-pays-model/), you don't have to worry about storage or bandwidth costs, as users of your application cover their own usage.

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="write"><span>Write File</span></div>
    <div class="example-group" data-section="read"><span>Read File</span></div>
    <div class="example-group" data-section="mkdir"><span>Create Directory</span></div>
    <div class="example-group" data-section="readdir"><span>List Directory</span></div>
    <div class="example-group" data-section="rename"><span>Rename</span></div>
    <div class="example-group" data-section="copy"><span>Copy</span></div>
    <div class="example-group" data-section="move"><span>Move</span></div>
    <div class="example-group" data-section="stat"><span>Get Info</span></div>
    <div class="example-group" data-section="delete"><span>Delete</span></div>
    <div class="example-group" data-section="upload"><span>Upload</span></div>
</div>

<div class="example-content" data-section="write" style="display:block;">

#### Create a new file containing "Hello, world!"

```html;fs-write
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Create a new file called "hello.txt" containing "Hello, world!"
        puter.fs.write('hello.txt', 'Hello, world!').then(() => {
            puter.print('File written successfully');
        })
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="read">

#### Reads data from a file

```html;fs-read
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random text file
            let filename = puter.randName() + ".txt";
            await puter.fs.write(filename, "Hello world! I'm a file!");
            puter.print(`"${filename}" created<br>`);

            // (2) Read the file and print its contents
            let blob = await puter.fs.read(filename);
            let content = await blob.text();
            puter.print(`"${filename}" read (content: "${content}")<br>`);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="mkdir">

#### Create a new directory

```html;fs-mkdir
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Create a directory with random name
        let dirName = puter.randName();
        puter.fs.mkdir(dirName).then((directory) => {
            puter.print(`"${dirName}" created at ${directory.path}`);
        }).catch((error) => {
            puter.print('Error creating directory:', error);
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="readdir">

#### Read a directory

```html;fs-readdir
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.fs.readdir('./').then((items) => {
            // print the path of each item in the directory
            puter.print(`Items in the directory:<br>${items.map((item) => item.path)}<br>`);
        }).catch((error) => {
            puter.print(`Error reading directory: ${error}`);
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="rename">

#### Rename a file

```html;fs-rename
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // Create hello.txt
            await puter.fs.write('hello.txt', 'Hello, world!');
            puter.print(`"hello.txt" created<br>`);

            // Rename hello.txt to hello-world.txt
            await puter.fs.rename('hello.txt', 'hello-world.txt')
            puter.print(`"hello.txt" renamed to "hello-world.txt"<br>`);
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="copy">

#### Copy a file

```html;fs-copy
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => {
        // (1) Create a random text file
        let filename = puter.randName() + '.txt';
        await puter.fs.write(filename, 'Hello, world!');
        puter.print(`Created file: "${filename}"<br>`);

        // (2) create a random directory
        let dirname = puter.randName();
        await puter.fs.mkdir(dirname);
        puter.print(`Created directory: "${dirname}"<br>`);

        // (3) Copy the file into the directory
        puter.fs.copy(filename, dirname).then((file)=>{
            puter.print(`Copied file: "${filename}" to directory "${dirname}"<br>`);
        }).catch((error)=>{
            puter.print(`Error copying file: "${error}"<br>`);
        });
    })()
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="move">

#### Move a file

```html;fs-move
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => {
        // (1) Create a random text file
        let filename = puter.randName() + '.txt';
        await puter.fs.write(filename, 'Hello, world!');
        puter.print(`Created file: ${filename}<br>`);

        // (2) create a random directory
        let dirname = puter.randName();
        await puter.fs.mkdir(dirname);
        puter.print(`Created directory: ${dirname}<br>`);

        // (3) Move the file into the directory
        await puter.fs.move(filename, dirname);
        puter.print(`Moved file: ${filename} to directory ${dirname}<br>`);

        // (4) Delete the file and directory (cleanup)
        await puter.fs.delete(dirname + '/' + filename);
        await puter.fs.delete(dirname);
    })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="stat">

#### Get information about a file

```html;fs-stat
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // () create a file
            await puter.fs.write('hello.txt', 'Hello, world!');
            puter.print('hello.txt created<br>');

            // (2) get information about hello.txt
            const file = await puter.fs.stat('hello.txt');
            puter.print(`hello.txt name: ${file.name}<br>`);
            puter.print(`hello.txt path: ${file.path}<br>`);
            puter.print(`hello.txt size: ${file.size}<br>`);
            puter.print(`hello.txt created: ${file.created}<br>`);
        })()
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="delete">

#### Delete a file

```html;fs-delete
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random file
            let filename = puter.randName();
            await puter.fs.write(filename, 'Hello, world!');
            puter.print('File created successfully<br>');

            // (2) Delete the file
            await puter.fs.delete(filename);
            puter.print('File deleted successfully');
        })();
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="upload">

#### Upload a file from a file input

```html;fs-upload
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <input type="file" id="file-input" />
    <script>
        // File input
        let fileInput = document.getElementById('file-input');

        // Upload the file when the user selects it
        fileInput.onchange = () => {
            puter.fs.upload(fileInput.files).then((file) => {
                puter.print(`File uploaded successfully to: ${file.path}`);
            })
        };
    </script>
</body>
</html>
```

</div>

## Functions

These cloud storage features are supported out of the box when using Puter.js:

- **[`puter.fs.write()`](/FS/write/)** - Write data to a file
- **[`puter.fs.read()`](/FS/read/)** - Read data from a file
- **[`puter.fs.mkdir()`](/FS/mkdir/)** - Create a directory
- **[`puter.fs.readdir()`](/FS/readdir/)** - List contents of a directory
- **[`puter.fs.rename()`](/FS/rename/)** - Rename a file or directory
- **[`puter.fs.copy()`](/FS/copy/)** - Copy a file or directory
- **[`puter.fs.move()`](/FS/move/)** - Move a file or directory
- **[`puter.fs.stat()`](/FS/stat/)** - Get information about a file or directory
- **[`puter.fs.delete()`](/FS/delete/)** - Delete a file or directory
- **[`puter.fs.upload()`](/FS/upload/)** - Upload a file from the local system

## Examples

You can see various Puter.js Cloud Storage features in action from the following examples:

- Write
  - [Write File](/playground/fs-write/)
  - [Write a file with deduplication](/playground/fs-write-dedupe/)
  - [Create a new file with input coming from a file input](/playground/fs-write-from-input/)
  - [Create a file in a directory that does not exist](/playground/fs-write-create-missing-parents/)
- [Read File](/playground/fs-read/)
- Create Directory
  - [Make a Directory](/playground/fs-mkdir/)
  - [Create a directory with deduplication](/playground/fs-mkdir-dedupe/)
  - [Create a directory with missing parent directories](/playground/fs-mkdir-create-missing-parents/)
- [Read Directory](/playground/fs-readdir/)
- [Rename](/playground/fs-rename/)
- [Copy File/Directory](/playground/fs-copy/)
- Move
  - [Move File/Directory](/playground/fs-move/)
  - [Move a file with missing parent directories](/playground/fs-move-create-missing-parents/)
- [Get File/Directory Info](/playground/fs-stat/)
- Delete
  - [Delete a file](/playground/fs-delete/)
  - [Delete a directory](/playground/fs-delete-directory/)
- [Upload](/playground/fs-upload/)

## Tutorials

- [Add Upload to Your Website for Free](https://developer.puter.com/tutorials/add-upload-to-your-website-for-free/)
