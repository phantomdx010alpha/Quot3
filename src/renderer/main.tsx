import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastProvider } from './components/ui'
import { ThemeProvider } from './theme/ThemeProvider'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installErrorReporting } from './errorReporting'
import './styles/index.css'

// Phase 61: window errors and unhandled rejections go to the rolling log in main (scrubbed, throttled).
installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
)
