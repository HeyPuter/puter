document.addEventListener("DOMContentLoaded", () => {
    // Elements
    const textInput = document.getElementById("text-input");
    const voiceSelect = document.getElementById("voice-select");
    const languageSelect = document.getElementById("language-select");
    const speakBtn = document.getElementById("speak-btn");
    const testModeBtn = document.getElementById("test-mode-btn");
    const stopBtn = document.getElementById("stop-btn");
    const audioContainer = document.getElementById("audio-container");
    const statusMessage = document.getElementById("status-message");

    // State
    let voices = [];
    let languages = [];
    let currentAudio = null;
    let testMode = false;

    // Initialize
    init();

    async function init() {
        updateStatus("Initializing app...");
        try {
            await loadVoices();
            //   populateLanguages();
            updateStatus("Ready to convert text to speech!");
        } catch (error) {
            updateStatus(`Error initializing: ${error.message}`, true);
            console.error("Initialization error:", error);
        }
    }

    async function loadVoices() {
        updateStatus("Loading voices...");
        const voices = await puter.ai.listVoices();
        console.log(voices);

        // Clear loading option and populate voice select
        voiceSelect.innerHTML = "";

        // Populate voice select
        voices.forEach((voice) => {
            const option = document.createElement("option");
            option.value = voice.id;
            option.textContent = `${voice.name} (${voice.language.name})`;
            voiceSelect.appendChild(option);
        });

        updateStatus(`Loaded ${voices.length} voices`);
    }

    function populateLanguages() {
        // Extract unique languages from voices
        const uniqueLanguages = new Map();

        voices.forEach((voice) => {
            if (!uniqueLanguages.has(voice.language.code)) {
                uniqueLanguages.set(voice.language.code, voice.language.name);
            }
        });

        // Clear loading option
        languageSelect.innerHTML = "";

        // Add default option
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = "Auto (use voice default)";
        languageSelect.appendChild(defaultOption);

        // Add language options
        uniqueLanguages.forEach((name, code) => {
            const option = document.createElement("option");
            option.value = code;
            option.textContent = `${name} (${code})`;
            languageSelect.appendChild(option);
        });
    }

    async function convertTextToSpeech() {
        const text = textInput.value.trim();
        if (!text) {
            updateStatus("Please enter some text to convert", true);
            return;
        }

        const selectedVoice = voiceSelect.value;
        const selectedLanguage = languageSelect.value;

        updateStatus("Converting text to speech...");
        speakBtn.disabled = true;

        try {
            const audio = await puter.ai.txt2speech(text);

            // Display the audio
            displayAudio(audio);
            updateStatus("Text converted to speech successfully!");
        } catch (error) {
            updateStatus(
                `Error converting text to speech: ${error.message}`,
                true
            );
            console.error("Text-to-speech error:", error);
        } finally {
            speakBtn.disabled = false;
        }
    }

    function displayAudio(audio) {
        // Stop any currently playing audio
        if (currentAudio) {
            currentAudio.pause();
        }

        // Clear the audio container
        audioContainer.innerHTML = "";

        // Set the current audio
        currentAudio = audio;

        // Add controls to the audio element
        audio.controls = true;

        // Add the audio to the container
        audioContainer.appendChild(audio);

        // Enable stop button
        stopBtn.disabled = false;

        // Add event listener for when audio ends
        audio.addEventListener("ended", () => {
            stopBtn.disabled = true;
        });
    }

    function stopAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            stopBtn.disabled = true;
        }
    }

    function updateStatus(message, isError = false) {
        statusMessage.textContent = message;
        statusMessage.className = isError ? "error" : "success";
    }

    function toggleTestMode() {
        testMode = !testMode;
        testModeBtn.textContent = testMode ? "Test Mode: ON" : "Test Mode";
        updateStatus(`Test mode ${testMode ? "enabled" : "disabled"}`);
    }

    // Event Listeners
    speakBtn.addEventListener("click", convertTextToSpeech);
    stopBtn.addEventListener("click", stopAudio);
    testModeBtn.addEventListener("click", toggleTestMode);

    // Change voice based on language selection
    languageSelect.addEventListener("change", () => {
        const selectedLanguage = languageSelect.value;
        if (selectedLanguage) {
            // Find the first voice that matches the selected language
            const matchingVoice = voices.find(
                (voice) => voice.language.code === selectedLanguage
            );
            if (matchingVoice) {
                voiceSelect.value = matchingVoice.id;
            }
        }
    });
});
