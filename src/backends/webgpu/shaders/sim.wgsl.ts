export const SIM_WGSL = `
struct Params {
  dt: f32, k: f32, c: f32, colorRate: f32,
  opacityRate: f32, jitter: f32, seed: f32, count: f32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> stateIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> stateOut: array<f32>;
@group(0) @binding(3) var<storage, read> targets: array<f32>;

fn hash(n: f32) -> f32 { return fract(sin(n) * 43758.5453123); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u32(P.count)) { return; }
  let s = i * 8u;
  let t = i * 6u;

  let x = stateIn[s + 0u]; let y = stateIn[s + 1u];
  let vx = stateIn[s + 2u]; let vy = stateIn[s + 3u];
  let r = stateIn[s + 4u]; let g = stateIn[s + 5u]; let b = stateIn[s + 6u];
  let alpha = stateIn[s + 7u];

  let hx = targets[t + 0u]; let hy = targets[t + 1u];
  let hr = targets[t + 2u]; let hg = targets[t + 3u]; let hb = targets[t + 4u];
  let ta = targets[t + 5u];

  let ax = P.k * (hx - x) - P.c * vx;
  let ay = P.k * (hy - y) - P.c * vy;
  let nvx = vx + ax * P.dt;
  let nvy = vy + ay * P.dt;
  var nx = x + nvx * P.dt;
  let ny = y + nvy * P.dt;
  nx = nx + (hash(f32(i) + P.seed) - 0.5) * P.jitter;

  let kc = 1.0 - exp(-P.colorRate * P.dt);
  let nr = r + (hr - r) * kc;
  let ng = g + (hg - g) * kc;
  let nb = b + (hb - b) * kc;

  let d = P.opacityRate * P.dt;
  var na = alpha;
  if (ta > 0.5) { na = min(1.0, alpha + d); } else { na = max(0.0, alpha - d); }

  stateOut[s + 0u] = nx; stateOut[s + 1u] = ny;
  stateOut[s + 2u] = nvx; stateOut[s + 3u] = nvy;
  stateOut[s + 4u] = nr; stateOut[s + 5u] = ng; stateOut[s + 6u] = nb;
  stateOut[s + 7u] = na;
}
`
