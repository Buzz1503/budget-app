import { useEffect, useState } from 'react'
import { db } from './db/db'
import { seedIfEmpty } from './db/seedDb'

/** Placeholder shell until the workout player lands (build step 3). */
export function App() {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    void seedIfEmpty(db).then(() => db.exercises.count().then(setCount))
  }, [])
  return (
    <main className="min-h-dvh bg-neutral-950 p-4 text-neutral-100">
      <h1 className="text-2xl font-semibold">Rebound</h1>
      <p className="mt-2 text-neutral-400">{count === null ? 'Loading…' : `${count} exercises loaded from your plan.`}</p>
    </main>
  )
}
