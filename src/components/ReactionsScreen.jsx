import ReactionTracker from './reaction/ReactionTracker'

/** Injection site reactions, its own row in More. The tracker itself is unchanged. */
export default function ReactionsScreen() {
  return (
    <div className="space-y-3" data-testid="reactions-screen">
      <h1 className="text-2xl font-black tracking-tight">Reactions</h1>
      <ReactionTracker />
    </div>
  )
}
