// The README's code samples, compiled by `npm run typecheck` so they cannot
// drift from the published types. Never executed.
import { writeFile } from 'node:fs/promises';
import { generateSpeech } from 'ai';
import {
  createSpeechify,
  speechify,
  type SpeechifySpeechProviderMetadata,
} from '../src/index';

export async function example() {
  const { audio, providerMetadata } = await generateSpeech({
    model: speechify.speech('simba-3.2'),
    text: 'Hello from Speechify and the AI SDK.',
    voice: 'harper_32',
  });

  await writeFile('hello.mp3', audio.uint8Array);
  console.log(providerMetadata.speechify?.speechMarks);
}

export function providerInstance() {
  return createSpeechify({
    apiKey: process.env.SPEECHIFY_API_KEY,
  });
}

export async function options() {
  const { audio } = await generateSpeech({
    model: speechify.speech('simba-3.0'),
    text: 'Guten Tag, das ist ein kurzer Test.',
    voice: 'anton',
    language: 'de',
    outputFormat: 'mp3_24000_128',
    speed: 1.1,
    providerOptions: { speechify: { loudnessNormalization: true } },
  });
  return audio;
}

export async function speechMarks() {
  const result = await generateSpeech({ model: speechify.speech('simba-3.2'), text: 'Hi' });

  const { speechMarks } = result.providerMetadata.speechify as SpeechifySpeechProviderMetadata;
  for (const word of speechMarks?.chunks ?? []) {
    console.log(word.value, word.start_time, word.end_time);
  }
}

export function pinVersion() {
  return createSpeechify({ headers: { 'Speechify-Version': '2026-09-13' } });
}
