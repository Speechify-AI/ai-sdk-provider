import { readFileSync } from 'node:fs';
import {
  APICallError,
  InvalidArgumentError,
  InvalidResponseDataError,
  LoadAPIKeyError,
  NoSuchModelError,
  type SpeechModelV4CallOptions,
} from '@ai-sdk/provider';
import { createProviderRegistry, generateSpeech } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeechify, SPEECHIFY_API_VERSION, speechify, VERSION } from './index';

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const packageVersion = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

// An MPEG frame header, so the AI SDK's media type sniffing sees mp3.
const MP3_BASE64 = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]).toString('base64');

const SPEECH_MARKS = {
  type: 'sentence',
  start: 0,
  end: 5,
  start_time: 0,
  end_time: 420,
  value: 'Hello',
  chunks: [{ type: 'word', start: 0, end: 5, start_time: 0, end_time: 420, value: 'Hello' }],
};

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function mockFetch(
  responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }> = [{}],
) {
  const calls: Captured[] = [];
  let index = 0;
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = responses[Math.min(index++, responses.length - 1)] ?? {};
    const body =
      next.body ??
      ({
        audio_data: MP3_BASE64,
        audio_format: 'mp3',
        billable_characters_count: 5,
        speech_marks: SPEECH_MARKS,
      } as unknown);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: next.status ?? 200,
      headers: {
        'content-type': 'application/json',
        'speechify-request-id': 'req_123',
        ...next.headers,
      },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function model(
  settings: Parameters<typeof createSpeechify>[0] = {},
  modelId = 'simba-3.2',
) {
  const mock = mockFetch();
  const provider = createSpeechify({ apiKey: 'test-key', fetch: mock.fetch, ...settings });
  return { model: provider.speech(modelId), ...mock };
}

async function generate(options: Partial<SpeechModelV4CallOptions> = {}, modelId?: string) {
  const ctx = model({}, modelId);
  const result = await ctx.model.doGenerate({ text: 'Hello', ...options });
  const call = ctx.calls[0] as Captured;
  return { result, call };
}

async function rejection(promise: PromiseLike<unknown>): Promise<unknown> {
  return Promise.resolve(promise).then(
    () => {
      throw new Error('expected the call to fail');
    },
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('posts to /v1/audio/speech with the default voice and mp3', async () => {
    const { call } = await generate();
    expect(call.url).toBe('https://api.speechify.ai/v1/audio/speech');
    expect(call.body).toEqual({
      input: 'Hello',
      voice_id: 'harper_32',
      model: 'simba-3.2',
      audio_format: 'mp3',
    });
  });

  it('accepts simba-3.5 and sends it as the model', async () => {
    const { call, result } = await generate({ voice: 'harper_32' }, 'simba-3.5');
    expect(call.body.model).toBe('simba-3.5');
    expect(result.response.modelId).toBe('simba-3.5');
  });

  it('sends the model id and voice as given', async () => {
    const { call } = await generate({ voice: 'geffen_32' }, 'simba-3.0');
    expect(call.body.model).toBe('simba-3.0');
    expect(call.body.voice_id).toBe('geffen_32');
  });

  it('uses a custom baseURL without doubling the slash', async () => {
    const mock = mockFetch();
    const provider = createSpeechify({
      apiKey: 'k',
      baseURL: 'https://proxy.example.com/speechify/',
      fetch: mock.fetch,
    });
    await provider.speech('simba-3.2').doGenerate({ text: 'Hi' });
    expect(mock.calls[0]?.url).toBe('https://proxy.example.com/speechify/v1/audio/speech');
  });
});

describe('headers', () => {
  it('authenticates and identifies the integration on every request', async () => {
    const { call } = await generate();
    expect(call.headers.get('authorization')).toBe('Bearer test-key');
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.headers.get('speechify-caller')).toBe('vercel-ai-sdk');
    expect(call.headers.get('speechify-caller-version')).toBe(packageVersion);
    expect(call.headers.get('speechify-version')).toBe('2026-09-30');
  });

  it('exports the pinned API version and the package version', () => {
    expect(SPEECHIFY_API_VERSION).toBe('2026-09-30');
    expect(VERSION).toBe(packageVersion);
  });

  it('lets provider and call headers override defaults case-insensitively', async () => {
    const mock = mockFetch();
    const provider = createSpeechify({
      apiKey: 'k',
      fetch: mock.fetch,
      headers: { 'speechify-version': '2026-09-13', 'X-Team': 'audio' },
    });
    await provider.speech('simba-3.2').doGenerate({
      text: 'Hi',
      headers: { 'X-Team': 'web', 'X-Skip': undefined, 'user-agent': 'ai/7.0.0' },
    });
    const headers = mock.calls[0]?.headers as Headers;
    expect(headers.get('speechify-version')).toBe('2026-09-13');
    expect(headers.get('x-team')).toBe('web');
    expect(headers.has('x-skip')).toBe(false);
    expect(headers.get('user-agent')).toBe('ai/7.0.0');
  });
});

