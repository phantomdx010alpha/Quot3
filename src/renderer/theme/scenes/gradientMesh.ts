import type { SceneBuilder } from './types'

// App-owned shader: soft colour blobs drifting over a full-screen quad. The source is a constant in this file; a theme only supplies colours and numbers.
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform float uTime; uniform float uIntensity; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform float uN;
float blob(vec2 p, vec2 c, float r) { return smoothstep(r, 0.0, distance(p, c)); }
void main() {
  vec2 p = vUv;
  float t = uTime;
  vec3 col = vec3(0.0);
  float w = 0.0;
  float b0 = blob(p, vec2(0.25 + 0.15 * sin(t * 0.7), 0.30 + 0.15 * cos(t * 0.5)), 0.75);
  float b1 = blob(p, vec2(0.75 + 0.15 * cos(t * 0.6), 0.35 + 0.15 * sin(t * 0.8)), 0.75);
  float b2 = blob(p, vec2(0.50 + 0.20 * sin(t * 0.4 + 1.0), 0.80 + 0.10 * cos(t * 0.7)), 0.75);
  float b3 = blob(p, vec2(0.15 + 0.10 * cos(t * 0.9), 0.85 + 0.10 * sin(t * 0.3)), 0.6);
  col += uC0 * b0; w += b0;
  col += uC1 * b1; w += b1;
  if (uN > 2.5) { col += uC2 * b2; w += b2; }
  if (uN > 3.5) { col += uC3 * b3; w += b3; }
  col = col / max(w, 0.0001);
  gl_FragColor = vec4(col, clamp(w, 0.0, 1.0) * uIntensity * 0.85);
}`

/** Slow colour blobs; alpha follows intensity so it can sit under the chrome without hiding it. */
export const buildGradientMesh: SceneBuilder = ({ THREE, scene, params }) => {
  const cs = params.colors
  const v = (i: number): import('three').Vector3 => { const c = cs[Math.min(i, cs.length - 1)] ?? [1, 1, 1]; return new THREE.Vector3(c[0], c[1], c[2]) }
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: false,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: params.intensity }, uC0: { value: v(0) }, uC1: { value: v(1) }, uC2: { value: v(2) }, uC3: { value: v(3) }, uN: { value: Math.max(2, cs.length) } }
  })
  const time = mat.uniforms['uTime'] as { value: number }
  const geo = new THREE.PlaneGeometry(2, 2)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  scene.add(mesh)
  return {
    update(t) { time.value = t * params.speed },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose() }
  }
}
