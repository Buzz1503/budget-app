// Standard published questionnaires. Not from the master plan (the plan names
// them; the brief asks for the standard questions and scoring).
//   VISA-P: Visentini et al. 1998, 8 items, 0–100, higher = better.
//   PRWE:   MacDermid 1996, 15 items, 0–100, lower = better.

import type { QuestionnaireType } from '../data/records'

export interface ScaleQuestion {
  id: string
  kind: 'scale'
  text: string
  /** Labels for 0 and 10. */
  low: string
  high: string
  /** VISA-P Q1 is answered in minutes (0–100) and scored /10. */
  minutes?: boolean
}

export interface ChoiceQuestion {
  id: string
  kind: 'choice'
  text: string
  options: { label: string; points: number }[]
}

export type Question = ScaleQuestion | ChoiceQuestion

export interface Questionnaire {
  type: QuestionnaireType
  title: string
  intro: string
  higherIsBetter: boolean
  questions: Question[]
}

const minutesOptions = (pts: number[]) =>
  ['Nil', '1–5 min', '6–10 min', '11–15 min', 'More than 15 min'].map((label, i) => ({ label, points: pts[i] ?? 0 }))

export const VISA_P: Questionnaire = {
  type: 'VISA-P',
  title: 'VISA-P (knee)',
  intro: 'Patellar tendon score. Answer for how your knee has been this week. Higher is better.',
  higherIsBetter: true,
  questions: [
    { id: 'q1', kind: 'scale', minutes: true, text: 'For how many minutes can you sit pain free?', low: '0 min', high: '100 min' },
    { id: 'q2', kind: 'scale', text: 'Do you have pain walking downstairs with a normal gait cycle?', low: 'Strong, severe pain', high: 'No pain' },
    { id: 'q3', kind: 'scale', text: 'Do you have pain at the knee with full active non-weight-bearing knee extension?', low: 'Strong, severe pain', high: 'No pain' },
    { id: 'q4', kind: 'scale', text: 'Do you have pain when doing a full weight-bearing lunge?', low: 'Strong, severe pain', high: 'No pain' },
    { id: 'q5', kind: 'scale', text: 'Do you have problems squatting?', low: 'Unable', high: 'No problems' },
    { id: 'q6', kind: 'scale', text: 'Do you have pain during or immediately after doing 10 single-leg hops?', low: 'Strong, severe pain or unable', high: 'No pain' },
    {
      id: 'q7',
      kind: 'choice',
      text: 'Are you currently undertaking sport or other physical activity?',
      options: [
        { label: 'Not at all', points: 0 },
        { label: 'Modified training ± modified competition', points: 4 },
        { label: 'Full training ± competition, but not at the same level as when symptoms began', points: 7 },
        { label: 'Competing at the same or higher level as when symptoms began', points: 10 },
      ],
    },
    {
      id: 'q8a',
      kind: 'choice',
      text: 'Q8A. If you have NO pain while undertaking sport: how long can you train or practise?',
      options: minutesOptions([0, 7, 14, 21, 30]),
    },
    {
      id: 'q8b',
      kind: 'choice',
      text: 'Q8B. If you have SOME pain while undertaking sport, but it does not stop you completing training: how long can you train or practise?',
      options: minutesOptions([0, 4, 10, 14, 20]),
    },
    {
      id: 'q8c',
      kind: 'choice',
      text: 'Q8C. If you have pain that STOPS you completing training: how long can you train or practise?',
      options: minutesOptions([0, 2, 5, 7, 10]),
    },
  ],
}

const pain = (id: string, text: string): ScaleQuestion => ({ id, kind: 'scale', text, low: 'No pain', high: 'Worst ever' })
const fn = (id: string, text: string): ScaleQuestion => ({ id, kind: 'scale', text, low: 'No difficulty', high: 'Unable to do' })

export const PRWE: Questionnaire = {
  type: 'PRWE',
  title: 'PRWE (wrist)',
  intro: 'Patient-Rated Wrist Evaluation. Rate your average over the past week. Lower is better.',
  higherIsBetter: false,
  questions: [
    pain('p1', 'Pain at rest'),
    pain('p2', 'Pain when doing a task with a repeated wrist movement'),
    pain('p3', 'Pain when lifting a heavy object'),
    pain('p4', 'Pain when it is at its worst'),
    { id: 'p5', kind: 'scale', text: 'How often do you have pain?', low: 'Never', high: 'Always' },
    fn('f1', 'Turn a door knob using your affected hand'),
    fn('f2', 'Cut meat using a knife in your affected hand'),
    fn('f3', 'Fasten buttons on your shirt'),
    fn('f4', 'Use your affected hand to push up from a chair'),
    fn('f5', 'Carry a 10 lb (4.5 kg) object in your affected hand'),
    fn('f6', 'Use bathroom tissue with your affected hand'),
    fn('u1', 'Personal care activities (dressing, washing)'),
    fn('u2', 'Household work (cleaning, maintenance)'),
    fn('u3', 'Work (your job or usual everyday work)'),
    fn('u4', 'Recreational activities'),
  ],
}

export const QUESTIONNAIRES: Record<QuestionnaireType, Questionnaire> = { 'VISA-P': VISA_P, PRWE }

/** VISA-P: Q1 minutes / 10, Q2–Q7 as scored, only one of Q8A/B/C counts. Max 100. */
export function scoreVisaP(answers: Record<string, number>): number {
  const q1 = Math.min(100, Math.max(0, answers.q1 ?? 0)) / 10
  const mid = ['q2', 'q3', 'q4', 'q5', 'q6', 'q7'].reduce((s, k) => s + (answers[k] ?? 0), 0)
  const q8 = answers.q8a ?? answers.q8b ?? answers.q8c ?? 0
  return Math.round(q1 + mid + q8)
}

/** PRWE: pain sum (0–50) + function sum / 2 (0–50). Max 100. */
export function scorePrwe(answers: Record<string, number>): number {
  const painSum = ['p1', 'p2', 'p3', 'p4', 'p5'].reduce((s, k) => s + (answers[k] ?? 0), 0)
  const fnSum = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'u1', 'u2', 'u3', 'u4'].reduce((s, k) => s + (answers[k] ?? 0), 0)
  return painSum + fnSum / 2
}

export function scoreQuestionnaire(type: QuestionnaireType, answers: Record<string, number>): number {
  return type === 'VISA-P' ? scoreVisaP(answers) : scorePrwe(answers)
}

/** Due every 7 days. */
export function questionnaireDue(lastDate: string | null, today: string, daysBetween: (a: string, b: string) => number): boolean {
  return lastDate === null || daysBetween(lastDate, today) >= 7
}
