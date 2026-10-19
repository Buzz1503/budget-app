import BodyHealthView from './BodyHealthView'

/** The Sleep tab: last night, the plan for tonight, and how sleep is trending. */
export default function SleepTab({ goTo }) {
  return (
    <div className="space-y-3" data-testid="sleep-tab">
      <h1 className="text-2xl font-black tracking-tight">Sleep</h1>
      <BodyHealthView segment="sleep" goTo={goTo} />
    </div>
  )
}
