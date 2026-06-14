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
uniform float uSeed;

out vec2 vPos;
out vec2 vVel;
out vec3 vColor;
out float vAlpha;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  // semi-implicit Euler spring
  vec2 a = uK * (aHomePos - aPos) - uC * aVel;
  vec2 vel = aVel + a * uDt;
  vec2 pos = aPos + vel * uDt;

  // X-only jitter (matches the Canvas2D backend), gated by the caller via uJitter
  float j = (hash(float(gl_VertexID) + uSeed) - 0.5) * uJitter;
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
