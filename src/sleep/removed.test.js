// Sleep data comes from Apple Health only: Sleep sounds, the Watch movement
// recording and the Watch Start sleep flow were removed. This scans the
// shipped code (web and native, not tests) so none of them creeps back.
// Stored rows stay (see store.test.js); only the code paths are gone.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new globalThis.URL('../..', import.meta.url))

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'Tests' || name === 'build' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, exts, out)
    else if (exts.some((e) => name.endsWith(e)) && !/\.test\.(js|ts|jsx)$/.test(name)) out.push(p)
  }
  return out
}

const web = walk(join(ROOT, 'src'), ['.js', '.jsx', '.ts'])
const swift = walk(join(ROOT, 'ios'), ['.swift'])
const read = (p) => readFileSync(p, 'utf8')
const hits = (files, re) => files.filter((p) => re.test(read(p))).map((p) => relative(ROOT, p))

describe('no code path references the removed features', () => {
  it('web: no Sleep sounds, movement lane, snoring line or Start sleep code', () => {
    const re = /\b(SoundsScreen|soundsNight|soundsView|soundsStatus|startSounds|stopSounds|addSoundSessions|addSoundsLog|setRestless|restlessMatch|moveLane|motionWords|restlessBands|soundLane|recordSleepMode|onsetMin|soundsMissed|recordingMissing|openSounds)\b|No snoring heard|strip-(move|snore|sound)\b|sounds-row|['"]sleep\/sounds['"]/
    expect(hits(web, re)).toEqual([])
  })

  it('native: no sound analysis, microphone, motion recorder, HomeKit sensor or sleep mode start', () => {
    const re = /\b(SleepSounds\w*|SoundAnalysis|SNClassifySoundRequest|AVAudioEngine|CMSensorRecorder|RestlessRecorder|RestlessStart|Restlessness|HMHomeManager|WatchStartSleepIntent|WatchImUpIntent|StopSleepSoundsLiveIntent|stopSleepSounds)\b/
    expect(hits(swift, re)).toEqual([])
  })

  it('no microphone, motion or HomeKit permission, no audio background mode', () => {
    const plists = walk(join(ROOT, 'ios'), ['Info.plist']).concat(walk(join(ROOT, 'ios'), ['.entitlements']))
    expect(plists.length).toBeGreaterThan(3)
    expect(hits(plists, /NSMicrophoneUsageDescription|NSMotionUsageDescription|NSHomeKitUsageDescription|com\.apple\.developer\.homekit|<string>audio<\/string>/)).toEqual([])
    // the sauna Live Activity is untouched
    expect(read(join(ROOT, 'ios/App/App/Info.plist'))).toMatch(/NSSupportsLiveActivities<\/key>\s*<true\/>/)
  })

  it('the files themselves are gone', () => {
    for (const f of [
      'src/sleep/sounds.ts', 'src/sleep/soundsView.ts', 'src/sleep/restlessMatch.ts', 'src/sleep/sleepMode.ts', 'src/components/health/SoundsScreen.jsx',
      'ios/App/App/Native/SleepSounds.swift', 'ios/App/App/Native/SleepSoundsIntents.swift', 'ios/PepitoKit/Sources/PepitoCore/SleepSoundsCore.swift',
      'ios/PepitoKit/Sources/PepitoCore/SleepSoundsSchedule.swift', 'ios/PepitoKit/Sources/PepitoCore/Restlessness.swift', 'ios/PepitoWatch/RestlessRecorder.swift',
      'ios/WatchShared/RestlessStart.swift', 'ios/PepitoKit/Sources/PepitoWidgetUI/SleepSoundsActivityViews.swift',
    ]) expect(existsSync(join(ROOT, f)), f).toBe(false)
  })
})
