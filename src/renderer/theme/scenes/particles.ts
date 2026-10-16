import { colorAt, rng, type SceneBuilder } from './types'

/** Slowly drifting points in a box, additive, coloured from the theme's colours. Opacity = intensity. */
export const buildParticles: SceneBuilder = ({ THREE, scene, camera, params }) => {
  const n = params.count
  const rand = rng(1234)
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const seed = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rand() - 0.5) * 16
    pos[i * 3 + 1] = (rand() - 0.5) * 9
    pos[i * 3 + 2] = (rand() - 0.5) * 6
    col.set(colorAt(params, i), i * 3)
    seed[i] = rand() * Math.PI * 2
  }
  const base = Float32Array.from(pos)
  const geo = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(pos, 3)
  geo.setAttribute('position', posAttr)
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, transparent: true, opacity: 0.25 + params.intensity * 0.65, depthWrite: false, blending: THREE.AdditiveBlending })
  const points = new THREE.Points(geo, mat)
  camera.position.set(0, 0, 8)
  scene.add(points)
  return {
    update(t) {
      const k = t * params.speed
      for (let i = 0; i < n; i++) {
        const s = seed[i] ?? 0
        pos[i * 3] = (base[i * 3] ?? 0) + Math.sin(k * 0.6 + s) * 0.35
        pos[i * 3 + 1] = (base[i * 3 + 1] ?? 0) + Math.cos(k * 0.5 + s * 1.3) * 0.35
      }
      posAttr.needsUpdate = true
      points.rotation.y = k * 0.03
    },
    dispose() { scene.remove(points); geo.dispose(); mat.dispose() }
  }
}
