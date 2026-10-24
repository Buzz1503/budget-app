// The Sleep setup checklist (More › Health › Sleep setup, and a card on the
// Sleep tab until it is complete). Each item is ticked from the data itself
// where it can be: a tick means the data is arriving, not that a setting was
// seen. Otherwise the item stays open with plain instructions.

export const BATTERY_FLOOR = 0.3

export interface SetupInput {
  /** nights with Health sleep data in the last 14 days */
  sleepNights: number
  /** nights with overnight blood oxygen readings in the last 14 */
  spo2Nights: number
  /** nights with breathing disturbance values in the last 14 */
  breathingNights: number
  /** a Pepito complication on the current watch face (from the Watch), null when never reported */
  complication: boolean | null
  /** Sleep sounds has started by itself (the shortcut) at least once */
  soundsAuto: boolean
  /** Screen Time access for late phone use, null when not available on this device */
  screenTime: boolean | null
  /** a HomeKit temperature sensor this app can read, null when HomeKit is off */
  roomSensor: boolean | null
  /** the Watch battery last reported (0 to 1), null when never */
  watchBattery: number | null
}

export interface SetupItem {
  key: string
  label: string
  /** true ticked, false not yet, null nothing to detect */
  done: boolean | null
  optional?: boolean
  how: string
  /** a line under it, like the last reported battery */
  note?: string
  /** where the app can take you for it */
  action?: 'sounds' | 'screenTime' | 'homeKit'
}

export function setupChecklist(x: SetupInput): { items: SetupItem[]; done: number; of: number; complete: boolean } {
  const items: SetupItem[] = [
    {
      key: 'schedule', label: 'Sleep schedule or Sleep Focus on', done: x.sleepNights > 0,
      how: 'In the Health app, Browse › Sleep › Full Schedule & Options. Sleep data arriving ticks this.',
    },
    {
      key: 'spo2', label: 'Blood oxygen background measurements on', done: x.spo2Nights > 0,
      how: 'On the iPhone, Watch app › Blood Oxygen › Background Measurements. Overnight readings arriving tick this.',
    },
    {
      key: 'breathing', label: 'Breathing disturbances on', done: x.breathingNights > 0,
      how: 'In the Health app, Browse › Respiratory › Breathing Disturbances, or Sleep Apnea Notifications on in the Watch app. Values arriving tick this.',
    },
    {
      key: 'complication', label: 'A Pepito complication on your watch face', done: x.complication === true,
      how: 'Long-press the watch face, Edit, and add any Pepito+ complication. It keeps background updates reliable, including the overnight recording.',
    },
    {
      key: 'sounds', label: 'Sleep sounds starts by itself', done: x.soundsAuto,
      how: 'Make it automatic in More › Health › Sleep. The first automatic start ticks this.', action: 'sounds',
    },
    {
      key: 'screenTime', label: 'Screen Time access for late phone use', done: x.screenTime === true,
      how: x.screenTime === null ? 'Not available on this iPhone.' : 'Allow Screen Time in More › Health › Sleep.', action: 'screenTime',
    },
    {
      key: 'room', label: 'A HomeKit bedroom temperature sensor', done: x.roomSensor === true, optional: true,
      how: 'Optional. Any HomeKit sensor in a room with "bed" in its name, else the first one found.', action: 'homeKit',
    },
    {
      key: 'battery', label: 'Wear the Watch to bed with at least 30% battery', done: null,
      how: 'If the Watch is under 30% at the evening prompt, it reminds you to charge it first.',
      note: x.watchBattery != null ? `Last reported: ${Math.round(x.watchBattery * 100)}%` : undefined,
    },
  ]
  const counted = items.filter((i) => !i.optional && i.done !== null && !(i.key === 'screenTime' && x.screenTime === null))
  const done = counted.filter((i) => i.done).length
  return { items, done, of: counted.length, complete: done === counted.length }
}

/** The bedtime nudge on the Watch: under 30% at the evening prompt. */
export const needsCharge = (battery: number | null) => battery != null && battery < BATTERY_FLOOR
