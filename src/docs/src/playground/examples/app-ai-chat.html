<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Chat App</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background-color: #f0f0f0;
            flex-direction: column;
        }

        #chat-container {
            width: 80%;
            max-width: 600px;
            margin: auto;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        #messages {
            height: 300px;
            overflow-y: auto;
            border-bottom: 1px solid #ddd;
            margin-bottom: 20px;
            padding: 10px;
        }

        .message {
            padding: 5px;
            margin: 5px 0;
            border-radius: 4px;
            background: #2c7aef;
            color: white;
        }

        .user-message {
            text-align: right;
            background: #f9f9f9;
            color: black;
        }

        .user-message .message {
            background: #e0f7fa;
        }

        #chat-input {
            display: flex;
        }

        #chat-input input {
            flex-grow: 1;
            padding: 10px;
            margin-right: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }

        #chat-input button {
            padding: 10px 20px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }

        #chat-input button:hover {
            background: #0056b3;
        }
    </style>
    <script src="https://js.puter.com/v2/"></script>

</head>

<body>
    <div id="chat-container">
        <div id="messages"></div>
        <div id="chat-input">
            <input type="text" id="input-message" placeholder="Type a message...">
            <button onclick="sendMessage()">Send</button>
        </div>
    </div>
    <p>Created using Puter.JS</p>

    <script>
        const messages = [];
        function addMessage(msg, isUser) {
            const messagesDiv = document.getElementById("messages");
            const messageDiv = document.createElement("div");
            messageDiv.classList.add("message");
            if (isUser) {
                messageDiv.classList.add("user-message");
            }
            messageDiv.textContent = msg;
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function sendMessage() {
            const input = document.getElementById("input-message");
            const message = input.value.trim();
            if (message) {
                addMessage(message, true);
                input.value = '';
                // Record the message in array of messages
                messages.push({ content: message, role: 'user' });
                // Call the AI chat function
                puter.ai.chat(messages).then(response => {
                    addMessage(response, false);
                    messages.push(response.message);
                }).catch(error => {
                    console.error("AI response error:", error);
                });
            }
        }
    </script>
</body>

</html>