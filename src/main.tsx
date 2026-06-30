import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ViewerPage } from './pages/ViewerPage.tsx'
import { BoxCallbackPage } from './pages/BoxCallbackPage.tsx'
import { MapPocPage } from './pages/MapPocPage.tsx'
import { MapPage } from './map/MapPage.tsx'

const path = window.location.pathname.replace(/\/$/, '')

const root = createRoot(document.getElementById('root')!)
if (path === '/viewer' || path.endsWith('/viewer')) {
  root.render(<StrictMode><ViewerPage /></StrictMode>)
} else if (path === '/auth/box/callback' || path.endsWith('/auth/box/callback')) {
  root.render(<StrictMode><BoxCallbackPage /></StrictMode>)
} else if (path === '/map-poc' || path.endsWith('/map-poc')) {
  root.render(<StrictMode><MapPocPage /></StrictMode>)
} else if (path === '/map' || path.endsWith('/map')) {
  root.render(<StrictMode><MapPage /></StrictMode>)
} else {
  root.render(<StrictMode><App /></StrictMode>)
}
