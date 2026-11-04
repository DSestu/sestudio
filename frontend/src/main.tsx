import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TvLayer } from './components/music/Layer'
import { followStation } from './musicQueue'
import { engine } from './components/music/engine'

// The station renders this page headless: the player's picture and nothing else (SPEC-music §7).
const tv = new URLSearchParams(window.location.search).has('tv')
// Its sound runs the light's lead early, as a browser's analyser runs ahead of its delayed sound,
// so the light leads the station's sound as it leads a browser's.
if (tv) followStation(() => engine.lead)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {tv ? <TvLayer /> : <App />}
  </StrictMode>,
)

// PWA: app-shell service worker (production only; /api is never intercepted).
if (!tv && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
