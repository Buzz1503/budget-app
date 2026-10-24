import { Component } from 'react'
import { logError } from '../../lib/errorLog'

/**
 * A screen that throws while drawing shows this instead of a blank page. The
 * error goes to the local error log (More › Data › Backups and reports); your
 * data is untouched.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    logError(error, { kind: 'render', where: this.props.where || null })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="card p-5" role="alert" data-testid="screen-error">
        <p className="text-base font-black">This screen could not be shown</p>
        <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>Your data is safe. The problem was saved to the error log in More › Data › Backups and reports.</p>
        <button type="button" onClick={() => this.setState({ failed: false })} className="btn-primary mt-4 w-full rounded-full py-2.5 text-sm font-black" data-testid="screen-error-retry">Try again</button>
      </div>
    )
  }
}
