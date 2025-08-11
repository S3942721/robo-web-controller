const { readFileSync } = require("fs");
const { join } = require("path");

const DefaultInferenceConfiguration = {
    topP: 0.9,
    temperature: 0.7,
};


const DefaultAudioInputConfiguration = {
    audioType: "SPEECH",
    encoding: "base64",
    mediaType: "audio/lpcm",
    sampleRateHertz: 16000,
    sampleSizeBits: 16,
    channelCount: 1,
};

const DefaultAudioOutputConfiguration = {
    ...DefaultAudioInputConfiguration,
    sampleRateHertz: 24000,
    voiceId: "tiffany",
};

const MAX_QUEUE_SIZE = 200;
const MAX_CHUNKS_PER_BATCH = 5;

const DefaultTextConfiguration = { mediaType: "text/plain" }

const DefaultSystemPrompt = readFileSync(join(__dirname, "prompt-new.md"), 'utf8');

const DefaultToolSchema = JSON.stringify({
  "type": "object",
  "properties": {},
  "required": []
});

const ToolsDefinition = {
   tools: [
      {
         toolSpec: {
            name: "RequestEndInterview",
            description: "Use this tool to end the interview.",
            inputSchema: { json: DefaultToolSchema },
         }
      },
   ]
}

module.exports = {
   DefaultInferenceConfiguration,
   DefaultAudioInputConfiguration,
   DefaultAudioOutputConfiguration,
   MAX_QUEUE_SIZE,
   MAX_CHUNKS_PER_BATCH,
   DefaultTextConfiguration,
   DefaultSystemPrompt,
   ToolsDefinition
}