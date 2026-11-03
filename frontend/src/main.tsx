import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Layer from './components/music/Layer'

// The station renders this page headless: the player's picture and nothing else (SPEC-music §7).
const tv = new URLSearchParams(window.location.search).has('tv')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {tv ? <Layer tv /> : <App />}
  </StrictMode>,
)

// PWA: app-shell service worker (production only; /api is never intercepted).
if (!tv && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
