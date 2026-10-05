import {
  APICallError,
  InvalidArgumentError,
  InvalidResponseDataError,
  LoadAPIKeyError,
  type SharedV4Warning,
  type SpeechModelV4,
  type SpeechModelV4CallOptions,
  type SpeechModelV4Result,
} from '@ai-sdk/provider';
import type {
  SpeechifyErrorResponse,
  SpeechifySpeechProviderMetadata,
  SpeechifySpeechRequest,
  SpeechifySpeechResponse,
} from './speechify-api-types';
import {
  DEFAULT_AUDIO_FORMAT,
  DEFAULT_VOICE,
  SPEECHIFY_AUDIO_FORMATS,
  SPEECHIFY_OUTPUT_FORMATS,
  type SpeechifyAudioFormat,
  type SpeechifyCodecOutputFormat,
  type SpeechifySpeechModelId,
} from './speechify-speech-options';
import { MAX_SPEED, MIN_SPEED, withSpeechRate } from './ssml';

export interface SpeechifySpeechModelConfig {
  provider: string;
  baseURL: string;
  apiKey: string | undefined;
  defaultHeaders: Record<string, string>;
  headers: Record<string, string> | undefined;
  fetch: typeof globalThis.fetch | undefined;
}

const PROVIDER_OPTION_KEYS = {
  loudnessNormalization: 'loudness_normalization',
  textNormalization: 'text_normalization',
} as const;

export class SpeechifySpeechModel implements SpeechModelV4 {
  readonly specificationVersion = 'v4';

  constructor(
    readonly modelId: SpeechifySpeechModelId,
    private readonly config: SpeechifySpeechModelConfig,
  ) {}

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate(options: SpeechModelV4CallOptions): Promise<SpeechModelV4Result> {
    const timestamp = new Date();
    const { body, warnings } = this.getArgs(options);
    const url = `${this.config.baseURL}/v1/audio/speech`;
    const headers = this.buildHeaders(options.headers);
    const fetchFn = this.config.fetch ?? globalThis.fetch;

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.abortSignal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new APICallError({
        message: `Cannot connect to the Speechify API: ${errorMessage(error)}`,
        url,
        requestBodyValues: body,
        cause: error,
        isRetryable: true,
      });
    }

    const responseHeaders = Object.fromEntries(response.headers.entries());
    const responseBody = await response.text();

    if (!response.ok) {
      throw apiCallError({ url, body, response, responseHeaders, responseBody });
    }

    let data: SpeechifySpeechResponse;
    try {
      data = JSON.parse(responseBody) as SpeechifySpeechResponse;
    } catch (error) {
      throw new InvalidResponseDataError({
        data: responseBody.slice(0, 500),
        message: `The Speechify API returned a body that is not JSON: ${errorMessage(error)}`,
      });
    }
    if (typeof data?.audio_data !== 'string' || data.audio_data.length === 0) {
      throw new InvalidResponseDataError({
        data: { ...data, audio_data: undefined },
        message: 'The Speechify API response has no audio_data.',
      });
    }

    const metadata: SpeechifySpeechProviderMetadata = {
      audioFormat: data.audio_format,
      billableCharactersCount: data.billable_characters_count ?? null,
      speechMarks: data.speech_marks ?? null,
    };
    if (data.output_format != null) metadata.outputFormat = data.output_format;
    const requestId = response.headers.get('speechify-request-id');
    if (requestId != null) metadata.requestId = requestId;

    return {
      audio: data.audio_data,
      warnings,
      ...(data.billable_characters_count != null && {
        usage: { billable_characters_count: data.billable_characters_count },
      }),
      request: { body },
      response: {
        timestamp,
        modelId: this.modelId,
        headers: responseHeaders,
      },
      providerMetadata: { speechify: metadata },
    };
  }

  private getArgs({
    text,
    voice,
    outputFormat,
    instructions,
    speed,
    language,
    providerOptions,
  }: SpeechModelV4CallOptions): { body: SpeechifySpeechRequest; warnings: SharedV4Warning[] } {
    const warnings: SharedV4Warning[] = [];

    let input = text;
    if (speed != null) {
      if (!Number.isFinite(speed) || speed <= 0) {
        warnings.push({
          type: 'unsupported',
          feature: 'speed',
          details: `speed must be a positive number; ${speed} was ignored.`,
        });
      } else {
        const bounded = Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED);
        if (bounded !== speed) {
          warnings.push({
            type: 'unsupported',
            feature: 'speed',
            details: `Speechify supports speed from ${MIN_SPEED} to ${MAX_SPEED}; ${speed} was clamped to ${bounded}.`,
          });
        }
        input = withSpeechRate(text, bounded);
      }
    }

    const body: SpeechifySpeechRequest = {
      input,
      voice_id: voice ?? DEFAULT_VOICE,
      model: this.modelId,
      ...resolveOutputFormat(outputFormat, warnings),
    };

    if (language != null && language !== '' && language.toLowerCase() !== 'auto') {
      body.language = language;
    }

    if (instructions != null && instructions !== '') {
      warnings.push({
        type: 'unsupported',
        feature: 'instructions',
        details:
          'Speechify has no free-text instructions field. Shape delivery with SSML in the text instead (breaks and prosody rate).',
      });
    }

    const apiOptions = parseProviderOptions(providerOptions?.speechify, warnings);
    if (apiOptions != null) body.options = apiOptions;

    return { body, warnings };
  }

  private buildHeaders(callHeaders: Record<string, string | undefined> | undefined): Headers {
    const headers = new Headers({
      Authorization: `Bearer ${loadApiKey(this.config.apiKey)}`,
      'Content-Type': 'application/json',
      ...this.config.defaultHeaders,
    });
    // Headers.set is case-insensitive, so an override replaces the default instead of joining it.
    for (const source of [this.config.headers, callHeaders]) {
      for (const [name, value] of Object.entries(source ?? {})) {
        if (value != null) headers.set(name, value);
      }
    }
    return headers;
  }
}

