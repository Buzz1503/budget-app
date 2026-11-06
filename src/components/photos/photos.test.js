import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

vi.mock('../../lib/blobStore', () => ({
  cachedBlobUrl: (k) => (k ? `blob:${k}` : null),
  blobUrl: async (k) => (k ? `blob:${k}` : null),
  getBlob: async () => null, putBlob: async () => true, deleteBlob: async () => {}, revokeBlobUrl: () => {},
}))

const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }

const photos = [
  { id: 'p1', pose: 'front', date: '2026-01-05', blobKey: 'k1', thumbKey: 'k1-thumb' },
  { id: 'p2', pose: 'front', date: '2026-03-05', blobKey: 'k2', align: { scale: 1.25, x: -0.08, y: 0.04, rotation: 3 } },
]

let PhotosSection, Thumb, PHOTO_TIP, CAMERA_OFF, PhotoCompare, camera
beforeAll(async () => {
  await import('../../store/useStore')
  ;({ default: PhotosSection, Thumb, PHOTO_TIP, CAMERA_OFF } = await import('../PhotosSection'))
  PhotoCompare = (await import('./PhotoCompare')).default
  camera = await import('../../native/camera')
})


describe('the body outline is gone', () => {
  it('capture, preview and timeline have no ghost outline or its text, and show one tip', () => {
    const html = renderToStaticMarkup(createElement(PhotosSection))
    expect(html).not.toMatch(/ghost|Match the|same distance &amp; light|Stand in frame/i)
    expect(html).not.toMatch(/stroke-dasharray="2 2"/)
    expect(html).toContain(PHOTO_TIP)
    expect(PHOTO_TIP).toBe('Same spot, same distance, same light.')
    // every thumbnail has Adjust, and shows the photo with its settings
    const thumb = renderToStaticMarkup(createElement(Thumb, { photo: photos[1], onDelete() {}, onEdit() {}, onAdjust() {} }))
    expect(thumb).toContain('data-testid="photo-adjust-p2"')
    expect(thumb).toContain('scale(1.25)')
    expect(thumb).not.toMatch(/ghost|stroke-dasharray/i)
  })

  it('no source file still draws it', () => {
    for (const f of ['../PhotosSection.jsx', './PhotoEditor.jsx', './PhotoCompare.jsx', './LiveCamera.jsx', './AlignedPhoto.jsx']) {
      const src = readFileSync(new globalThis.URL(f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/PoseGuide|Match the ghost|ghost pose/i)
    }
  })
})

describe('compare uses the adjusted photos, in one frame size', () => {
  it('before and after are both drawn with their own settings over the same frame', () => {
    const html = renderToStaticMarkup(createElement(PhotoCompare, { photos }))
    const before = html.match(/<img[^>]*data-testid="compare-before"[^>]*>/)[0]
    const after = html.match(/<img[^>]*data-testid="compare-after"[^>]*>/)[0]
    expect(before).toContain('transform:translate(0%, 0%) rotate(0deg) scale(1)')
    expect(after).toContain('transform:translate(-8%, 4%) rotate(3deg) scale(1.25)')
    // both fill the same 3:4 frame, the before side clipped by the slider
    expect(html.match(/aspect-ratio:3\/4/g)).toHaveLength(1)
    expect(html).toMatch(/clip-path:inset\(0 50% 0 0\)/)
    expect(html).toContain('5 Jan 2026')
    expect(html).toContain('5 Mar 2026')
  })
})

describe('camera access turned off', () => {
  it('Take photo shows the message instead of opening the camera', () => {
    expect(camera.captureRoute({ camera: 'denied', guideOn: false, hasPrev: true, liveFailed: false })).toBe('blocked')
    expect(camera.captureRoute({ camera: 'restricted', guideOn: true, hasPrev: true, liveFailed: false })).toBe('blocked')
    expect(camera.captureRoute({ camera: 'granted', guideOn: true, hasPrev: true, liveFailed: false })).toBe('live')
    expect(camera.captureRoute({ camera: 'prompt', guideOn: true, hasPrev: false, liveFailed: false })).toBe('camera')
    expect(camera.captureRoute({ camera: 'unknown', guideOn: true, hasPrev: true, liveFailed: true })).toBe('camera')
    expect(CAMERA_OFF).toMatch(/Turn it on in Settings/)
  })

  it('on the web nothing native is called', async () => {
    expect(await camera.cameraStatus()).toBe('unknown')
    expect(await camera.openAppSettings()).toBe(false)
    expect(await camera.detectPose({})).toBeNull()
  })

  it('the app asks iOS with plain wording for the camera and the library', () => {
    const plist = readFileSync(new globalThis.URL('../../../ios/App/App/Info.plist', import.meta.url), 'utf8')
    expect(plist).toContain('<key>NSCameraUsageDescription</key>\n\t<string>Pepito uses the camera to take progress photos. Photos stay on this device.</string>')
    expect(plist).toContain('NSPhotoLibraryUsageDescription')
    expect(plist).toContain('NSPhotoLibraryAddUsageDescription')
  })
})
