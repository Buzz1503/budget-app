// Seed data parsed from rehab-strength-master-plan.md (Version 2, 25 Sep 2026).
// Every value comes from that file. `null` = the plan gives no value; the app
// asks for it rather than guessing. All of this is editable in the app.

import type {
  Exercise,
  KneeRepBlock,
  KneeStage,
  Milestone,
  SessionEntry,
  SessionItem,
  SessionTemplate,
  SwapRule,
  WeekPlanDay,
  WristStage,
} from './types'

export const PLAN_META = {
  version: 2,
  date: '2026-09-25',
  gym: 'Anytime Fitness',
  equipment: 'Machines and cables only (no free weights). Rehab bands and grip putty are the only extras.',
  priorities: [
    'Knee and wrist rehab in every session',
    'Glute and hamstring strength (long-standing weak point)',
    'Build everything else: chest, back, arms, abs',
  ],
  disclaimer: 'Not medical advice. Check stage changes with your physio.',
  sessionLengthMin: { min: 60, max: 70 },
} as const

// ---------------------------------------------------------------- Section 1

export const INJURIES = [
  {
    id: 'knee',
    name: 'Knee: patellar tendinopathy',
    points: [
      'Overloaded tendon below the kneecap. Treated with progressive loading, not rest.',
      'Status: isometric phase done, starting Stage 2 (heavy slow resistance).',
      'Related: left-side overpronation (orthotics), McConnell taping for patellar tracking.',
    ],
  },
  {
    id: 'wrist',
    name: 'Right wrist: TFCC injury',
    points: [
      'TFCC = the cartilage and ligament cushion on the pinky side of the wrist. It stabilises the joint between the two forearm bones (the DRUJ).',
      'Recurring since teens, current episode about 6 months. Sharp pinky-side pain on twisting and gripping, aching and swelling after use. Six-week splint trial done.',
      'Rehab target: strengthen pronator quadratus (PQ, turns the palm down) and extensor carpi ulnaris (ECU, pinky-side wrist extensor).',
    ],
  },
  {
    id: 'shoulder',
    name: 'Left shoulder: subacromial bursitis + AC joint degeneration + posterior cuff weakness',
    points: [
      'Subacromial bursitis = irritated fluid sac under the top of the shoulder, pinched when the arm goes overhead or out to the side.',
      'AC joint = where collarbone meets shoulder blade. Flares with arms crossing the body and deep pressing.',
      'Rule: no shoulder training. Optional low-load cuff care only, physio-approved.',
    ],
  },
  {
    id: 'gluteHam',
    name: 'Glutes and hamstrings: long-standing weakness',
    points: ['Not an injury, a priority. Two glute or hamstring machines in every session, placed early while fresh.'],
  },
  {
    id: 'back',
    name: 'Lower back: previous history',
    points: ['No loaded spinal bending, no heavy weight pressing down through the spine.'],
  },
] as const

// ---------------------------------------------------------------- Section 2

export const RULES = {
  painLimit: { knee: 3, wrist: 3, shoulder: 2 },
  rirTarget: { min: 2, max: 3 },
  twentyFourHourRule: 'Next-morning pain or swelling no worse than baseline.',
  kneeTempo: '3-0-3',
  tempoExplained: '3 sec lowering, no pause, 3 sec lifting. Knee strength exercises only.',
  wrist: [
    'Neutral grip (palms facing each other) where possible.',
    'Lifting straps for heavy pulls.',
    'No weight on a bent-back wrist (no push-ups, no hand planks).',
    'No loaded twisting.',
  ],
  banned: {
    shoulder: ['Overhead press', 'Lateral raise', 'Upright row', 'Chest fly or pec deck', 'Dips', 'Behind-neck pulldown', 'Push-ups'],
    kneeStage2: ['Lunges', 'Jumping', 'Deep squats', 'Hack squat', 'Hills'],
    back: ['Deadlifts', 'Barbell squats', 'Loaded sit-ups'],
  },
  gymDaysPerWeek: 3,
  gymDaysBackToBack: false,
  homeDayMinutes: { min: 10, max: 15 },
} as const

// ---------------------------------------------------------------- Section 3

export const KNEE_STAGE2_BLOCKS: KneeRepBlock[] = [
  { weeks: { min: 1, max: 2 }, sets: 3, reps: 15 },
  { weeks: { min: 3, max: 4 }, sets: 3, reps: 12 },
  { weeks: { min: 5, max: 6 }, sets: 4, reps: 10 },
  { weeks: { min: 7, max: 9 }, sets: 4, reps: 8 },
  { weeks: { min: 10, max: 12 }, sets: 4, reps: 6 },
]

