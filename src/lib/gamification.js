// XP, levels, ranks, badges.

export const XP = {
  log: 10,
  fullDay: 25,
  levelUp: 50,
  cycleComplete: 100,
  streakDay: 5,
}

// Level curve: level n starts at 50*(n-1)^2 XP → 1, 50, 200, 450, 800...
export function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1
}

export function xpForLevel(level) {
  return 50 * (level - 1) ** 2
}

export function levelProgress(xp) {
  const level = levelFromXp(xp)
  const cur = xpForLevel(level)
  const next = xpForLevel(level + 1)
  return { level, current: xp - cur, needed: next - cur, pct: Math.min(1, (xp - cur) / (next - cur)) }
}

const RANKS = ['Rookie', 'Regular', 'Committed', 'Dialed In', 'Optimizer', 'Biohacker', 'Elite', 'Apex']

export function rankForLevel(level) {
  return RANKS[Math.min(Math.floor((level - 1) / 2), RANKS.length - 1)]
}

export const BADGES = [
  { id: 'first-log', name: 'First Log', desc: 'Logged your very first dose', icon: 'Sparkles' },
  { id: 'full-stack', name: 'Full Stack', desc: 'Logged every due dose in one day', icon: 'Layers' },
  { id: 'streak-7', name: '7-Day Streak', desc: '7 consecutive full days', icon: 'Flame' },
  { id: 'streak-30', name: '30-Day Consistent', desc: '30 consecutive full days', icon: 'CalendarCheck' },
  { id: 'level-up', name: 'Titration Milestone', desc: 'Advanced a titration level', icon: 'TrendingUp' },
  { id: 'ceiling', name: 'Summit', desc: 'Reached a ladder ceiling', icon: 'Mountain' },
  { id: 'cycle-complete', name: 'Cycle Complete', desc: 'Completed a full on-cycle', icon: 'RefreshCw' },
  { id: 'logs-100', name: 'Century', desc: '100 doses logged', icon: 'Trophy' },
]

export function badgeById(id) {
  return BADGES.find((b) => b.id === id)
}
