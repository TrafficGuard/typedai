# AI Chat

TypedAI provides a chat interface like chatgpt.com or claude.ai.

## LLM configuration

You will need to configure the API keys for the LLMs services you want to use in either the environment variables or your user profile in the UI.

When a LLM service has a key configured, then its LLMs will be available in the LLM selector.

## LLM selection

The LLM model selection can be changed over a conversation, so you can select the optimial LLM for each message.

- Choose a LLM from Cerebras for a blazing fast response.
- Switch to Perplexity to synthesize the latest information online.
- Select Gemini 2.5 Pro, o3, Claude or Groq for the most advanced reasoning.

The model selection allows selecting the composite implementations of the LLM interface which use multiple LLMs to generate and compare multiple responses before returning the final response.

## Attachments

Images and PDF files can be attached to a message. However, it is required that the LLM selected supports all the file/image types
in the new and previous messages, otherwise an error will occur.

## Keyboard shortcuts

The following keyboard shortcuts are available to enhance your productivity:

*   **Send Message**: `Ctrl + Enter` or `Cmd + Enter`
*   **Open LLM Selector**: `Ctrl + M`
*   **Attach File**: `Ctrl + A`
*   **Toggle Chat Info Panel**: `Ctrl + I`
*   **Toggle Thinking Level**: `Ctrl + T` (Cycles through any available "thinking" levels for the LLM)
*   **Toggle Reformat as Markdown on send**: `Ctrl + F`
*   **Format message input field as Markdown**: `Ctrl + Shift + F`

## Message stats

Hovering over the information icon at the bottom right of each AI generated message will show:

-   **LLM**: The LLM used to generate the message
-   **Tokens**: The number of input and output tokens used to generate the message
-   **Duration**: The duration of the LLM call
-   **Cost**: The cost in USD of the LLM call

The copy-to-clipboard button displays for each entire message, and for each Markdown section of a message.

## Screenshots

![Chats](https://public.trafficguard.ai/typedai/chat.png)