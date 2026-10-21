import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrapServices } from './ui/bootstrap'
import type { AppServices } from './ui/services'
import './styles/pwa.css'
import './ui/tokens.css'
import './ui/ui.css'

function Boot() {
  const [services, setServices] = useState<AppServices | null>(null)
  useEffect(() => { void bootstrapServices().then(setServices) }, [])
  return services ? <App services={services} /> : <p className="q3-muted" role="status">Opening</p>
}

const el = document.getElementById('root')
if (el) createRoot(el).render(<StrictMode><Boot /></StrictMode>)
