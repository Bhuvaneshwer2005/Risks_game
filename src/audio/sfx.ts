// Small synthesized sound effects (Web Audio), so the game ships no audio
// files. Everything is a no-op while muted or before the first user gesture.

import { getPrefs } from "../state/prefs.ts";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (getPrefs().muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, type: OscillatorType, gain: number, slideTo?: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(start: number, duration: number, gain: number, filterFreq: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * duration), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  click() {
    tone(880, 0, 0.05, "triangle", 0.04);
  },
  place() {
    tone(520, 0, 0.08, "triangle", 0.06, 780);
  },
  dice() {
    for (let i = 0; i < 5; i++) noise(i * 0.045, 0.05, 0.35, 1800 + i * 300);
    tone(180, 0.22, 0.08, "square", 0.03);
  },
  capture() {
    tone(392, 0, 0.12, "sawtooth", 0.05);
    tone(523, 0.1, 0.12, "sawtooth", 0.05);
    tone(784, 0.2, 0.28, "triangle", 0.07);
  },
  turn() {
    tone(659, 0, 0.18, "sine", 0.08);
    tone(988, 0.14, 0.32, "sine", 0.07);
  },
  trade() {
    tone(740, 0, 0.1, "triangle", 0.06);
    tone(1108, 0.08, 0.2, "triangle", 0.06);
  },
  error() {
    tone(180, 0, 0.16, "square", 0.04, 120);
  },
  victory() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.14, 0.5, "triangle", 0.07));
  },
  tick() {
    tone(1400, 0, 0.03, "square", 0.02);
  },
};
