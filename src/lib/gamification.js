// XP, levels, ranks, badges.

export const XP = {
  log: 10,
  fullDay: 25,
  levelUp: 50,
  cycleComplete: 100,
  streakDay: 5,
  mixDiscovery: 8,
  symptomCheckin: 12,
  clearDay: 20,
  measurement: 15,
  photo: 15,
  supplement: 5,
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
  { id: 'chemist', name: 'Chemist', desc: 'Mapped 10 compatibility pairs', icon: 'FlaskConical' },
  { id: 'first-checkin', name: 'Self Aware', desc: 'Logged your first symptom check-in', icon: 'HeartPulse' },
  { id: 'clear-week', name: 'Clean Run', desc: '7 clear days in a row', icon: 'Sun' },
  { id: 'perfect-rotation', name: 'Perfect Rotation', desc: '7 injections, no site repeated', icon: 'Repeat' },
  { id: 'rotation-health', name: 'Rotation Master', desc: 'Rotation health 90+ over a full month', icon: 'ShieldCheck' },
  { id: 'first-supplement', name: 'Shelf Stocked', desc: 'Logged your first supplement', icon: 'Pill' },
  { id: 'first-measurement', name: 'Baseline', desc: 'Logged your first measurement', icon: 'Ruler' },
  { id: 'first-photo', name: 'Say Cheese', desc: 'Captured your first progress photo', icon: 'Camera' },
  { id: 'first-scan', name: 'Scan Imported', desc: 'Imported a DEXA/InBody scan', icon: 'ScanLine' },
  { id: 'photo-streak', name: '4-Week Lens', desc: 'Photos across 4 different weeks', icon: 'Images' },
  { id: 'body-milestone', name: 'Recomp', desc: 'A body-comp metric trended down', icon: 'TrendingDown' },
]

export function badgeById(id) {
  return BADGES.find((b) => b.id === id)
}

// Given XP before/after a gain, describe a level crossing (for the full-screen moment).
export function rankUpInfo(oldXp, newXp) {
  const from = levelFromXp(oldXp)
  const to = levelFromXp(newXp)
  if (to <= from) return null
  return { fromLevel: from, toLevel: to, fromRank: rankForLevel(from), toRank: rankForLevel(to), rankChanged: rankForLevel(to) !== rankForLevel(from) }
}
