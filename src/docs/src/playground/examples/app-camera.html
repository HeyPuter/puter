<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image Description App</title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css">
    <style>
        body {
            padding: 20px;
        }

        #camera {
            margin-bottom: 10px;
        }

        #output {
            margin-top: 20px;
        }

        .spinner {
            border: 4px solid rgba(0, 0, 0, 0.1);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border-left-color: #09f;
            animation: spin 1s ease infinite;
            margin: 0 auto;
        }

        @keyframes spin {
            0% {
                transform: rotate(0deg);
            }
            100% {
                transform: rotate(360deg);
            }
        }
    </style>
    <script src="https://js.puter.com/v2/"></script>
</head>

<body>
    <div class="container">
        <h2 class="text-center">Image Description App</h2>
        <div class="row justify-content-center my-4">
            <video id="camera" width="320" height="240" autoplay></video>
        </div>
        <div class="text-center">
            <button id="submit" class="btn btn-primary" disabled>Describe Photo Using AI</button>
            <canvas id="canvas" width="320" height="240" style="display: none;"></canvas>
        </div>
        <div id="output" class="mt-3"></div>
    </div>

    <script>
        const video = document.getElementById('camera');
        const canvas = document.getElementById('canvas');
        const context = canvas.getContext('2d');
        const submitButton = document.getElementById('submit');
        const outputDiv = document.getElementById('output');

        // Function to show the spinner
        function showSpinner() {
            const spinner = document.createElement('div');
            spinner.classList.add('spinner');
            outputDiv.innerHTML = '';
            outputDiv.appendChild(spinner);
        }

        // Function to hide the spinner
        function hideSpinner() {
            outputDiv.innerHTML = '';
        }

        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                submitButton.disabled = false;
                video.srcObject = stream;
            });

        submitButton.onclick = function () {
            showSpinner();
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = canvas.toDataURL('image/png');
            // Disable submit button
            submitButton.disabled = true;
            // Send imageData to puter.ai.chat for analysis
            puter.ai.chat("Describe this image", imageData)
                .then(response => {
                    hideSpinner();
                    submitButton.disabled = false;
                    outputDiv.innerText = 'Image Description: ' + response;
                })
                .catch(error => {
                    hideSpinner();
                    submitButton.disabled = false;
                    console.error('Error:', error);
                    outputDiv.innerText = 'Error in getting description';
                });
        };
    </script>
</body>

</html>