// VO2 max reference values by sex and age decade.
//
// Source: Kaminsky LA, Arena R, Myers J. Reference Standards for
// Cardiorespiratory Fitness Measured With Cardiopulmonary Exercise Testing:
// Data From the Fitness Registry and the Importance of Exercise National
// Database (FRIEND). Mayo Clin Proc. 2015;90(11):1515–1523.
// doi:10.1016/j.mayocp.2015.07.026 — treadmill tests, mL/kg/min.
//
// The 50th-percentile end points (men 48.0 → 24.4, women 37.6 → 18.3 from the
// 20s to the 70s) match the paper's abstract. The other cells were taken from a
// published reproduction of the paper's percentile table and should be checked
// against Table 3 of the paper itself before they are relied on.
//
// Apple's VO2 max is an estimate from outdoor walks and runs, not a lab test,
// so anything derived from these tables is labelled an estimate.

export const PERCENTILES = [10, 25, 50, 75, 90] as const

export type Sex = 'male' | 'female'

export const DECADES = [
  { from: 20, to: 29, mid: 25 },
  { from: 30, to: 39, mid: 35 },
  { from: 40, to: 49, mid: 45 },
  { from: 50, to: 59, mid: 55 },
  { from: 60, to: 69, mid: 65 },
  { from: 70, to: 79, mid: 75 },
] as const

// rows follow DECADES; columns follow PERCENTILES
export const VO2_NORMS: Record<Sex, number[][]> = {
  male: [
    [32.1, 40.1, 48.0, 55.2, 61.8],
    [30.2, 35.9, 42.4, 49.2, 56.5],
    [26.8, 31.9, 37.8, 45.0, 52.1],
    [22.8, 27.1, 32.6, 39.7, 45.6],
    [19.8, 23.7, 28.2, 34.5, 40.3],
    [17.1, 20.4, 24.4, 30.4, 36.6],
  ],
  female: [
    [23.9, 30.5, 37.6, 44.7, 51.3],
    [20.9, 25.3, 30.2, 36.1, 41.4],
    [18.8, 22.1, 26.7, 32.4, 38.4],
    [17.3, 19.9, 23.4, 27.6, 32.0],
    [14.6, 17.2, 20.0, 23.8, 27.0],
    [13.6, 15.6, 18.3, 20.8, 23.1],
  ],
}
