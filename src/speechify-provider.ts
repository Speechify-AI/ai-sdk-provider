import { NoSuchModelError, type ProviderV4, type SpeechModelV4 } from '@ai-sdk/provider';
import { SpeechifySpeechModel } from './speechify-speech-model';
import type { SpeechifySpeechModelId } from './speechify-speech-options';
import { VERSION } from './version';

/**
 * The dated Speechify API version every request pins via `Speechify-Version`,
 * so behaviour never depends on the workspace's default version.
 */
export const SPEECHIFY_API_VERSION = '2026-09-30';

/** Identifies this integration's traffic to Speechify (`Speechify-Caller`). */
export const SPEECHIFY_CALLER = 'vercel-ai-sdk';

const DEFAULT_BASE_URL = 'https://api.speechify.ai';

export interface SpeechifyProviderSettings {
  /**
   * Speechify API key, sent as a Bearer token. Defaults to the
   * `SPEECHIFY_API_KEY` environment variable, read when a request is made.
   */
  apiKey?: string;

  /** API base URL. Defaults to `https://api.speechify.ai`. */
  baseURL?: string;

  /**
   * Headers added to every request. They override the provider's own
   * headers, so `Speechify-Version` here replaces the pinned version.
   */
  headers?: Record<string, string>;

  /** Custom fetch implementation, for example for proxies or tests. */
  fetch?: typeof globalThis.fetch;
}

export interface SpeechifyProvider extends ProviderV4 {
  /** Creates a speech model for `generateSpeech()`. */
  speech(modelId: SpeechifySpeechModelId): SpeechModelV4;

  /** Creates a speech model for `generateSpeech()`. */
  speechModel(modelId: SpeechifySpeechModelId): SpeechModelV4;
}

/** Creates a Speechify provider instance. */
export function createSpeechify(settings: SpeechifyProviderSettings = {}): SpeechifyProvider {
  const baseURL = (settings.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  const createSpeechModel = (modelId: SpeechifySpeechModelId): SpeechModelV4 =>
    new SpeechifySpeechModel(modelId, {
      provider: 'speechify.speech',
      baseURL,
      apiKey: settings.apiKey,
      defaultHeaders: {
        'Speechify-Caller': SPEECHIFY_CALLER,
        'Speechify-Caller-Version': VERSION,
        'Speechify-Version': SPEECHIFY_API_VERSION,
      },
      headers: settings.headers,
      fetch: settings.fetch,
    });

  const noSuchModel =
    (modelType: 'languageModel' | 'embeddingModel' | 'imageModel') =>
    (modelId: string): never => {
      throw new NoSuchModelError({
        modelId,
        modelType,
        message: `Speechify provides speech models only; use speechify.speech("${modelId}") with generateSpeech().`,
      });
    };

  return {
    specificationVersion: 'v4',
    speech: createSpeechModel,
    speechModel: createSpeechModel,
    languageModel: noSuchModel('languageModel'),
    embeddingModel: noSuchModel('embeddingModel'),
    imageModel: noSuchModel('imageModel'),
  };
}

/** Default provider instance. Reads `SPEECHIFY_API_KEY` from the environment. */
export const speechify = createSpeechify();
