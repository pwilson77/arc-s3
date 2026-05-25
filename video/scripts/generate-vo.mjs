#!/usr/bin/env node
// Generate ElevenLabs voiceover MP3s for each scene.
// Reads ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID from the root .env.
// Writes mp3s to video/public/vo/<id>.mp3 and a manifest.json next to them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const videoRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(videoRoot, "..");
const envPath = path.join(repoRoot, ".env");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnv(envPath);

function getArgValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
if (!API_KEY || !VOICE_ID) {
  console.error("Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID in .env");
  process.exit(1);
}

const scriptFile = getArgValue("--script") || "vo-script.json";
const scriptPath = path.join(__dirname, scriptFile);
if (!fs.existsSync(scriptPath)) {
  console.error(`Voice script not found: ${scriptPath}`);
  process.exit(1);
}
const script = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
const outDir = path.join(videoRoot, "public", "vo");
fs.mkdirSync(outDir, { recursive: true });

const modelId = script.model_id || "eleven_turbo_v2_5";
const voiceSettings = script.voice_settings || {};

async function synth(scene) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: scene.text,
      model_id: modelId,
      voice_settings: voiceSettings,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status} for ${scene.id}: ${body}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const outPath = path.join(outDir, `${scene.id}.mp3`);
  fs.writeFileSync(outPath, buf);
  return { id: scene.id, file: `vo/${scene.id}.mp3`, bytes: buf.length };
}

const onlyArg = getArgValue("--only");
const onlySet = onlyArg
  ? new Set(onlyArg.split(",").map((s) => s.trim()))
  : null;
const manifest = {
  generatedAt: new Date().toISOString(),
  voiceId: VOICE_ID,
  modelId,
  scenes: [],
};
for (const scene of script.scenes) {
  if (onlySet && !onlySet.has(scene.id)) {
    continue;
  }
  process.stdout.write(`→ ${scene.id} ... `);
  const entry = await synth(scene);
  manifest.scenes.push(entry);
  console.log(`${entry.bytes} bytes`);
}
fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`\nWrote ${manifest.scenes.length} clips to ${outDir}`);
