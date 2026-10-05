// Loads the built ESM and CJS entry points and checks each one sends the
// right request, so a packaging mistake fails before publish, not after.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);

const builds = {
  esm: await import('../dist/index.js'),
  cjs: require('../dist/index.cjs'),
};

for (const [name, mod] of Object.entries(builds)) {
  let captured;
  const fetch = async (url, init) => {
    captured = { url, headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return Response.json({ audio_data: 'AAAA', audio_format: 'mp3', billable_characters_count: 2, speech_marks: null });
  };
  const provider = mod.createSpeechify({ apiKey: 'k', fetch });
  const result = await provider.speech('simba-3.2').doGenerate({ text: 'Hi' });

  assert.equal(mod.VERSION, version, `${name}: VERSION`);
  assert.equal(captured.url, 'https://api.speechify.ai/v1/audio/speech', `${name}: url`);
  assert.equal(captured.headers.get('speechify-caller'), 'vercel-ai-sdk', `${name}: caller`);
  assert.equal(captured.headers.get('speechify-caller-version'), version, `${name}: caller version`);
  assert.equal(captured.headers.get('speechify-version'), mod.SPEECHIFY_API_VERSION, `${name}: api version`);
  assert.equal(result.audio, 'AAAA', `${name}: audio`);
  assert.equal(typeof mod.speechify.speech, 'function', `${name}: default instance`);
  console.log(`${name}: ok (${version}, Speechify-Version ${mod.SPEECHIFY_API_VERSION})`);
}
