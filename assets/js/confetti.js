// Confetti made of tiny Likewise brackets, for when it's mutual.
import { reduceMotion } from './motion.js';

const COLORS = ['#EC3013', '#201E1D', '#F47A5E', '#FAD4CB', '#A8240F'];

export function burst({ x = innerWidth / 2, y = innerHeight / 2, count = 140, spread = 1 } = {}) {
  if (reduceMotion) return;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, devicePixelRatio || 1);
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3000 });
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const parts = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = (6 + Math.random() * 10) * spread;
    return {
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 7,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      s: 7 + Math.random() * 9,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      kind: Math.random() < 0.55 ? 'L' : 'sq',
      life: 0,
    };
  });

  const t0 = performance.now();
  function frame(t) {
    const elapsed = t - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      const alpha = Math.max(0, 1 - elapsed / 2600);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      if (p.kind === 'L') {
        const w = p.s, t2 = p.s * 0.32;
        ctx.fillRect(-w / 2, -w / 2, t2, w);
        ctx.fillRect(-w / 2, w / 2 - t2, w, t2);
      } else {
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      }
      ctx.restore();
    }
    if (elapsed < 2800) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
