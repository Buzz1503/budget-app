// Will-they-mix rules. Conservative by default: separate unless verified.

export const FIXED_SEPARATE = ['Retatrutide', 'GHK-Cu', 'NAD+', 'SS-31', 'Tesamorelin', 'MOTS-c']

export const SEED_KNOWN_GOOD = [pairKey('BPC-157', 'KPV'), pairKey('Selank', 'Semax')]

export function pairKey(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join('|')
}

// verdict: 'green' (known-good co-draw) | 'red' (fixed separate) | 'amber' (separate unless verified)
export function mixVerdict(nameA, nameB, knownGoodKeys = []) {
  const fixedA = FIXED_SEPARATE.includes(nameA)
  const fixedB = FIXED_SEPARATE.includes(nameB)
  if (fixedA || fixedB) {
    const who = [fixedA && nameA, fixedB && nameB].filter(Boolean).join(' and ')
    return {
      verdict: 'red',
      overridable: false,
      title: 'Inject separately',
      reason: `${who} should always be drawn and injected on its own — no co-draw.`,
    }
  }
  const key = pairKey(nameA, nameB)
  if (knownGoodKeys.includes(key)) {
    return {
      verdict: 'green',
      overridable: false,
      title: 'OK to co-draw',
      reason: 'Marked known-good: draw from each reconstituted vial into one syringe right before injecting.',
    }
  }
  return {
    verdict: 'amber',
    overridable: true,
    title: 'Separate unless verified',
    reason: 'No verification for this pair yet — default to separate syringes. Mark known-good only once you have verified it yourself.',
  }
}
