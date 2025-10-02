<!DOCTYPE html>
<html>
<head>
    <title>Resume Analyzer</title>
    <script src="https://js.puter.com/v2/"></script>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px;}
        .container { border: 1px solid #ccc; padding: 20px; border-radius: 5px;}
        .upload-area {border: 2px dashed #ccc; padding: 40px; text-align: center; margin: 20px 0; border-radius: 5px; cursor: pointer;  transition: border-color 0.3s;}
        .upload-area:hover {border-color: #007bff;}
        .upload-area.dragover { border-color: #007bff; background-color: #f8f9fa;}
        input[type="file"] { display: none;}
        button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; margin-top: 10px;}
        button:disabled { background: #ccc; }
        #response { margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; display: none; }
        .file-name { margin-top: 10px; font-style: italic; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Resume Analyzer</h1>
        <p>Upload your resume (PDF, DOC, or TXT) and get a quick analysis of your key strengths in two sentences.</p>
        
        <div class="upload-area" onclick="document.getElementById('fileInput').click()">
            <p>Click here to upload your resume or drag and drop</p>
            <input type="file" id="fileInput" accept=".pdf,.doc,.docx,.txt" />
        </div>
        
        <div class="file-name" id="fileName" style="display: none;"></div>
        
        <button id="analyzeBtn" disabled>Analyze My Resume</button>
        
        <div id="response"></div>
    </div>

    <script>
        let uploadedFile = null;
        
        // File upload handling
        const fileInput = document.getElementById('fileInput');
        const uploadArea = document.querySelector('.upload-area');
        const fileName = document.getElementById('fileName');
        const analyzeBtn = document.getElementById('analyzeBtn');
        const response = document.getElementById('response');

        fileInput.addEventListener('change', handleFileSelect);
        uploadArea.addEventListener('dragover', handleDragOver);
        uploadArea.addEventListener('drop', handleDrop);

        function handleFileSelect(e) {
            const file = e.target.files[0];
            if (file) {
                uploadedFile = file;
                fileName.textContent = `Selected: ${file.name}`;
                fileName.style.display = 'block';
                analyzeBtn.disabled = false;
            }
        }

        function handleDragOver(e) {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        }

        function handleDrop(e) {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const file = e.dataTransfer.files[0];
            if (file) {
                uploadedFile = file;
                fileName.textContent = `Selected: ${file.name}`;
                fileName.style.display = 'block';
                analyzeBtn.disabled = false;
            }
        }

        // Remove dragover class when drag leaves
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        // Analyze resume
        analyzeBtn.addEventListener('click', async () => {
            if (!uploadedFile) return;

            analyzeBtn.disabled = true;
            analyzeBtn.textContent = 'Analyzing...';
            response.style.display = 'none';

            try {
                // First, upload the file to Puter
                const puterFile = await puter.fs.write(`temp_resume_${Date.now()}.${uploadedFile.name.split('.').pop()}`,
                    uploadedFile
                );

                const uploadedPath = puterFile.path;

                // Analyze the resume with AI
                const completion = await puter.ai.chat([
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'file',
                                puter_path: uploadedPath
                            },
                            {
                                type: 'text',
                                text: 'Please analyze this resume and suggest how to improve it. Only a few sentences are needed.'
                            }
                        ]
                    }
                ], { model: 'claude-sonnet-4', stream: true });

                let text = '';

                // Display the response
                for await ( const part of completion ) {
                    text += part?.text;
                    response.innerHTML = text;
                }

                response.style.display = 'block';

                // Clean up the temporary file
                await puter.fs.delete(uploadedPath);

            } catch (error) {
                response.innerHTML = `<strong>Error:</strong><br>${error.message}`;
                response.style.display = 'block';
            }

            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze My Resume';
        });
    </script>
</body>
</html>