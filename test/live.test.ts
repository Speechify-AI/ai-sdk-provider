// Live smoke test against the real API: three short requests.
// Runs only with SPEECHIFY_API_KEY set, via `npm run test:live`.
import { APICallError } from '@ai-sdk/provider';
import { generateSpeech } from 'ai';
import { describe, expect, it } from 'vitest';
import { createSpeechify, SPEECHIFY_API_VERSION, VERSION } from '../src/index';

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const TEXT = 'The AI SDK calls this provider, and the provider calls Speechify.';

describe.skipIf(!process.env.SPEECHIFY_API_KEY)('live: POST /v1/audio/speech', () => {
  const sent: Headers[] = [];
  const speechify = createSpeechify({
    fetch: (url, init) => {
      sent.push(new Headers(init?.headers));
      return fetch(url, init);
    },
  });

  let baselineMs = 0;

  it('generates mp3 with speech marks and attribution headers', async () => {
    const result = await generateSpeech({
      model: speechify.speech('simba-3.2'),
      text: TEXT,
      maxRetries: 0,
    });

    expect(result.audio.mediaType).toBe('audio/mpeg');
    expect(result.audio.uint8Array.byteLength).toBeGreaterThan(10_000);
    expect(result.warnings).toEqual([]);

    const metadata = result.providerMetadata.speechify as Record<string, any>;
    expect(metadata.audioFormat).toBe('mp3');
    expect(metadata.billableCharactersCount).toBe(TEXT.length);
    expect(metadata.speechMarks.value).toBe(TEXT);
    expect(metadata.speechMarks.chunks.length).toBeGreaterThan(5);
    expect(metadata.requestId).toEqual(expect.any(String));
    baselineMs = metadata.speechMarks.end_time;

    const headers = sent.at(-1) as Headers;
    expect(headers.get('speechify-caller')).toBe('vercel-ai-sdk');
    expect(headers.get('speechify-caller-version')).toBe(VERSION);
    expect(headers.get('speechify-version')).toBe(SPEECHIFY_API_VERSION);
  });

  it('applies speed as a prosody rate without changing billing or mark offsets', async () => {
    const result = await generateSpeech({
      model: speechify.speech('simba-3.2'),
      text: TEXT,
      speed: 1.5,
      maxRetries: 0,
    });

    const metadata = result.providerMetadata.speechify as Record<string, any>;
    expect(metadata.billableCharactersCount).toBe(TEXT.length);
    expect(metadata.speechMarks.value).toBe(TEXT);
    expect(metadata.speechMarks.end_time).toBeLessThan(baselineMs * 0.8);
  });

  it('surfaces an API error as a non-retryable APICallError', async () => {
    const error = await generateSpeech({
      model: speechify.speech('simba-3.2'),
      text: 'Hi',
      voice: 'voice_that_does_not_exist',
      maxRetries: 0,
    }).catch((e: unknown) => e);

    expect(APICallError.isInstance(error)).toBe(true);
    expect((error as APICallError).statusCode).toBe(404);
    expect((error as APICallError).isRetryable).toBe(false);
    expect((error as APICallError).message).toContain('voice_not_found');
  });
});
