import { PortraitStage } from '@mayor/portrait';
import { registerMayorModel } from '@mayor/models';
import suitUrl from '@models/mamdani-suit.mrig?url';

// Icon studio (dev only, /icon.html): renders Mamdani's face from the same 3D model the app uses
// and saves the favicon, the dashboard's icons and the phone app's icons.

const SIZE = 1024;

class FaceStage extends PortraitStage {
  shot(x: number, y: number, target: number, z: number, fov: number) {
    this.camera.position.set(x, y, z);
    this.camera.fov = fov;
    this.camera.lookAt(x, target, 0);
    this.camera.updateProjectionMatrix();
  }
}


async function render(): Promise<HTMLCanvasElement> {
  registerMayorModel('suit', await (await fetch(suitUrl)).arrayBuffer());
  const gl = document.createElement('canvas');
  gl.width = gl.height = SIZE;
  const stage = new FaceStage({ canvas: gl, pixelRatio: 1, size: () => ({ w: SIZE, h: SIZE }) });
  stage.resize();
  // hold still for the portrait: no eye darts
  Math.random = () => 0.5;
  stage.shot(-0.04, 0.93, 0.9, 1.5, 24);
  stage.show('suit');
  stage.act('watch');
  // the model's resting head turns up and to his left; look straight down the lens
  stage.aim([0.12, -0.2]);
  stage.expression('CHEERFUL');
  // step the scene by hand (works in a hidden tab), then copy while the drawing buffer is intact
  await stage.advance(2.5);
  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  out.getContext('2d')!.drawImage(gl, 0, 0);
  stage.dispose();
  return out;
}

function background(ctx: CanvasRenderingContext2D, s: number) {
  const g = ctx.createRadialGradient(s * 0.5, s * 1.05, 0, s * 0.5, s * 0.8, s * 0.95);
  g.addColorStop(0, '#ffc08a');
  g.addColorStop(0.35, '#ff7a2a');
  g.addColorStop(0.75, '#ff5a1f');
  g.addColorStop(1, '#e0431a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s / 256;
  for (let r = s * 0.12; r < s * 1.4; r += s * 0.11) {
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 1.02, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** face on the hi-vis sun, at a size, optionally cropped to a circle, with the face scaled */
function compose(face: HTMLCanvasElement, size: number, opts: { circle?: boolean; bg?: boolean; scale?: number; dy?: number } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (opts.circle) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  if (opts.bg !== false) background(ctx, size);
  const k = opts.scale ?? 1;
  const w = size * k;
  ctx.drawImage(face, (size - w) / 2, (size - w) / 2 + size * (opts.dy ?? 0), w, w);
  return c;
}

async function save(name: string, c: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  await fetch(`/__icon?name=${name}`, { method: 'POST', body: blob });
  c.title = name;
  document.getElementById('out')!.appendChild(c);
}

const face = await render();
await save('public/mamdani-face.png', compose(face, 512, { scale: 1.02, dy: 0.04 }));
await save('public/favicon.png', compose(face, 64, { circle: true, scale: 1.12, dy: 0.06 }));
await save('public/apple-touch-icon.png', compose(face, 180, { scale: 1.0, dy: 0.05 }));
await save('public/icon-192.png', compose(face, 192, { scale: 1.0, dy: 0.05 }));
await save('public/icon-512.png', compose(face, 512, { scale: 0.86, dy: 0.06 }));
await save('mobile/icon.png', compose(face, 1024, { scale: 1.0, dy: 0.05 }));
await save('mobile/favicon.png', compose(face, 48, { circle: true, scale: 1.12, dy: 0.06 }));
await save('mobile/android-icon-foreground.png', compose(face, 512, { bg: false, scale: 0.72, dy: 0.04 }));
await save('mobile/android-icon-background.png', (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  background(c.getContext('2d')!, 512);
  return c;
})());
document.title = 'done';
