// What Home shows, top to bottom (stage 2D): the readiness card (iPhone app
// only), today's log, and a sauna row at the end of the log unless switched
// off in Sauna settings. Nothing else.
export function homeSections({ health = false, saunaOnHome = true } = {}) {
  return [...(health ? ['readiness'] : []), 'log', ...(saunaOnHome ? ['sauna'] : [])]
}
