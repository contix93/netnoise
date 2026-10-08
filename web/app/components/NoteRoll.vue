<script setup lang="ts">
import type { Lane } from '~/utils/compose';
import type { PlayedNote } from '~/utils/strudel';

/**
 * Le note suonate, una corsia per strumento (riconosciuto dal `.color()` del pattern).
 * Il tempo scorre da destra a sinistra; la linea verticale è "adesso".
 * Pieno = verso in, contorno = verso out (dal panorama). Altezza nella corsia = nota, spessore = volume.
 */
const props = defineProps<{ lanes: Lane[] }>();

const PAST_MS = 6000;
const FUTURE_MS = 1200;
const LABEL_W = 132;

const canvas = ref<HTMLCanvasElement>();
let notes: PlayedNote[] = [];
let raf = 0;

function add(n: PlayedNote): void {
  notes.push(n);
}

defineExpose({ add });

function laneIndex(color: string): number {
  const i = props.lanes.findIndex(l => l.color === color);
  return i >= 0 ? i : props.lanes.findIndex(l => l.key === 'other');
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function draw(): void {
  raf = requestAnimationFrame(draw);
  const el = canvas.value;
  const ctx = el?.getContext('2d');
  if (!el || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const now = performance.now();
  notes = notes.filter(n => n.at + n.dur > now - PAST_MS);

  const plotW = Math.max(10, w - LABEL_W);
  const x = (t: number) => LABEL_W + ((t - (now - PAST_MS)) / (PAST_MS + FUTURE_MS)) * plotW;
  const laneH = h / Math.max(1, props.lanes.length);
  const muted = cssVar('--muted');
  const border = cssVar('--row-border');

  // corsie ed etichette; l'etichetta si accende se la corsia ha appena suonato
  const lastHit = new Map<number, number>();
  for (const n of notes) {
    if (n.at <= now) lastHit.set(laneIndex(n.color), Math.max(lastHit.get(laneIndex(n.color)) ?? 0, n.at));
  }
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  props.lanes.forEach((lane, i) => {
    const y = i * laneH;
    ctx.fillStyle = border;
    ctx.fillRect(LABEL_W, y + laneH - 1, plotW, 1);
    const glow = Math.max(0, 1 - (now - (lastHit.get(i) ?? 0)) / 400);
    ctx.globalAlpha = 0.45 + 0.55 * glow;
    ctx.fillStyle = lane.color;
    ctx.beginPath();
    ctx.arc(10, y + laneH / 2, 4 + glow * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = glow > 0 ? lane.color : muted;
    ctx.fillText(lane.label, 22, y + laneH / 2);
    ctx.globalAlpha = 1;
  });

  // note, solo nell'area a destra delle etichette
  ctx.save();
  ctx.beginPath();
  ctx.rect(LABEL_W, 0, plotW, h);
  ctx.clip();
  for (const n of notes) {
    const lane = laneIndex(n.color);
    if (lane < 0) continue;
    const top = lane * laneH;
    // C1..C8 dal basso verso l'alto della corsia; i campioni senza altezza al centro
    const pos = n.midi === null ? 0.5 : Math.min(1, Math.max(0, (n.midi - 24) / 84));
    const thick = Math.max(2, Math.min(laneH * 0.45, 2 + n.gain * laneH * 0.35));
    const cy = top + laneH - 2 - pos * (laneH - 4);
    const x0 = x(n.at);
    const x1 = Math.max(x0 + 3, x(n.at + Math.min(n.dur, 2000)));
    const playing = n.at <= now && now < n.at + n.dur;
    const color = n.color || muted;

    ctx.globalAlpha = n.at > now ? 0.35 : playing ? 1 : 0.7;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x0, cy - thick / 2, x1 - x0, thick, Math.min(3, thick / 2));
    if (n.pan > 0.5) {
      ctx.globalAlpha *= 0.35;
      ctx.fill();
      ctx.globalAlpha = n.at > now ? 0.35 : 1;
      ctx.stroke();
    } else {
      ctx.fill();
    }
    if (playing) {
      ctx.globalAlpha = 0.25 * (1 - (now - n.at) / Math.max(n.dur, 1));
      ctx.beginPath();
      ctx.arc(x0, cy, thick + 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // adesso
  const xn = x(now);
  ctx.fillStyle = cssVar('--accent');
  ctx.fillRect(xn, 0, 1.5, h);
}

onMounted(() => {
  raf = requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
});
</script>

<template>
  <canvas ref="canvas" class="roll" />
</template>

<style scoped>
.roll { display: block; width: 100%; height: 100%; }
</style>
