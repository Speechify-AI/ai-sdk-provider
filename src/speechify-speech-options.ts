/**
 * Speech models served by `POST /v1/audio/speech`.
 *
 * - `simba-3.2`: lowest latency and richest expressivity, English only.
 * - `simba-3.0`: English plus de-DE, es-ES, es-MX, fr-FR, it-IT and pt-BR.
 */
export type SpeechifySpeechModelId = 'simba-3.2' | 'simba-3.0' | (string & {});

/** Values of the API's `audio_format` field. */
export const SPEECHIFY_AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'aac', 'pcm'] as const;

/** Values of the API's `output_format` field (`codec_sampleRate_bitrate`). */
export const SPEECHIFY_OUTPUT_FORMATS = [
  'pcm_8000',
  'pcm_16000',
  'pcm_22050',
  'pcm_24000',
  'pcm_44100',
  'pcm_48000',
  'mp3_22050_32',
  'mp3_22050_64',
  'mp3_22050_96',
  'mp3_22050_128',
  'mp3_22050_160',
  'mp3_22050_192',
  'mp3_24000_32',
  'mp3_24000_64',
  'mp3_24000_96',
  'mp3_24000_128',
  'mp3_24000_160',
  'mp3_24000_192',
  'wav_24000',
  'wav_48000',
  'ulaw_8000',
  'ogg_24000',
  'aac_24000',
] as const;

export type SpeechifyAudioFormat = (typeof SPEECHIFY_AUDIO_FORMATS)[number];
export type SpeechifyCodecOutputFormat = (typeof SPEECHIFY_OUTPUT_FORMATS)[number];

/** Every value the `outputFormat` option of `generateSpeech()` accepts. */
export type SpeechifyOutputFormat =
  | SpeechifyAudioFormat
  | SpeechifyCodecOutputFormat
  | 'mulaw'
  | 'ulaw';

/** Options read from `providerOptions.speechify`. */
export interface SpeechifySpeechModelOptions {
  /** Normalize loudness to -14 LUFS. Adds latency. API default: false. */
  loudnessNormalization?: boolean;
  /** Read numbers, dates and the like as words ("55" as "fifty five"). API default: true. */
  textNormalization?: boolean;
}

export const DEFAULT_VOICE = 'harper_32';
export const DEFAULT_AUDIO_FORMAT: SpeechifyAudioFormat = 'mp3';
