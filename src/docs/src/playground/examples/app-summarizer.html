<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Text Summarizer</title>
    <link href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body {
            background-color: #f8f9fa;
        }

        .container {
            max-width: 800px;
            margin-top: 40px;
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
    <div class="container mt-4">
        <h2>Text Summarizer</h2>
        <textarea id="textInput" class="form-control my-3" rows="6" placeholder="Enter text here..."></textarea>
        <button id="summarizeButton" class="btn btn-primary">Summarize</button>
        <div id="summaryOutput" class="mt-3"></div>
    </div>

    <script>
        const summaryOutput = document.getElementById('summaryOutput');
        // Function to show the spinner
        function showSpinner() {
            const spinner = document.createElement('div');
            spinner.classList.add('spinner');
            summaryOutput.innerHTML = '';
            summaryOutput.appendChild(spinner);
        }

        // Function to hide the spinner
        function hideSpinner() {
            summaryOutput.innerHTML = '';
        }

        document.getElementById('summarizeButton').addEventListener('click', async function () {
            var inputText = document.getElementById('textInput').value;
            showSpinner();
            // disable the button
            document.getElementById('summarizeButton').disabled = true;

            puter.ai.chat(`Please read the following text and provide a concise summary of its main points. Focus solely on summarizing the key themes, ideas, or events presented in the text. Do not include any additional explanations or descriptions outside of the summary itself. Here's the text: ${inputText}`).then(function (response) {
                // enable the button
                document.getElementById('summarizeButton').disabled = false;
                hideSpinner();
                // print the response
                summaryOutput.innerHTML = response;
            }).catch(function (error) {
                // enable the button
                document.getElementById('summarizeButton').disabled = false;
                hideSpinner();
                // print the error
                summaryOutput.innerHTML = `<div class="alert alert-danger" role="alert">${error.message ?? error}</div>`;
            });
        });
    </script>
</body>

</html>