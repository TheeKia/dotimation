export const SIM_VERT = `#version 300 es
precision highp float;

in vec2 aPos;
in vec2 aVel;
in vec3 aColor;
in float aAlpha;
in vec2 aHomePos;
in vec3 aHomeColor;
in float aTargetAlpha;

uniform float uDt;
uniform float uK;
uniform float uC;
uniform float uColorRate;
uniform float uOpacityRate;
uniform float uJitter; // amount (px) this step, or 0
uniform uint uSeed;    // fresh 32-bit seed per step

out vec2 vPos;
out vec2 vVel;
out vec3 vColor;
out float vAlpha;

// PCG output hash on u32 — uniform in [0, 1) (2^32 > max state, 1.0 is
// unreachable, matching the CPU PRNG's toUnit contract), unlike
// fract(sin(x)*K) which bands at large x on some GPUs.
float hash01(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return float((word >> 22u) ^ word) / 4294967296.0;
}

void main() {
  // semi-implicit Euler spring
  vec2 a = uK * (aHomePos - aPos) - uC * aVel;
  vec2 vel = aVel + a * uDt;
  vec2 pos = aPos + vel * uDt;

  // X-only jitter (matches the Canvas2D backend), gated by the caller via uJitter
  float j = (hash01(uint(gl_VertexID) ^ uSeed) - 0.5) * uJitter;
  pos.x += j;

  // exponential color ease
  float kc = 1.0 - exp(-uColorRate * uDt);
  vec3 color = aColor + (aHomeColor - aColor) * kc;

  // alpha toward target
  float d = uOpacityRate * uDt;
  float alpha = aTargetAlpha > 0.5 ? min(1.0, aAlpha + d) : max(0.0, aAlpha - d);

  vPos = pos;
  vVel = vel;
  vColor = color;
  vAlpha = alpha;
}
`
