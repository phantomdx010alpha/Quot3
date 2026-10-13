import { AppShell } from './components/layout/AppShell'
import { ROUTES } from '@shared/routes'
import Dashboard from './pages/Dashboard'
import DesignPreview from './pages/dev/DesignPreview'
import GridDev from './pages/dev/GridDev'
import PerfDev from './pages/dev/PerfDev'
import PrintPreviewDev from './pages/dev/PrintPreviewDev'
import Create from './pages/Create'
import History from './pages/History'
import Customers from './pages/Customers'
import Items from './pages/Items'
import Settings from './pages/Settings'
import { TitleBar } from './components/layout/TitleBar'
import { usePath } from './router/routerStore'
import { RouteToastClear } from './components/RouteToastClear'

function Page({ path }: { path: string }): React.JSX.Element {
  switch (path) {
    case ROUTES.create:
      return <Create />
    case ROUTES.history:
      return <History />
    case ROUTES.customers:
      return <Customers />
    case ROUTES.items:
      return <Items />
    case ROUTES.settings:
      return <Settings />
    case ROUTES.designPreview:
      return <DesignPreview />
    case ROUTES.devGrid:
      return <GridDev />
    case ROUTES.devPerf:
      return <PerfDev />
    case ROUTES.devPrintPreview:
      return <PrintPreviewDev />
    default:
      return <Dashboard />
  }
}

export default function App(): React.JSX.Element {
  const path = usePath()
  return (
    <div className="q3-app">
      <TitleBar />
      <RouteToastClear />
      <AppShell>
        <Page path={path} />
      </AppShell>
    </div>
  )
}