describe('api key', () => {
  it('reads SPEECHIFY_API_KEY when the request is made', async () => {
    const mock = mockFetch();
    const provider = createSpeechify({ fetch: mock.fetch });
    vi.stubEnv('SPEECHIFY_API_KEY', 'env-key');
    await provider.speech('simba-3.2').doGenerate({ text: 'Hi' });
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer env-key');
  });

  it('throws LoadAPIKeyError without a key and makes no request', async () => {
    vi.stubEnv('SPEECHIFY_API_KEY', '');
    const mock = mockFetch();
    const provider = createSpeechify({ fetch: mock.fetch });
    await expect(provider.speech('simba-3.2').doGenerate({ text: 'Hi' })).rejects.toSatisfy(
      LoadAPIKeyError.isInstance,
    );
    expect(mock.fetch).not.toHaveBeenCalled();
  });

  it('default instance uses the global fetch at call time', async () => {
    const mock = mockFetch();
    vi.stubGlobal('fetch', mock.fetch);
    vi.stubEnv('SPEECHIFY_API_KEY', 'env-key');
    await speechify.speech('simba-3.2').doGenerate({ text: 'Hi' });
    expect(mock.calls).toHaveLength(1);
  });
});

describe('outputFormat', () => {
  it.each(['mp3', 'wav', 'ogg', 'aac', 'pcm'])('sends %s as audio_format', async (format) => {
    const { call } = await generate({ outputFormat: format });
    expect(call.body.audio_format).toBe(format);
    expect(call.body).not.toHaveProperty('output_format');
  });

  it.each(['pcm_16000', 'mp3_24000_128', 'wav_48000', 'ulaw_8000'])(
    'sends %s as output_format',
    async (format) => {
      const { call, result } = await generate({ outputFormat: format });
      expect(call.body.output_format).toBe(format);
      expect(call.body).not.toHaveProperty('audio_format');
      expect(result.warnings).toEqual([]);
    },
  );

  it.each(['mulaw', 'ulaw', 'MULAW'])('maps %s to ulaw_8000', async (format) => {
    const { call } = await generate({ outputFormat: format });
    expect(call.body.output_format).toBe('ulaw_8000');
  });

  it('warns and falls back to mp3 for an unsupported format', async () => {
    const { call, result } = await generate({ outputFormat: 'flac' });
    expect(call.body.audio_format).toBe('mp3');
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'outputFormat' }),
    ]);
    expect((result.warnings[0] as { details: string }).details).toContain('"flac"');
  });
});

describe('language', () => {
  it('passes the language through', async () => {
    const { call, result } = await generate({ language: 'de' }, 'simba-3.0');
    expect(call.body.language).toBe('de');
    expect(result.warnings).toEqual([]);
  });

  it('omits "auto", which is what the API does when no language is sent', async () => {
    const { call, result } = await generate({ language: 'auto' });
    expect(call.body).not.toHaveProperty('language');
    expect(result.warnings).toEqual([]);
  });
});

describe('speed', () => {
  it('wraps plain text in an escaped SSML prosody rate', async () => {
    const { call, result } = await generate({ text: 'Fish & <chips>', speed: 1.25 });
    expect(call.body.input).toBe(
      '<speak><prosody rate="+25%">Fish &amp; &lt;chips&gt;</prosody></speak>',
    );
    expect(result.warnings).toEqual([]);
  });

  it('slows down with a negative rate', async () => {
    const { call } = await generate({ speed: 0.8 });
    expect(call.body.input).toBe('<speak><prosody rate="-20%">Hello</prosody></speak>');
  });

  it('puts the prosody inside existing SSML', async () => {
    const { call } = await generate({
      text: ' <speak xml:lang="en-US">Hi <break time="1s"/> there</speak> ',
      speed: 1.5,
    });
    expect(call.body.input).toBe(
      '<speak xml:lang="en-US"><prosody rate="+50%">Hi <break time="1s"/> there</prosody></speak>',
    );
  });

  it('leaves the text untouched at speed 1', async () => {
    const { call } = await generate({ speed: 1 });
    expect(call.body.input).toBe('Hello');
  });

  it('clamps to the supported range with a warning', async () => {
    const { call, result } = await generate({ speed: 0.25 });
    expect(call.body.input).toBe('<speak><prosody rate="-50%">Hello</prosody></speak>');
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'speed' }),
    ]);
  });

  it.each([0, -1, Number.NaN])('ignores speed %s with a warning', async (speed) => {
    const { call, result } = await generate({ speed });
    expect(call.body.input).toBe('Hello');
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'speed' }),
    ]);
  });

  it('replaces characters XML cannot carry with spaces', async () => {
    const { call } = await generate({ text: 'a\u0000b', speed: 2 });
    expect(call.body.input).toBe('<speak><prosody rate="+100%">a b</prosody></speak>');
  });
});