export const KNEE_STAGES: KneeStage[] = [
  {
    id: 'K1',
    number: 1,
    name: 'Isometric',
    summary: 'Wall sit or Spanish squat 5 x 45 sec.',
    status: 'complete',
    unlockRule: [],
    notes: [],
  },
  {
    id: 'K2',
    number: 2,
    name: 'Heavy slow resistance',
    summary: 'Weeks 1 to 12, reps fall as load rises.',
    status: 'current',
    unlockRule: [],
    notes: [
      'Load = heaviest weight that hits target reps at 2 RIR with pain 3/10 or less.',
      'Based on the Kongsgaard heavy slow resistance protocol (3 sessions a week) and the Malliaras loading progression.',
    ],
  },
  {
    id: 'K3',
    number: 3,
    name: 'Spring loading',
    summary: 'Skipping, pogo hops, low box jumps.',
    status: 'locked',
    unlockRule: [
      '8+ weeks of Stage 2 done',
      'Single-leg decline squat pain 2/10 or less',
      'Leg press 4 x 6 with no morning flare for 2 weeks',
    ],
    notes: ['Hack squat returns here at 40 kg.'],
  },
  {
    id: 'K4',
    number: 4,
    name: 'Return to running',
    summary: 'Flat first, hills later, downhills last.',
    status: 'locked',
    unlockRule: [],
    notes: ['Cadence 169 to 175 steps per minute when running returns (lowers knee tendon load).'],
  },
]

// ---------------------------------------------------------------- Section 6

const kg = (amount: number) => ({ amount, unit: 'kg' as const })

