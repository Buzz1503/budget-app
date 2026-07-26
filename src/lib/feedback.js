// Optional haptics + sound. Both degrade silently if unavailable or disabled.
let audioCtx = null

export function haptic(pattern = 12) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern)
  } catch { /* unsupported */ }
}

export function blip(kind = 'log') {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    audioCtx = audioCtx || new AC()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const now = audioCtx.currentTime
    const notes = kind === 'levelup' ? [523, 659, 784, 1047] : kind === 'fullday' ? [659, 880] : [660]
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const start = now + i * 0.08
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(start)
      osc.stop(start + 0.24)
    })
  } catch { /* audio blocked */ }
}
