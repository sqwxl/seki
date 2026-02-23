let audioCtx: AudioContext | undefined;

const buffers: Record<string, AudioBuffer | undefined> = {};

const OFFSET = 1.021;
const DURATION = 0.028;

function ensureContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

async function loadBuffer(
  ctx: AudioContext,
  url: string,
): Promise<AudioBuffer> {
  const cached = buffers[url];
  if (cached) {
    return cached;
  }
  const resp = await fetch(url);
  const data = await resp.arrayBuffer();
  const buf = await ctx.decodeAudioData(data);
  buffers[url] = buf;
  return buf;
}

export function playStoneSound(): void {
  const ctx = ensureContext();
  loadBuffer(ctx, "/static/sounds/clicks.webm").then((buf) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0, OFFSET, DURATION);
  });
}

export function playPassSound(): void {
  const ctx = ensureContext();
  loadBuffer(ctx, "/static/sounds/ding.mp3").then((buf) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  });
}

