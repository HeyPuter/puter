<!DOCTYPE html>
<html>
<head>
    <title>Weather Function Calling Demo</title>
    <script src="https://js.puter.com/v2/"></script>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; }
        .container { border: 1px solid #ccc; padding: 20px; border-radius: 5px; }
        input { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
        button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;}
        button:disabled { background: #ccc; }
        #response { margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; display: none;}
    </style>
</head>
<body>
    <div class="container">
        <h1>Weather Function Calling Demo</h1>
        <input type="text" id="userInput" value="What's the weather in Paris?" placeholder="Ask about the weather" />
        <button id="submit">Submit</button>
        <div id="response"></div>
    </div>

    <script>
        // Mock weather function
        function getWeather(location) {
            const mockWeatherData = {
                'Paris': '22°C, Partly Cloudy',
                'London': '18°C, Rainy',
                'New York': '25°C, Sunny',
                'Tokyo': '28°C, Clear'
            };
            return mockWeatherData[location] || '20°C, Unknown';
        }

        // Define the tools available to the AI
        const tools = [{
            type: "function",
            function: {
                name: "get_weather",
                description: "Get current weather for a given location",
                parameters: {
                    type: "object",
                    properties: {
                        location: {
                            type: "string",
                            description: "City name e.g. Paris, London"
                        }
                    },
                    required: ["location"]
                }
            }
        }];

        async function handleSubmit() {
            const userInput = document.getElementById('userInput').value;
            const submitBtn = document.getElementById('submit');
            const responseDiv = document.getElementById('response');
            
            if (!userInput) return;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Loading...';
            responseDiv.style.display = 'none';

            try {
                const completion = await puter.ai.chat(userInput, { tools });
                let finalResponse;

                // Check if AI wants to call a function
                if (completion.message.tool_calls?.length > 0) {
                    const toolCall = completion.message.tool_calls[0];
                    if (toolCall.function.name === 'get_weather') {
                        const args = JSON.parse(toolCall.function.arguments);
                        const weatherData = getWeather(args.location);
                        
                        // Send weather data back to AI for final response
                        finalResponse = await puter.ai.chat([
                            { role: "user", content: userInput },
                            completion.message,
                            { 
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: weatherData
                            }
                        ]);
                    }
                } else {
                    finalResponse = completion;
                }

                responseDiv.innerHTML = `<strong>Response:</strong><br>${finalResponse}`;
                responseDiv.style.display = 'block';
            } catch (error) {
                responseDiv.innerHTML = `<strong>Error:</strong><br>${error.message}`;
                responseDiv.style.display = 'block';
            }

            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
        }

        // Event handlers
        document.getElementById('submit').addEventListener('click', handleSubmit);
        document.getElementById('userInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') handleSubmit();
        });
    </script>
</body>
</html>