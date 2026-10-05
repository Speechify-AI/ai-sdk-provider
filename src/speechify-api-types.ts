import type { SpeechifyAudioFormat, SpeechifyCodecOutputFormat } from './speechify-speech-options';

/** Request body of `POST /v1/audio/speech`. */
export interface SpeechifySpeechRequest {
  input: string;
  voice_id: string;
  model: string;
  audio_format?: SpeechifyAudioFormat;
  output_format?: SpeechifyCodecOutputFormat;
  language?: string;
  options?: {
    loudness_normalization?: boolean;
    text_normalization?: boolean;
  };
}

/** Success body of `POST /v1/audio/speech`. */
export interface SpeechifySpeechResponse {
  audio_data: string;
  audio_format: string;
  billable_characters_count?: number;
  output_format?: string;
  speech_marks?: SpeechifySpeechMarks;
}

/** Error envelope every non-2xx response carries. */
export interface SpeechifyErrorResponse {
  error?: {
    code?: string;
    message?: string;
    fields?: unknown;
  };
  request_id?: string;
}

/** One timed segment of the synthesized speech. */
export type SpeechifySpeechMark = {
  /** Segment kind, for example `word` or `sentence`. */
  type: string;
  /** Start offset in the input text, in characters. */
  start: number;
  /** End offset in the input text, in characters. */
  end: number;
  /** Start time in the audio, in milliseconds. */
  start_time: number;
  /** End time in the audio, in milliseconds. */
  end_time: number;
  /** The text this segment speaks. */
  value: string;
};

/** Speech marks for a clip: the whole text, with one chunk per word. */
export type SpeechifySpeechMarks = SpeechifySpeechMark & {
  chunks: SpeechifySpeechMark[];
};

/** Shape of `providerMetadata.speechify` on a `generateSpeech()` result. */
export type SpeechifySpeechProviderMetadata = {
  /** Codec of the returned audio: mp3, wav, ogg, aac, pcm or ulaw. */
  audioFormat: string;
  /** Full `codec_sampleRate_bitrate` string, when one was requested. */
  outputFormat?: string;
  /** Characters billed for the request. */
  billableCharactersCount: number | null;
  speechMarks: SpeechifySpeechMarks | null;
  /** `Speechify-Request-Id` of the response. */
  requestId?: string;
};