export const EXERCISES: Exercise[] = [
  // Warm-up (Sections 4 and 5; not in the Section 6 library)
  {
    id: 'bike',
    name: 'Bike',
    machine: 'Exercise bike',
    musclesText: 'warm-up',
    muscles: ['cardio'],
    category: 'warmup',
    startWeightKg: null,
    startWeightNote: null,
    increment: null,
    preInjuryBest: null,
    steps: ['5 min easy.'],
    flags: [],
    painJoints: [],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'none',
    lockedUntil: null,
  },

  // Knee strength
  {
    id: 'leg-extension',
    name: 'Leg extension',
    machine: 'Leg extension machine',
    musclesText: 'quads, knee tendon',
    muscles: ['quads', 'kneeTendon'],
    category: 'knee',
    startWeightKg: 30,
    startWeightNote: null,
    increment: kg(2.5),
    preInjuryBest: { weightKg: 57.5, reps: 12 },
    steps: ['Pad on lower shin.', 'Knee lined up with machine pivot.', 'Lift to near straight over 3 sec.', 'Lower over 3 sec.'],
    flags: ['knee rehab primary'],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'kneeHsr',
    lockedUntil: null,
  },
  {
    id: 'leg-press',
    name: 'Leg press',
    machine: 'Plate-loaded leg press',
    musclesText: 'quads, glutes',
    muscles: ['quads', 'glutes'],
    category: 'knee',
    startWeightKg: 60,
    startWeightNote: null,
    increment: kg(5),
    preInjuryBest: { weightKg: 100, reps: 13 },
    steps: ['Feet mid-platform, shoulder width.', 'Lower until knees at 90 degrees.', 'Press without locking knees.'],
    flags: ['knee rehab primary'],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: true,
    progression: 'kneeHsr',
    lockedUntil: null,
  },
  {
    id: 'spanish-squat',
    name: 'Spanish squat / wall sit',
    machine: 'Wall or strap',
    musclesText: 'quads, tendon',
    muscles: ['quads', 'kneeTendon'],
    category: 'knee',
    startWeightKg: 0,
    startWeightNote: 'Bodyweight',
    increment: { amount: 10, unit: 'sec' },
    preInjuryBest: null,
    steps: ['Back on wall.', 'Knees at 60 to 90 degrees.'],
    flags: ['knee isometric'],
    painJoints: ['knee'],
    unilateral: false,
    timed: true,
    plateLoaded: false,
    progression: 'hold',
    lockedUntil: null,
  },

  // Glutes and hamstrings
  {
    id: 'hip-thrust',
    name: 'Machine hip thrust',
    machine: 'Glute thrust machine',
    musclesText: 'glutes',
    muscles: ['glutes'],
    category: 'gluteHam',
    startWeightKg: 50,
    startWeightNote: null,
    increment: kg(5),
    preInjuryBest: { weightKg: 70, reps: 10 },
    steps: ['Upper back on pad.', 'Belt across hips.', 'Feet flat.', 'Drive hips up.', 'Chin tucked, ribs down.'],
    flags: ['low knee load'],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'lying-hamstring-curl',
    name: 'Lying hamstring curl',
    machine: 'Lying leg curl machine',
    musclesText: 'hamstrings',
    muscles: ['hamstrings'],
    category: 'gluteHam',
    startWeightKg: 30,
    startWeightNote: null,
    increment: kg(2.5),
    // Library says 47.5 kg x 16; Milestone 2 says "pre-injury 47.5 kg x 12".
    preInjuryBest: { weightKg: 47.5, reps: 16 },
    steps: ['Knees just off pad edge.', 'Pad above heels.', 'Curl up.', 'Lower over 3 sec.', 'Hips stay down.'],
    flags: ['low knee load'],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'cable-glute-kickback',
    name: 'Cable glute kickback',
    machine: 'Cable station, ankle strap',
    musclesText: 'glutes',
    muscles: ['glutes'],
    category: 'gluteHam',
    startWeightKg: 5,
    startWeightNote: null,
    increment: kg(2.5),
    preInjuryBest: null,
    steps: ['Hold frame lightly.', 'Slight forward lean.', 'Kick straight back.', 'Squeeze.', 'No back arching.'],
    flags: ['no grip load'],
    painJoints: ['knee'],
    unilateral: true,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'hip-abduction',
    name: 'Machine hip abduction',
    machine: 'Hip abductor machine',
    musclesText: 'side glutes (glute medius)',
    muscles: ['gluteMedius'],
    category: 'gluteHam',
    startWeightKg: 40,
    startWeightNote: null,
    increment: kg(2.5),
    preInjuryBest: { weightKg: 63.75, reps: 12 },
    steps: ['Sit tall.', 'Push knees out.', '2 sec hold.'],
    flags: ['hip and knee stability'],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'hip-adduction',
    name: 'Machine hip adduction',
    machine: 'Hip adductor machine',
    musclesText: 'inner thigh',
    muscles: ['adductors'],
    category: 'gluteHam',
    startWeightKg: 25,
    startWeightNote: null,
    increment: kg(2.5),
    preInjuryBest: { weightKg: 37.5, reps: 12 },
    steps: ['Controlled squeeze in.', 'Slow return.'],
    flags: ['low knee load'],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },

  // Calves
  {
    id: 'leg-press-calf-raise',
    name: 'Leg press calf raise',
    machine: 'Leg press',
    musclesText: 'calves',
    muscles: ['calves'],
    category: 'calves',
    startWeightKg: 100,
    startWeightNote: null,
    increment: kg(5),
    preInjuryBest: { weightKg: 150, reps: 15 },
    steps: ['Balls of feet on platform edge.', 'Knees straight.', '2 sec pause at top.'],
    flags: ['low knee load'],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: true,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'calf-raise-machine',
    name: 'Calf raise machine',
    machine: 'Calf raise machine',
    musclesText: 'calves',
    muscles: ['calves'],
    category: 'calves',
    startWeightKg: null,
    startWeightNote: 'Set on day 1',
    increment: kg(5),
    preInjuryBest: null,
    steps: ['Straight knee.', 'Full stretch at bottom.'],
    flags: [],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },

  // Upper body
  {
    id: 'chest-press',
    name: 'Hammer-grip chest press',
    machine: 'Plate-loaded chest press',
    musclesText: 'chest, triceps',
    muscles: ['chest', 'triceps'],
    category: 'upper',
    startWeightKg: null,
    startWeightNote: 'Set on day 1 at 3 RIR',
    increment: kg(2.5),
    preInjuryBest: null,
    steps: ['Handles at mid-chest.', 'Neutral grip.', 'Stop when elbows reach torso line.'],
    flags: ['AC joint safe range'],
    painJoints: ['shoulder', 'wrist'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'chest-supported-row',
    name: 'Chest-supported row',
    machine: 'Row machine',
    musclesText: 'upper back, lats',
    muscles: ['upperBack', 'lats'],
    category: 'upper',
    startWeightKg: null,
    startWeightNote: 'Set on day 1',
    increment: kg(2.5),
    preInjuryBest: null,
    steps: ['Chest on pad.', 'Neutral handles.', 'Pull elbows back.', 'Straps if wrist sore.'],
    flags: ['wrist: straps'],
    painJoints: ['shoulder', 'wrist'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'lat-pulldown',
    name: 'Neutral-grip lat pulldown',
    machine: 'Lat pulldown',
    musclesText: 'lats',
    muscles: ['lats'],
    category: 'upper',
    startWeightKg: null,
    startWeightNote: 'Set on day 1',
    increment: kg(2.5),
    preInjuryBest: null,
    steps: ['Close neutral handle.', 'Pull to upper chest.', "Don't let arms stretch fully overhead if shoulder sore."],
    flags: ['shoulder gate'],
    painJoints: ['shoulder', 'wrist'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'cable-hammer-curl',
    name: 'Cable rope hammer curl',
    machine: 'Cable, rope',
    musclesText: 'biceps',
    muscles: ['biceps'],
    category: 'upper',
    startWeightKg: null,
    startWeightNote: 'Set on day 1',
    increment: kg(2.5),
    preInjuryBest: null,
    steps: ['Elbows pinned at sides.', 'Wrists straight.', 'Thumbs up.'],
    flags: ['wrist gate'],
    painJoints: ['wrist'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'cable-tricep-pushdown',
    name: 'Cable rope tricep pushdown',
    machine: 'Cable, rope',
    musclesText: 'triceps',
    muscles: ['triceps'],
    category: 'upper',
    startWeightKg: null,
    startWeightNote: 'Set on day 1',
    increment: kg(2.5),
    preInjuryBest: null,
    steps: ['Elbows pinned.', 'Push down.', 'Wrists straight.'],
    flags: ['wrist gate'],
    painJoints: ['wrist'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },

  // Core
  {
    id: 'dead-bug',
    name: 'Dead bug',
    machine: 'Floor mat',
    musclesText: 'deep core',
    muscles: ['deepCore'],
    category: 'core',
    startWeightKg: 0,
    startWeightNote: 'Bodyweight',
    increment: { amount: 2, unit: 'reps' },
    preInjuryBest: null,
    steps: ['Lower back pressed flat.'],
    flags: [],
    painJoints: [],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'reps',
    lockedUntil: null,
  },
  {
    id: 'reverse-crunch',
    name: 'Reverse crunch',
    machine: 'Flat bench',
    musclesText: 'lower abs',
    muscles: ['abs'],
    category: 'core',
    startWeightKg: 0,
    startWeightNote: 'Bodyweight',
    increment: { amount: 2, unit: 'reps' },
    preInjuryBest: null,
    steps: ['Curl pelvis up.', 'No swinging.'],
    flags: [],
    painJoints: [],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'reps',
    lockedUntil: null,
  },
  {
    id: 'cable-crunch',
    name: 'Cable crunch',
    machine: 'Cable, rope, kneeling',
    musclesText: 'abs',
    muscles: ['abs'],
    category: 'core',
    startWeightKg: null,
    startWeightNote: 'Set on day 1',
    increment: kg(2.5),
    preInjuryBest: null,
    steps: ['Rope held lightly beside head.', 'Crunch from ribs.'],
    flags: ['light grip only'],
    painJoints: ['wrist'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: null,
  },
  {
    id: 'forearm-side-plank',
    name: 'Forearm side plank',
    machine: 'Floor mat',
    musclesText: 'obliques',
    muscles: ['obliques'],
    category: 'core',
    startWeightKg: 0,
    startWeightNote: 'Bodyweight',
    increment: { amount: 5, unit: 'sec' },
    preInjuryBest: null,
    steps: ['On forearm, never hand.'],
    flags: [],
    painJoints: [],
    unilateral: true,
    timed: true,
    plateLoaded: false,
    progression: 'hold',
    lockedUntil: null,
  },

  // Locked (unlock at knee Stage 3)
  {
    id: 'hack-squat',
    name: 'Hack squat',
    machine: 'Hack squat',
    musclesText: 'quads',
    muscles: ['quads'],
    category: 'knee',
    startWeightKg: 40,
    startWeightNote: null,
    increment: null,
    preInjuryBest: { weightKg: 80, reps: 11 },
    steps: [],
    flags: ['banned in knee Stage 2'],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'double',
    lockedUntil: { knee: 'K3' },
  },

  // Wrist block W1 (Section 8)
  wristDrill('w1-palm-down-iso', 'Palm-down isometric (PQ)', 'Door handle or other hand', 'pronator quadratus', [
    'Forearm thumb-up.',
    'Try to turn palm down against a door handle or your other hand.',
    'No movement, 30% effort.',
  ], true),
  wristDrill('w1-palm-up-iso', 'Palm-up isometric', 'Door handle or other hand', 'forearm (supinators)', [
    'Same setup as palm-down: forearm thumb-up.',
    'Turn palm up against resistance.',
    'No movement, 30% effort.',
  ], true),
  wristDrill('w1-pinky-side-iso', 'Pinky-side isometric (ECU)', 'Table', 'extensor carpi ulnaris', [
    'Forearm on table, palm down.',
    'Lift the pinky side of the hand up and out against your other hand.',
    'Gentle.',
  ], true),
  wristDrill('w1-grip-putty', 'Grip putty squeeze (softest)', 'Grip putty', 'forearm, grip', ['Softest putty.', 'Squeeze and hold.'], true),
  wristDrill('w1-dart-throw', 'Dart-throw motion', 'None', 'wrist', [
    'Wrist moves from back-and-thumb-side to front-and-pinky-side, like throwing a dart.',
    'No load.',
  ], false),

  // Wrist block W2
  wristDrill('w2-band-turns', 'Band palm-down/palm-up turns', 'Light resistance band', 'pronator quadratus, supinators', [
    'Elbow at 90 degrees.',
    'Light band.',
    'Turn palm down, then palm up, through pain-free range.',
  ], false),
  wristDrill('w2-band-ecu-lift', 'Band ECU lift', 'Resistance band', 'extensor carpi ulnaris', [
    'Palm down.',
    'Wrist slightly back.',
    'Lift toward pinky side.',
  ], false),
  wristDrill('w2-band-ext-flex', 'Band wrist extension and flexion', 'Resistance band', 'forearm', ['Forearm supported.', 'Extend and flex the wrist through pain-free range.'], false),
  wristDrill('w2-grip-putty', 'Grip putty (next resistance)', 'Grip putty', 'forearm, grip', ['Next resistance putty.', 'Squeeze and hold.'], true),
  wristDrill('w2-dart-throw-band', 'Dart-throw motion with light band', 'Light resistance band', 'wrist', ['Dart-throw motion against a light band.'], false),

  // Wrist block W3
  wristDrill('w3-wall-pushup-hold', 'Wall push-up hold', 'Wall', 'wrist, forearm', ['Hands on wall, hold the push-up position.'], true),
  wristDrill('w3-weight-shifts', 'Hands-and-knees weight shifts', 'Floor mat', 'wrist, forearm', ['On hands and knees, shift weight over the hands.'], false),
  wristDrill('w3-ball-catch', 'Ball throw and catch', 'Ball', 'wrist, forearm', [
    'Throw and catch into right hand.',
    'Palm up, then thumb up, then palm down.',
  ], false),
  wristDrill('w3-band-twist', 'Twist against band resistance', 'Resistance band', 'forearm rotators', ['Twist against band resistance through full rotation.'], false),

  // Optional shoulder care (Section 7)
  shoulderDrill('sc-iso-er', 'Isometric external rotation (doorframe)', 'Doorframe', [
    'Elbow at side.',
    'Push the back of the hand out against the doorframe, no movement.',
    '30% effort.',
  ], true),
  shoulderDrill('sc-cable-er', 'Cable external rotation', 'Cable', ['Elbow pinned at side.', 'Lightest weight.'], false),
  shoulderDrill('sc-blade-squeeze', 'Shoulder blade squeeze on row machine', 'Row machine, no weight', ['No weight.', 'Squeeze shoulder blades together.'], false),

  // Home rehab day (Section 8)
  {
    id: 'floor-glute-bridge',
    name: 'Floor glute bridge',
    machine: 'Floor, no equipment',
    musclesText: 'glutes',
    muscles: ['glutes'],
    category: 'home',
    startWeightKg: 0,
    startWeightNote: 'Bodyweight',
    increment: null,
    preInjuryBest: null,
    steps: ['Glute activation, bodyweight.'],
    flags: [],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'none',
    lockedUntil: null,
  },
  {
    id: 'walk',
    name: 'Walk (flat)',
    machine: 'Outdoors',
    musclesText: 'walking',
    muscles: ['cardio'],
    category: 'home',
    startWeightKg: null,
    startWeightNote: null,
    increment: null,
    preInjuryBest: null,
    steps: ['Flat ground.'],
    flags: [],
    painJoints: ['knee'],
    unilateral: false,
    timed: false,
    plateLoaded: false,
    progression: 'none',
    lockedUntil: null,
  },
]

function wristDrill(id: string, name: string, machine: string, musclesText: string, steps: string[], timed: boolean): Exercise {
  return {
    id,
    name,
    machine,
    musclesText,
    muscles: ['forearm'],
    category: 'wristRehab',
    startWeightKg: null,
    startWeightNote: null,
    increment: null,
    preInjuryBest: null,
    steps,
    flags: [],
    painJoints: ['wrist'],
    unilateral: false,
    timed,
    plateLoaded: false,
    progression: 'none',
    lockedUntil: null,
  }
}

function shoulderDrill(id: string, name: string, machine: string, steps: string[], timed: boolean): Exercise {
  return {
    id,
    name,
    machine,
    musclesText: 'posterior cuff',
    muscles: ['rotatorCuff'],
    category: 'shoulderCare',
    startWeightKg: null,
    startWeightNote: null,
    increment: null,
    preInjuryBest: null,
    steps: [...steps, 'Stop at shoulder pain above 2/10.'],
    flags: ['physio-approved only'],
    painJoints: ['shoulder'],
    unilateral: false,
    timed,
    plateLoaded: false,
    progression: 'none',
    lockedUntil: null,
  }
}

// ---------------------------------------------------------------- Section 5

type ItemOpts = Partial<Omit<SessionItem, 'exerciseId' | 'section' | 'prescription'>>

function item(exerciseId: string, section: SessionItem['section'], prescription: SessionItem['prescription'], opts: ItemOpts = {}): SessionItem {
  return {
    exerciseId,
    section,
    prescription,
    restSec: opts.restSec ?? null,
    tempo: opts.tempo ?? null,
    note: opts.note ?? null,
    perSide: opts.perSide ?? false,
    skipIf: opts.skipIf ?? null,
  }
}

const sets = (n: number, min: number, max: number = min) => ({ kind: 'fixed' as const, sets: n, reps: { min, max } })
const kneeStage = { kind: 'kneeStage' as const }

const bike = item('bike', 'warmup', { kind: 'duration', minutes: { min: 5, max: 5 } }, { note: 'Easy' })
const kneePrimer = item('spanish-squat', 'kneePrimer', { kind: 'timed', sets: 2, holdSec: { min: 30, max: 30 } }, { note: 'Spanish squat or wall sit' })
const wristBlock = { block: 'wristBlock', section: 'wristBlock', optional: false } as const
const shoulderCare = { block: 'shoulderCare', section: 'shoulderCare', optional: true } as const

export const SESSIONS: SessionTemplate[] = [
  {
    id: 'A',
    name: 'Knee + Glute Power + Push',
    entries: [
      bike,
      kneePrimer,
      wristBlock,
      item('leg-extension', 'kneeStrength', kneeStage, { tempo: '3-0-3', restSec: 120 }),
      item('leg-press', 'kneeStrength', kneeStage, { tempo: '3-0-3', restSec: 120 }),
      item('hip-thrust', 'gluteHam', sets(3, 8, 12), { restSec: 120 }),
      item('lying-hamstring-curl', 'gluteHam', sets(3, 10, 12), { tempo: '3 sec lowering', restSec: 90 }),
      item('leg-press-calf-raise', 'gluteHam', sets(3, 12, 15), { restSec: 60 }),
      item('chest-press', 'upper', sets(3, 8, 12), { restSec: 90 }),
      item('cable-tricep-pushdown', 'upper', sets(3, 10, 15), { restSec: 60 }),
      item('dead-bug', 'core', sets(3, 8), { perSide: true }),
      shoulderCare,
    ],
  },
  {
    id: 'B',
    name: 'Knee + Hamstring Focus + Pull',
    entries: [
      bike,
      kneePrimer,
      wristBlock,
      item('leg-extension', 'kneeStrength', kneeStage, { tempo: '3-0-3' }),
      item('leg-press', 'kneeStrength', kneeStage, { tempo: '3-0-3' }),
      item('lying-hamstring-curl', 'gluteHam', sets(4, 8, 10), { tempo: '3 sec lowering', restSec: 120 }),
      item('cable-glute-kickback', 'gluteHam', sets(3, 12, 15), { perSide: true, restSec: 60, note: 'Ankle strap' }),
      item('hip-abduction', 'gluteHam', sets(3, 12, 15), { tempo: '2 sec hold at open', restSec: 60 }),
      item('chest-supported-row', 'upper', sets(3, 8, 12), { restSec: 90, note: 'Neutral grip, straps' }),
      item('lat-pulldown', 'upper', sets(3, 10, 12), { skipIf: { joint: 'shoulder', above: 2 }, note: 'Skip if shoulder above 2/10' }),
      item('cable-hammer-curl', 'upper', sets(3, 10, 15), { restSec: 60 }),
      item('reverse-crunch', 'core', sets(3, 10, 15), { note: 'On bench' }),
      shoulderCare,
    ],
  },
  {
    id: 'C',
    name: 'Knee + Glute Volume + Arms + Core',
    entries: [
      bike,
      kneePrimer,
      wristBlock,
      item('leg-extension', 'kneeStrength', kneeStage, { tempo: '3-0-3' }),
      item('leg-press', 'kneeStrength', kneeStage, { tempo: '3-0-3' }),
      item('hip-thrust', 'gluteHam', sets(3, 12, 15), { tempo: '2 sec squeeze at top', restSec: 90 }),
      item('lying-hamstring-curl', 'gluteHam', sets(3, 12, 15), { restSec: 90 }),
      item('hip-adduction', 'gluteHam', sets(3, 12, 15), { restSec: 60 }),
      item('calf-raise-machine', 'gluteHam', sets(3, 12, 15), { note: 'Straight knee' }),
      item('chest-press', 'upper', sets(3, 8, 12)),
      item('cable-hammer-curl', 'upper', sets(3, 10, 15)),
      item('cable-tricep-pushdown', 'upper', sets(3, 10, 15)),
      item('cable-crunch', 'core', sets(3, 12, 15), { note: 'Kneeling, rope' }),
      item('forearm-side-plank', 'core', { kind: 'timed', sets: 3, holdSec: { min: 20, max: 30 } }, { perSide: true }),
      shoulderCare,
    ],
  },
]

export const WEEKLY_GLUTE_HAM_VOLUME = [
  { exerciseId: 'hip-thrust', sets: 6 },
  { exerciseId: 'lying-hamstring-curl', sets: 10 },
  { exerciseId: 'cable-glute-kickback', sets: 3, perSide: true },
  { exerciseId: 'hip-abduction', sets: 3 },
  { exerciseId: 'hip-adduction', sets: 3 },
] as const

// ---------------------------------------------------------------- Section 4

export const WEEK_PLAN: WeekPlanDay[] = [
  { label: 'Gym 1', kind: 'gym', session: 'A', plan: 'Session A' },
  { label: 'Next', kind: 'home', session: null, plan: 'Home rehab' },
  { label: 'Gym 2', kind: 'gym', session: 'B', plan: 'Session B' },
  { label: 'Next', kind: 'home', session: null, plan: 'Home rehab' },
  { label: 'Gym 3', kind: 'gym', session: 'C', plan: 'Session C' },
  { label: 'Next', kind: 'home', session: null, plan: 'Home rehab' },
  { label: 'Rest', kind: 'rest', session: null, plan: 'Wrist W1 only' },
]

// ---------------------------------------------------------------- Section 3 + 8 (wrist)

const hold = (setsN: number, reps: number, holdMin: number, holdMax: number = holdMin) =>
  ({ kind: 'holdReps' as const, sets: setsN, reps: { min: reps, max: reps }, holdSec: { min: holdMin, max: holdMax } })

export const WRIST_STAGES: WristStage[] = [
  {
    id: 'W1',
    name: 'Isometric',
    summary: 'Push against resistance without moving. Forearm thumb-up, 30% effort, 5 to 10 sec holds, 3 x 10.',
    status: 'current',
    unlockRule: ['14 days in a row of wrist pain 2/10 or less'],
    exercises: [
      item('w1-palm-down-iso', 'wristBlock', hold(3, 10, 5, 10)),
      item('w1-palm-up-iso', 'wristBlock', hold(3, 10, 5, 10)),
      item('w1-pinky-side-iso', 'wristBlock', hold(3, 10, 5)),
      item('w1-grip-putty', 'wristBlock', hold(3, 10, 5)),
      item('w1-dart-throw', 'wristBlock', sets(2, 15)),
    ],
    notes: [],
  },
  {
    id: 'W2',
    name: 'Band strength',
    summary: 'Light resistance band through pain-free range, 3 x 10 to 15.',
    status: 'locked',
    unlockRule: ['14 days in a row of wrist pain 2/10 or less'],
    exercises: [
      item('w2-band-turns', 'wristBlock', sets(3, 10, 15)),
      item('w2-band-ecu-lift', 'wristBlock', sets(3, 15)),
      item('w2-band-ext-flex', 'wristBlock', sets(3, 15)),
      item('w2-grip-putty', 'wristBlock', hold(3, 10, 5)),
      item('w2-dart-throw-band', 'wristBlock', sets(2, 15)),
    ],
    notes: [],
  },
  {
    id: 'W3',
    name: 'Load bearing',
    summary: 'Wall push-up holds, weight shifts, ball catches, twisting against resistance.',
    status: 'locked',
    unlockRule: ['14 days in a row of wrist pain 2/10 or less'],
    exercises: [
      item('w3-wall-pushup-hold', 'wristBlock', hold(3, 10, 5)),
      item('w3-weight-shifts', 'wristBlock', sets(2, 10)),
      item('w3-ball-catch', 'wristBlock', sets(3, 30)),
      item('w3-band-twist', 'wristBlock', sets(3, 10)),
    ],
    notes: ['Gradually stop using straps on rows.'],
  },
]

export const WRIST_BLOCK_MINUTES = { min: 8, max: 10 } as const

// ---------------------------------------------------------------- Section 7

export const SHOULDER_CARE: SessionItem[] = [
  item('sc-iso-er', 'shoulderCare', hold(1, 5, 10)),
  item('sc-cable-er', 'shoulderCare', sets(2, 15)),
  item('sc-blade-squeeze', 'shoulderCare', sets(2, 15)),
]
export const SHOULDER_CARE_MINUTES = 5

// ---------------------------------------------------------------- Section 8 (home day)

/** The wrist block at current stage is inserted after the knee item at runtime. */
export const HOME_DAY: SessionEntry[] = [
  item('spanish-squat', 'kneePrimer', { kind: 'timed', sets: 5, holdSec: { min: 45, max: 45 } }, { restSec: 120, note: 'Spanish squat or wall sit' }),
  { block: 'wristBlock', section: 'wristBlock', optional: false },
  item('floor-glute-bridge', 'gluteHam', sets(2, 15), { note: 'Bodyweight, glute activation, no equipment' }),
  item('walk', 'warmup', { kind: 'duration', minutes: { min: 20, max: 30 } }, { note: 'Flat' }),
]

// ---------------------------------------------------------------- Section 3 (milestones)

export const MILESTONES: Milestone[] = [
  { id: 'm1', order: 1, exerciseId: 'hip-thrust', target: { weightKg: 70, reps: 10 }, label: 'Hip thrust back to pre-injury 70 kg x 10', note: null },
  { id: 'm2', order: 2, exerciseId: 'lying-hamstring-curl', target: { weightKg: 47.5, reps: 12 }, label: 'Lying hamstring curl back to pre-injury 47.5 kg x 12', note: null },
  { id: 'm3', order: 3, exerciseId: 'hip-thrust', target: { weightKg: 100, reps: 10 }, label: 'Hip thrust 100 kg x 10', note: 'Roughly bodyweight-plus, a solid glute strength marker' },
  { id: 'm4', order: 4, exerciseId: 'hip-abduction', target: { weightKg: 70, reps: 12 }, label: 'Hip abduction 70 kg x 12', note: null },
]

// ---------------------------------------------------------------- Section 9

export const PROGRESSION = {
  knee: {
    increaseIf: [
      'All reps hit',
      'Last set RIR 2+',
      'Pain 3/10 or less',
      'Morning check same or better than baseline',
    ],
    minLastSetRir: 2,
    maxPain: 3,
    blockChangeLoadPct: 8,
    badMorning: { loadPct: -20, sets: 3 },
    flare: {
      trigger: 'Two bad mornings in a row',
      badMorningsInARow: 2,
      // Plan says "3 to 4 days"; the build brief fixes it at 3 and -20%.
      isometricOnlyDays: 3,
      restartLoadPct: -20,
    },
  },
  double: {
    minRir: 2,
    missBottomSessionsInARow: 2,
    missBottomLoadPct: -10,
    note: 'Glute and hamstring lifts progress fastest; they carry no injury gate unless knee or back pain appears.',
  },
  gates: {
    wrist: { consecutiveDays: 14, maxPain: 2, regressAbovePain: 3, regressOnNextDaySwelling: true },
    kneeStage3: { minStage2Weeks: 8, maxDeclineSquatPain: 2, legPressBlock: { sets: 4, reps: 6 }, noMorningFlareDays: 14 },
  },
  morningKneeCheck: '5 slow single-leg squats to a chair (or one flight of stairs down), pain 0 to 10 per leg.',
} as const

export const SWAPS: SwapRule[] = [
  {
    exerciseIds: ['chest-press'],
    trigger: { joint: 'shoulder', above: 2 },
    steps: [
      { kind: 'modify', label: 'Shorten range' },
      { kind: 'drop', scope: 'week', label: 'Still sore: drop for the week' },
    ],
  },
  {
    exerciseIds: ['chest-supported-row', 'lat-pulldown'],
    trigger: { joint: 'wrist', above: 3 },
    steps: [
      { kind: 'modify', label: 'Use straps' },
      { kind: 'modify', label: 'Still sore: single-arm with straps' },
    ],
  },
  {
    exerciseIds: ['cable-hammer-curl', 'cable-tricep-pushdown'],
    trigger: { joint: 'wrist', above: 3 },
    steps: [
      { kind: 'loadChange', pct: -30, label: '-30% load' },
      { kind: 'modify', label: 'Still sore: isometric hold at 90 degrees elbow' },
    ],
  },
]

/** Any wrist > 3 or shoulder > 2 on any set: hold load, flag exercise, offer swap. */
export const PAIN_FLAG_ACTION = { kind: 'hold', label: 'Hold load next session and flag exercise' } as const

// ---------------------------------------------------------------- Section 10

export const RECOVERY_NOTES = [
  'Protein high while in a calorie deficit; tendons adapt more slowly when under-fuelled.',
  'Optional: 15 g gelatin or collagen with vitamin C, 30 to 60 min before gym. Modest evidence for tendon collagen building.',
  'Sleep 7+ hours; tendons remodel between sessions.',
  'Cadence 169 to 175 steps per minute when running returns (lowers knee tendon load).',
] as const

// ---------------------------------------------------------------- Section 11

export const SOURCES = [
  { label: 'Kongsgaard et al. 2009, heavy slow resistance for patellar tendinopathy', url: null },
  { label: 'Malliaras et al. 2015, patellar tendinopathy loading progression', url: null },
  { label: 'Singapore General Hospital wrist sensorimotor program for TFCC', url: 'https://ncbi.nlm.nih.gov/pmc/articles/PMC10584051' },
  { label: 'Staged TFCC rehab case report (PQ, ECU, dart-throw motion)', url: 'https://www.sciencedirect.com/science/article/abs/pii/S0894113017304040' },
  { label: 'TFCC rehab protocol: isometrics to isotonic to torque', url: 'https://www.upperlimb.in/therapy-protocol/tfcc-injury-protocol/' },
  { label: 'Shaw et al. 2017, gelatin plus vitamin C and collagen synthesis', url: null },
] as const
