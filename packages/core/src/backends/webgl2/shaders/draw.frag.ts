export const DRAW_FRAG = `#version 300 es
precision highp float;

in vec3 vColor;
in float vAlpha;
out vec4 fragColor;

void main() {
  if (vAlpha <= 0.0) discard;
  fragColor = vec4(vColor, vAlpha);
}
`