describe('instructions', () => {
  it('warns that instructions are unsupported and does not send them', async () => {
    const { call, result } = await generate({ instructions: 'Speak slowly' });
    expect(JSON.stringify(call.body)).not.toContain('Speak slowly');
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'instructions' }),
    ]);
  });
});

describe('providerOptions.speechify', () => {
  it('maps the normalization switches to the API options object', async () => {
    const { call, result } = await generate({
      providerOptions: { speechify: { loudnessNormalization: true, textNormalization: false } },
    });
    expect(call.body.options).toEqual({
      loudness_normalization: true,
      text_normalization: false,
    });
    expect(result.warnings).toEqual([]);
  });

  it('warns about unknown keys instead of dropping them silently', async () => {
    const { call, result } = await generate({ providerOptions: { speechify: { emotion: 'sad' } } });
    expect(call.body).not.toHaveProperty('options');
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'providerOptions.speechify.emotion' }),
    ]);
  });

  it('rejects a mistyped value', async () => {
    await expect(
      generate({ providerOptions: { speechify: { textNormalization: 'yes' } } }),
    ).rejects.toSatisfy(InvalidArgumentError.isInstance);
  });

  it('ignores options addressed to other providers', async () => {
    const { call, result } = await generate({ providerOptions: { openai: { foo: 1 } } });
    expect(call.body).not.toHaveProperty('options');
    expect(result.warnings).toEqual([]);
  });
});

describe('response', () => {
  it('passes base64 audio through and fills metadata and usage', async () => {
    const { result, call } = await generate();
    expect(result.audio).toBe(MP3_BASE64);
    expect(result.usage).toEqual({ billable_characters_count: 5 });
    expect(result.request?.body).toEqual(call.body);
    expect(result.response.modelId).toBe('simba-3.2');
    expect(result.response.timestamp).toBeInstanceOf(Date);
    expect(result.response.headers?.['speechify-request-id']).toBe('req_123');
    expect(result.providerMetadata).toEqual({
      speechify: {
        audioFormat: 'mp3',
        billableCharactersCount: 5,
        speechMarks: SPEECH_MARKS,
        requestId: 'req_123',
      },
    });
  });

  it('reports output_format when the API returns it', async () => {
    const mock = mockFetch([
      {
        body: {
          audio_data: 'AAAA',
          audio_format: 'pcm',
          output_format: 'pcm_16000',
          billable_characters_count: 5,
          speech_marks: SPEECH_MARKS,
        },
      },
    ]);
    const provider = createSpeechify({ apiKey: 'k', fetch: mock.fetch });
    const result = await provider
      .speech('simba-3.2')
      .doGenerate({ text: 'Hello', outputFormat: 'pcm_16000' });
    expect(result.providerMetadata?.speechify?.outputFormat).toBe('pcm_16000');
    expect(result.providerMetadata?.speechify?.audioFormat).toBe('pcm');
  });

  it('rejects a 200 without audio', async () => {
    const mock = mockFetch([{ body: { audio_format: 'mp3' } }]);
    const provider = createSpeechify({ apiKey: 'k', fetch: mock.fetch });
    await expect(provider.speech('simba-3.2').doGenerate({ text: 'Hi' })).rejects.toSatisfy(
      InvalidResponseDataError.isInstance,
    );
  });
});

