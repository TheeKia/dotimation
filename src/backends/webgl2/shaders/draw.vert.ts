export const DRAW_VERT = `#version 300 es
precision highp float;

in vec2 aCorner;       // unit quad corner in [0,1]
in vec2 aInstancePos;  // particle pos (CSS px), instanced
in vec3 aInstanceColor;
in float aInstanceAlpha;

uniform float uDevW;
uniform float uDevH;
uniform float uDpr;
uniform float uDotSize; // dot footprint in CSS px (converted to device px here)

out vec3 vColor;
out float vAlpha;

void main() {
  // CSS-px dot size -> device-px footprint, rounded like the Canvas2D tier
  // (max(1, round(dotSize * dpr))) so all tiers render identical dots.
  float sizeDev = max(1.0, floor(uDotSize * uDpr + 0.5));
  // device-px position of this corner of the dot
  vec2 dev = floor(aInstancePos * uDpr + 0.5) + aCorner * sizeDev;
  // device px -> clip space (Y flipped)
  vec2 clip = vec2(dev.x / uDevW * 2.0 - 1.0, 1.0 - dev.y / uDevH * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = aInstanceColor / 255.0;
  vAlpha = aInstanceAlpha;
}
`
