import ReactionTracker from './reaction/ReactionTracker'
import { OpenReactionsCard } from './reaction/ReactionCourse'

/**
 * Injection site reactions, its own row in More. The tracker is unchanged;
 * open reactions and their daily check moved here from Home in stage 2D.
 */
export default function ReactionsScreen() {
  return (
    <div className="space-y-3" data-testid="reactions-screen">
      <h1 className="text-2xl font-black tracking-tight">Reactions</h1>
      <OpenReactionsCard />
      <ReactionTracker />
    </div>
  )
}
