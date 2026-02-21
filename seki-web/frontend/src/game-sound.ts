let audioCtx: AudioContext | undefined;
let buffer: AudioBuffer | undefined;

// First click in clicks.webm: starts at ~1.021s, lasts ~28ms
const OFFSET = 1.021;
const DURATION = 0.028;

function ensureContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

async function loadBuffer(ctx: AudioContext): Promise<AudioBuffer> {
  if (buffer) {
    return buffer;
  }
  const resp = await fetch("/static/sounds/clicks.webm");
  const data = await resp.arrayBuffer();
  buffer = await ctx.decodeAudioData(data);
  return buffer;
}

export function playStoneSound(): void {
  const ctx = ensureContext();
  loadBuffer(ctx).then((buf) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0, OFFSET, DURATION);
  });
}
