// Second-order dynamics: a spring that follows a target with a chosen character.
// (t3ssel8r, "Giving Personality to Procedural Animations".)
//   f — natural frequency in Hz: how fast it catches up
//   z — damping: <1 overshoots and settles (lively), 1 is critically damped, >1 is sluggish
//   r — initial response: 0 eases in, 1 reacts at once, >1 overshoots the start, <0 winds up first
// Tweens still say WHERE a joint goes; these springs decide HOW it gets there. Running every joint
// through one gives overshoot, follow-through (the forearm settles after the arm) and no dead stops.

export class SecondOrder {
  private k1: number;
  private k2: number;
  private k3: number;
  private xp = 0;
  private y = 0;
  private yd = 0;
  private started = false;

  constructor(f: number, z: number, r: number) {
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / (2 * Math.PI * f) ** 2;
    this.k3 = (r * z) / (2 * Math.PI * f);
  }

  reset(x: number) {
    this.xp = this.y = x;
    this.yd = 0;
    this.started = true;
  }

  update(dt: number, x: number): number {
    if (!this.started) this.reset(x);
    if (dt <= 0) return this.y;
    const xd = (x - this.xp) / dt;
    this.xp = x;
    // clamp k2 so a long frame can't make the integration blow up
    const k2 = Math.max(this.k2, (dt * dt) / 2 + (dt * this.k1) / 2, dt * this.k1);
    this.y += dt * this.yd;
    this.yd += (dt * (x + this.k3 * xd - this.y - this.k1 * this.yd)) / k2;
    return this.y;
  }

  get value() {
    return this.y;
  }
}

/** Spring presets per joint. Arms trail the body and forearms trail the arms: overlapping action. */
export const JOINT_FEEL = {
  body: [3.4, 0.7, 0],
  head: [3.0, 0.5, 0.15],
  arm: [3.2, 0.55, 0],
  forearm: [2.6, 0.45, 0],
  leg: [7, 1, 0],
} as const satisfies Record<string, readonly [number, number, number]>;

/** A spring per axis for an Euler-like triple. */
export class Spring3 {
  readonly x: SecondOrder;
  readonly y: SecondOrder;
  readonly z: SecondOrder;
  constructor([f, z, r]: readonly [number, number, number]) {
    this.x = new SecondOrder(f, z, r);
    this.y = new SecondOrder(f, z, r);
    this.z = new SecondOrder(f, z, r);
  }
  reset(v: { x: number; y: number; z: number }) {
    this.x.reset(v.x);
    this.y.reset(v.y);
    this.z.reset(v.z);
  }
  follow(dt: number, v: { x: number; y: number; z: number }, out: { x: number; y: number; z: number }) {
    out.x = this.x.update(dt, v.x);
    out.y = this.y.update(dt, v.y);
    out.z = this.z.update(dt, v.z);
  }
}
