import { describe, it, expect, vi } from 'vitest'
import { fitWithin, preparePhoto, makeThumb, PHOTO_MAX, PHOTO_QUALITY, THUMB_MAX } from './photoImage'

const fake = (w, h) => {
  const release = vi.fn()
  const encoded = []
  return {
    release, encoded,
    decode: vi.fn(async () => ({ source: 'img', width: w, height: h, release })),
    encode: vi.fn(async (src, ew, eh, q) => { encoded.push({ w: ew, h: eh, q }); return { size: ew * eh, type: 'image/jpeg' } }),
  }
}

describe('photos are resized before they are stored', () => {
  it('fits the longest side, never enlarges', () => {
    expect(fitWithin(4032, 3024, 2000)).toMatchObject({ w: 2000, h: 1500 })
    expect(fitWithin(3024, 4032, 2000)).toMatchObject({ w: 1500, h: 2000 })
    expect(fitWithin(800, 600, 2000)).toMatchObject({ w: 800, h: 600, scale: 1 })
    expect(fitWithin(0, 600, 2000).w).toBe(0)
  })

  it('a 12 MP camera photo is stored at 2000 px, quality 0.85, with a 480 px thumbnail', async () => {
    const f = fake(3024, 4032)
    const r = await preparePhoto({}, f)
    expect(PHOTO_MAX).toBe(2000)
    expect(PHOTO_QUALITY).toBe(0.85)
    expect(f.encoded[0]).toEqual({ w: 1500, h: 2000, q: 0.85 })
    expect(f.encoded[1]).toMatchObject({ w: 360, h: THUMB_MAX })
    expect(r).toMatchObject({ width: 1500, height: 2000 })
    expect(r.thumb).toBeTruthy()
    // the decoded image is let go, so a big photo is not held in memory
    expect(f.release).toHaveBeenCalledTimes(1)
  })

  it('a photo that cannot be read is an error, never stored at full size', async () => {
    await expect(preparePhoto({}, { decode: async () => { throw new Error("Couldn't read this photo") } })).rejects.toThrow("Couldn't read")
    const f = fake(0, 0)
    await expect(preparePhoto({}, f)).rejects.toThrow()
    expect(f.encode).not.toHaveBeenCalled()
  })

  it('an older photo gets a thumbnail; the original is not re-encoded', async () => {
    const f = fake(1080, 1440)
    const r = await makeThumb({}, f)
    expect(f.encoded).toHaveLength(1)
    expect(f.encoded[0]).toMatchObject({ w: 360, h: 480 })
    expect(r).toMatchObject({ width: 1080, height: 1440 })
  })
})
