import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Warning } from '@phosphor-icons/react'
import { Button, EmptyState } from './ui'
import { reportRendererError } from '../errorReporting'
import { useDiagnosticsStore } from '../stores/diagnosticsStore'

interface State { failed: boolean; copied: string }

/**
 * Phase 61 - a screen that throws while rendering shows this instead of a blank window. The error goes to the log (scrubbed);
 * "Copy diagnostics" and "Reload" are the way forward. An unsaved bill is safe: drafts are written every few seconds (Phase 29).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false, copied: '' }

  static getDerivedStateFromError(): Partial<State> { return { failed: true } }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRendererError('render', error, info.componentStack ?? undefined)
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="q3-page" role="alert">
        <EmptyState icon={Warning} title="Something went wrong on this screen" description="Your saved bills are safe, and an unsaved bill is recovered when you reload. Copy the diagnostics if you need to report this." />
        <div className="q3-set__row">
          <Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="ghost" onClick={() => { void useDiagnosticsStore.getState().copy().then((ok) => this.setState({ copied: ok ? 'Diagnostics copied.' : 'Could not copy.' })) }}>Copy diagnostics</Button>
        </div>
        {this.state.copied !== '' && <p className="q3-set__muted" role="status">{this.state.copied}</p>}
      </div>
    )
  }
}