function resolveOutputFormat(
  requested: string | undefined,
  warnings: SharedV4Warning[],
): { audio_format: SpeechifyAudioFormat } | { output_format: SpeechifyCodecOutputFormat } {
  if (requested == null || requested.trim() === '') return { audio_format: DEFAULT_AUDIO_FORMAT };

  const format = requested.trim().toLowerCase();
  if (format === 'mulaw' || format === 'ulaw') return { output_format: 'ulaw_8000' };
  if ((SPEECHIFY_AUDIO_FORMATS as readonly string[]).includes(format)) {
    return { audio_format: format as SpeechifyAudioFormat };
  }
  if ((SPEECHIFY_OUTPUT_FORMATS as readonly string[]).includes(format)) {
    return { output_format: format as SpeechifyCodecOutputFormat };
  }

  warnings.push({
    type: 'unsupported',
    feature: 'outputFormat',
    details: `Speechify does not support "${requested}"; returned ${DEFAULT_AUDIO_FORMAT} instead. Supported: ${[
      ...SPEECHIFY_AUDIO_FORMATS,
      ...SPEECHIFY_OUTPUT_FORMATS,
    ].join(', ')}.`,
  });
  return { audio_format: DEFAULT_AUDIO_FORMAT };
}

function parseProviderOptions(
  raw: unknown,
  warnings: SharedV4Warning[],
): SpeechifySpeechRequest['options'] | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidArgumentError({
      argument: 'providerOptions.speechify',
      message: 'providerOptions.speechify must be an object.',
    });
  }

  const options: NonNullable<SpeechifySpeechRequest['options']> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (!Object.hasOwn(PROVIDER_OPTION_KEYS, key)) {
      warnings.push({
        type: 'unsupported',
        feature: `providerOptions.speechify.${key}`,
        details: `Unknown option, not sent. Supported: ${Object.keys(PROVIDER_OPTION_KEYS).join(', ')}.`,
      });
      continue;
    }
    if (typeof value !== 'boolean') {
      throw new InvalidArgumentError({
        argument: `providerOptions.speechify.${key}`,
        message: `providerOptions.speechify.${key} must be a boolean.`,
      });
    }
    options[PROVIDER_OPTION_KEYS[key as keyof typeof PROVIDER_OPTION_KEYS]] = value;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function loadApiKey(apiKey: string | undefined): string {
  if (apiKey != null && apiKey !== '') return apiKey;
  const fromEnv = typeof process !== 'undefined' ? process.env?.SPEECHIFY_API_KEY : undefined;
  if (fromEnv != null && fromEnv !== '') return fromEnv;
  throw new LoadAPIKeyError({
    message:
      'Speechify API key is missing. Pass it as the apiKey setting of createSpeechify() or set the SPEECHIFY_API_KEY environment variable.',
  });
}

function apiCallError({
  url,
  body,
  response,
  responseHeaders,
  responseBody,
}: {
  url: string;
  body: SpeechifySpeechRequest;
  response: Response;
  responseHeaders: Record<string, string>;
  responseBody: string;
}): APICallError {
  let data: SpeechifyErrorResponse | undefined;
  try {
    data = JSON.parse(responseBody) as SpeechifyErrorResponse;
  } catch {
    data = undefined;
  }
  const code = data?.error?.code;
  const detail = data?.error?.message ?? (responseBody.slice(0, 200) || response.statusText);
  const requestId = data?.request_id ?? response.headers.get('speechify-request-id');
  return new APICallError({
    message:
      `Speechify API error ${response.status}${code ? ` ${code}` : ''}: ${detail}` +
      (requestId ? ` (request id ${requestId})` : ''),
    url,
    requestBodyValues: body,
    statusCode: response.status,
    responseHeaders,
    responseBody,
    data,
  });
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