describe('errors', () => {
  it('turns the error envelope into a non-retryable APICallError', async () => {
    const mock = mockFetch([
      {
        status: 400,
        body: {
          error: { code: 'model_retired', message: 'simba-english is retired' },
          request_id: 'req_abc',
        },
      },
    ]);
    const provider = createSpeechify({ apiKey: 'k', fetch: mock.fetch });
    const error = await rejection(provider.speech('simba-english').doGenerate({ text: 'Hi' }));
    expect(APICallError.isInstance(error)).toBe(true);
    const apiError = error as APICallError;
    expect(apiError.statusCode).toBe(400);
    expect(apiError.isRetryable).toBe(false);
    expect(apiError.message).toBe(
      'Speechify API error 400 model_retired: simba-english is retired (request id req_abc)',
    );
    expect(apiError.data).toEqual({
      error: { code: 'model_retired', message: 'simba-english is retired' },
      request_id: 'req_abc',
    });
    expect(apiError.url).toBe('https://api.speechify.ai/v1/audio/speech');
  });

  it.each([429, 500, 503])('marks %s as retryable', async (status) => {
    const mock = mockFetch([{ status, body: 'upstream unavailable' }]);
    const provider = createSpeechify({ apiKey: 'k', fetch: mock.fetch });
    const error = (await rejection(provider.speech('simba-3.2').doGenerate({ text: 'Hi' }))) as APICallError;
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error.isRetryable).toBe(true);
    expect(error.message).toContain('upstream unavailable');
  });

  it('wraps a network failure as a retryable APICallError', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = createSpeechify({ apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch });
    const error = (await rejection(provider.speech('simba-3.2').doGenerate({ text: 'Hi' }))) as APICallError;
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error.isRetryable).toBe(true);
  });

  it('rethrows an abort unchanged', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return new Response('{}');
    });
    const provider = createSpeechify({ apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch });
    const error = await rejection(provider.speech('simba-3.2').doGenerate({ text: 'Hi', abortSignal: controller.signal }));
    expect(APICallError.isInstance(error)).toBe(false);
    expect((error as Error).name).toBe('AbortError');
  });
});

describe('provider', () => {
  it('implements ProviderV4 for speech only', () => {
    const provider = createSpeechify({ apiKey: 'k' });
    expect(provider.specificationVersion).toBe('v4');
    const m = provider.speechModel('simba-3.2');
    expect(m.specificationVersion).toBe('v4');
    expect(m.provider).toBe('speechify.speech');
    expect(m.modelId).toBe('simba-3.2');
    expect(() => provider.languageModel('simba-3.2')).toThrow(NoSuchModelError);
    expect(() => provider.embeddingModel('x')).toThrow(NoSuchModelError);
    expect(() => provider.imageModel('x')).toThrow(NoSuchModelError);
  });

  it('works inside a provider registry', async () => {
    const mock = mockFetch();
    const registry = createProviderRegistry({
      speechify: createSpeechify({ apiKey: 'k', fetch: mock.fetch }),
    });
    const result = await generateSpeech({
      model: registry.speechModel('speechify:simba-3.2'),
      text: 'Hello',
    });
    expect(result.audio.mediaType).toBe('audio/mpeg');
  });
});

describe('generateSpeech()', () => {
  it('returns audio, warnings and Speechify metadata end to end', async () => {
    const mock = mockFetch();
    const provider = createSpeechify({ apiKey: 'k', fetch: mock.fetch });
    const result = await generateSpeech({
      model: provider.speech('simba-3.2'),
      text: 'Hello',
      voice: 'geffen_32',
      instructions: 'cheerful',
    });
    expect(result.audio.mediaType).toBe('audio/mpeg');
    expect(result.audio.base64).toBe(MP3_BASE64);
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'unsupported', feature: 'instructions' }),
    ]);
    expect(result.providerMetadata.speechify?.speechMarks).toEqual(SPEECH_MARKS);
    expect(mock.calls[0]?.headers.get('user-agent')).toMatch(/^ai\/7\./);
  });

  it('retries a 503 through the AI SDK retry loop', async () => {
    const mock = mockFetch([
      { status: 503, body: { error: { code: 'unavailable', message: 'busy' } }, headers: { 'retry-after-ms': '1' } },
      {},
    ]);
    const provider = createSpeechify({ apiKey: 'k', fetch: mock.fetch });
    const result = await generateSpeech({
      model: provider.speech('simba-3.2'),
      text: 'Hello',
      maxRetries: 1,
    });
    expect(mock.calls).toHaveLength(2);
    expect(result.audio.base64).toBe(MP3_BASE64);
  });

  it('does not retry a 400', async () => {
    const mock = mockFetch([{ status: 400, body: { error: { code: 'invalid_request', message: 'bad voice' } } }]);
    const provider = createSpeechify({ apiKey: 'k', fetch: mock.fetch });
    await expect(
      generateSpeech({ model: provider.speech('simba-3.2'), text: 'Hello', maxRetries: 2 }),
    ).rejects.toThrow(/bad voice/);
    expect(mock.calls).toHaveLength(1);
  });
});
