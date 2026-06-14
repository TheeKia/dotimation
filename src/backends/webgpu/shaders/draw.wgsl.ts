export const DRAW_WGSL = `
struct RParams { devW: f32, devH: f32, dpr: f32, dotSize: f32 };
@group(0) @binding(0) var<uniform> R: RParams;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) alpha: f32,
};

@vertex
fn vs(
  @location(0) corner: vec2<f32>,
  @location(1) instPos: vec2<f32>,
  @location(2) instColor: vec3<f32>,
  @location(3) instAlpha: f32,
) -> VOut {
  let dev = instPos * R.dpr + (corner - vec2<f32>(0.5, 0.5)) * R.dotSize + vec2<f32>(R.dotSize * 0.5, R.dotSize * 0.5);
  let clip = vec2<f32>(dev.x / R.devW * 2.0 - 1.0, 1.0 - dev.y / R.devH * 2.0);
  var o: VOut;
  o.pos = vec4<f32>(clip, 0.0, 1.0);
  o.color = instColor / 255.0;
  o.alpha = instAlpha;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  if (in.alpha <= 0.0) { discard; }
  return vec4<f32>(in.color, in.alpha);
}
`
