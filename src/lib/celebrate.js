// Confetti wrappers — every effect degrades gracefully if it fails.
import confetti from 'canvas-confetti'

function safe(fn) {
  try { fn() } catch { /* celebration is an enhancement, never break the app */ }
}

export function burstSmall(x = 0.5, y = 0.6) {
  safe(() => confetti({
    particleCount: 45, spread: 55, startVelocity: 28, origin: { x, y },
    colors: ['#a3e635', '#84cc16', '#8b5cf6', '#fbbf24'], disableForReducedMotion: true,
  }))
}

export function burstBig() {
  safe(() => {
    confetti({ particleCount: 90, spread: 75, origin: { x: 0.3, y: 0.55 }, disableForReducedMotion: true,
      colors: ['#a3e635', '#8b5cf6', '#6366f1', '#fbbf24', '#fb7185'] })
    confetti({ particleCount: 90, spread: 75, origin: { x: 0.7, y: 0.55 }, disableForReducedMotion: true,
      colors: ['#a3e635', '#8b5cf6', '#6366f1', '#fbbf24', '#fb7185'] })
  })
}

export function levelUpBurst() {
  safe(() => confetti({
    particleCount: 70, spread: 100, startVelocity: 34, origin: { x: 0.5, y: 0.5 },
    colors: ['#8b5cf6', '#6366f1', '#a78bfa', '#c4b5fd'], shapes: ['star', 'circle'],
    disableForReducedMotion: true,
  }))
}
