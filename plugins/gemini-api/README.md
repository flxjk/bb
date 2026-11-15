# Gemini API

An AI service for bb's helper tasks — thread titles and commit messages — that
calls Gemini directly through the official `@google/genai` SDK with an AI Studio
API key. It is a separate service beside the Gemini CLI provider: this one needs no
CLI, no OAuth and no Google Cloud project.

## Settings

| Setting  | Meaning                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| `apiKey` | An AI Studio key. Stored as a plugin secret, never sent to the app.                                             |
| `model`  | The model id to answer with. Titles and commit messages abort after five seconds, so keep this to a fast model. |

The default is `gemini-3.1-flash-lite`. `gemini-3.8-flash` is a step up;
`gemini-4-carbon` answers through the API key as well, but as a thinking model it
spends seconds on reasoning and rarely finishes inside the five second budget bb
gives a title.

## Usage

Select **Gemini (API)** per task in Settings → AI services, or by CLI:

```bash
bb settings ai-services set thread-title gemini-api/gemini-api
bb settings ai-services set commit-message gemini-api/gemini-api
```
