import { colorAt, type SceneBuilder } from './types'

/** A gently rolling wire grid seen at a slant. Segments = density, amplitude and brightness = intensity. */
export const buildWaves: SceneBuilder = ({ THREE, scene, camera, params }) => {
  const seg = params.count
  const geo = new THREE.PlaneGeometry(18, 10, seg, seg)
  geo.rotateX(-Math.PI / 2.6)
  const pos = geo.attributes.position as import('three').BufferAttribute
  const baseY = Float32Array.from(pos.array as Float32Array).filter((_, i) => i % 3 === 1)
  const a = colorAt(params, 0)
  const b = colorAt(params, 1)
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(a[0], a[1], a[2]).lerp(new THREE.Color(b[0], b[1], b[2]), 0.4), wireframe: true, transparent: true, opacity: 0.15 + params.intensity * 0.6, depthWrite: false })
  const mesh = new THREE.Mesh(geo, mat)
  camera.position.set(0, 1.5, 7)
  camera.lookAt(0, 0, 0)
  scene.add(mesh)
  const amp = 0.15 + params.intensity * 0.55
  return {
    update(t) {
      const k = t * params.speed
      for (let i = 0; i < baseY.length; i++) {
        const x = pos.getX(i)
        const z = pos.getZ(i)
        pos.setY(i, (baseY[i] ?? 0) + (Math.sin(x * 0.7 + k) + Math.cos(z * 0.8 + k * 0.8)) * 0.5 * amp)
      }
      pos.needsUpdate = true
    },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose() }
  }
}
