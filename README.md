# SpeechifyAI provider for the Vercel AI SDK

`@speechify/ai-sdk-provider` adds [SpeechifyAI](https://speechify.ai) text to speech to the [Vercel AI SDK](https://ai-sdk.dev).
It implements the AI SDK's speech model specification (`SpeechModelV4`), so `generateSpeech()` works with Speechify's Simba 3 models, including Simba 3.5 and returns word-level speech marks with every clip.
It is maintained by Speechify and calls [`POST /v1/audio/speech`](https://docs.speechify.ai/build/api-reference/v1/audio/speech) with `fetch`, with no other runtime dependency.

## Install

```bash
npm install @speechify/ai-sdk-provider ai
```

Requires AI SDK 7 (`ai@^7` with `@ai-sdk/provider@^4`), which runs on Node.js 22 or later and other runtimes with `fetch`.

Set your API key, which you can get by [signing up for free](https://platform.speechify.ai/signup?utm_source=npm&utm_medium=readme&utm_campaign=vercel-ai-sdk):

```bash
export SPEECHIFY_API_KEY="your-api-key"
```

## Example

```ts
import { writeFile } from 'node:fs/promises';
import { generateSpeech } from 'ai';
import { speechify } from '@speechify/ai-sdk-provider';

const { audio, providerMetadata } = await generateSpeech({
  model: speechify.speech('simba-3.5'),
  text: 'Hello from Speechify and the AI SDK.',
  voice: 'harper_32',
});

await writeFile('hello.mp3', audio.uint8Array);
console.log(providerMetadata.speechify?.speechMarks);
```

## Provider instance

`speechify` is a default instance that reads `SPEECHIFY_API_KEY` when a request is made.
Use `createSpeechify` to configure your own:

```ts
import { createSpeechify } from '@speechify/ai-sdk-provider';

const speechify = createSpeechify({
  apiKey: process.env.SPEECHIFY_API_KEY,
});
```

| Setting | Default | Notes |
| --- | --- | --- |
| `apiKey` | `SPEECHIFY_API_KEY` | Sent as `Authorization: Bearer <key>`. |
| `baseURL` | `https://api.speechify.ai` | The provider appends `/v1/audio/speech`. |
| `headers` | none | Added to every request, overriding the provider's own headers. |
| `fetch` | `globalThis.fetch` | A custom implementation, for example for a proxy or tests. |

## Models and voices

| Model | Languages |
| --- | --- |
| `simba-3.5` | Newest model, and the one to start with. 48 languages and 1,107 voices, and it works with every voice. |
| `simba-3.2` | English. Lowest latency and richest expressivity. Every English voice, cloned voices included. |
| `simba-3.0` | English, German, Spanish (Spain and Mexico), French, Italian and Brazilian Portuguese. |

A voice works with a model when the model is in that voice's `models` list in [`GET /v1/voices`](https://docs.speechify.ai/build/api-reference/v1/voices/get).
`harper_32` is the default voice and works with every model.
A voice the model cannot serve fails with a `400`, and an unknown voice with a `404`.

## Options

| `generateSpeech()` option | Sent to Speechify as | Behaviour |
| --- | --- | --- |
| `text` | `input` | Plain text or SSML, up to 2,000 characters per request, markup included. |
| `voice` | `voice_id` | Defaults to `harper_32`. |
| `outputFormat` | `audio_format` or `output_format` | Defaults to `mp3`. `mp3`, `wav`, `ogg`, `aac` and `pcm` go to `audio_format`. Codec strings (`mp3_24000_128`, `pcm_16000`, `ulaw_8000`, `wav_48000` and the rest of the [API's list](https://docs.speechify.ai/build/api-reference/v1/audio/speech)) go to `output_format`. `mulaw` and `ulaw` mean `ulaw_8000`. Anything else falls back to `mp3` with a warning. |
| `speed` | SSML `<prosody rate>` | A multiplier from 0.5 to 100: `1.25` sends `rate="+25%"`. Plain text is escaped and wrapped in `<speak>`, and SSML input gets the prosody element inside its own `<speak>`. Billing and speech-mark offsets are unchanged. |
| `language` | `language` | An ISO 639-1 code (`de`) or a locale (`de-DE`). `auto` sends nothing, which is the API's documented auto-detect mode. |
| `instructions` | not sent | Speechify has no free-text instructions field, so this always produces a warning. |
| `providerOptions.speechify.loudnessNormalization` | `options.loudness_normalization` | Normalizes loudness to -14 LUFS. Adds latency. |
| `providerOptions.speechify.textNormalization` | `options.text_normalization` | Reads numbers and dates as words. On by default in the API. |
| `headers` | request headers | Per-call headers, applied last. |
| `abortSignal` | | Cancels the request. |

```ts
const { audio } = await generateSpeech({
  model: speechify.speech('simba-3.5'),
  text: 'Guten Tag, das ist ein kurzer Test.',
  voice: 'anton',
  language: 'de',
  outputFormat: 'mp3_24000_128',
  speed: 1.1,
  providerOptions: { speechify: { loudnessNormalization: true } },
});
```

`speed` adds up to 50 characters of markup to `input`, and the 2,000-character limit counts markup.
On plain text it also escapes `&`, `<` and `>`, so each one counts as its entity (`&amp;` is five characters).

## Warnings

An option that Speechify cannot honour is never dropped silently.
It comes back on `result.warnings`, and the AI SDK logs it unless you turn warning logging off.

| Warning `feature` | When | What the provider does |
| --- | --- | --- |
| `instructions` | `instructions` is set | Does not send it. Shape delivery with SSML in `text` instead: breaks and prosody rate are applied by the Simba 3 models. |
| `outputFormat` | The format is not one Speechify serves (for example `flac` or `opus`) | Requests `mp3`. |
| `speed` | `speed` is below 0.5 or above 100 | Clamps it to the nearest bound. |
| `speed` | `speed` is zero, negative or not a number | Ignores it. |
| `providerOptions.speechify.<key>` | An unknown key under `providerOptions.speechify` | Does not send it. |

Errors are thrown rather than warned about:

- A missing API key throws `LoadAPIKeyError` before any request is made.
- A `providerOptions.speechify` value of the wrong type throws `InvalidArgumentError`.
- A non-2xx response throws `APICallError` with the API's error code, message and request id. `408`, `409`, `429`, `5xx` and network failures are marked retryable, so `generateSpeech()` retries them up to `maxRetries` times.

## Speech marks and metadata

Every result carries Speechify's speech marks and billing count under `providerMetadata.speechify`:

| Field | Value |
| --- | --- |
| `speechMarks` | The [speech marks](https://docs.speechify.ai/build/guides/text-to-speech/speech-marks) for the clip: one sentence-level object with a `chunks` array of words. Times are in milliseconds. `start` and `end` index characters of your text. |
| `billableCharactersCount` | Characters billed for the request. AI SDK telemetry also receives it as `usage.billable_characters_count`. |
| `audioFormat` | The codec the API returned: `mp3`, `wav`, `ogg`, `aac`, `pcm` or `ulaw`. |
| `outputFormat` | The full codec string, when you asked for one (for example `pcm_16000`). |
| `requestId` | The `Speechify-Request-Id`, to quote to support. |

```ts
import type { SpeechifySpeechProviderMetadata } from '@speechify/ai-sdk-provider';

const { speechMarks } = result.providerMetadata.speechify as SpeechifySpeechProviderMetadata;
for (const word of speechMarks?.chunks ?? []) {
  console.log(word.value, word.start_time, word.end_time);
}
```

## Headless formats and `audio.mediaType`

The AI SDK sets `audio.mediaType` by sniffing the audio bytes, which works for `mp3`, `wav`, `ogg` and `aac`.
Raw PCM and u-law have no header, so the SDK falls back to the `outputFormat` you passed.
`pcm` gives `audio/pcm` and `mulaw` gives `audio/mulaw`, but a codec string such as `pcm_16000` gives the SDK's default, `audio/mp3`.
For headerless formats, read the encoding and sample rate from `providerMetadata.speechify.outputFormat` instead of `audio.mediaType`.
`pcm` without a rate is 16-bit little-endian mono at 24 kHz, and `mulaw` is `ulaw_8000`.

## API version

Every request sends `Speechify-Version: 2026-09-30`, so the provider behaves the same whatever your workspace's default API version is.
At this version the legacy `simba-english` and `simba-multilingual` models return `400 model_retired`, and `pcm_16000` is true 16 kHz audio.
To pin a different version, set the header yourself:

```ts
const speechify = createSpeechify({ headers: { 'Speechify-Version': '2026-09-13' } });
```

A new release of this package moves the pin forward only with a note on what changed.
The pinned value is exported as `SPEECHIFY_API_VERSION`.

## What the provider does not do

- **Streaming.** The AI SDK's speech interface returns a whole clip. For audio you play while it is generated, call [`POST /v1/audio/stream`](https://docs.speechify.ai/build/guides/text-to-speech/streaming) directly.
- **Texts over 2,000 characters.** Split them, or use the streaming endpoint, which accepts 20,000.
- **Browser keys.** Call it from server code. An API key shipped to a browser is readable by anyone who opens the page.

## Attribution headers

The provider sends `Speechify-Caller: vercel-ai-sdk` and `Speechify-Caller-Version` with this package's version, so the requests show up as this integration in your workspace's request log.
The headers never affect access, rate limits or price.

## Links

- [Using Speechify with the AI SDK](https://docs.speechify.ai/build/guides/integrations/vercel-ai-sdk?utm_source=npm&utm_medium=readme&utm_campaign=vercel-ai-sdk)
- [AI SDK speech documentation](https://ai-sdk.dev/docs/ai-sdk-core/speech)
- [Speechify API reference](https://docs.speechify.ai/build/api-reference/v1/audio/speech)
- [Issues](https://github.com/Speechify-AI/ai-sdk-provider/issues)

## License

MIT
