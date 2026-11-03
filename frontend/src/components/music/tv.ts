/** The page the station's browser draws (`/?tv`). It is rasterised in software, so
 *  the canvases skip Canvas 2D `filter: blur` and the CSS blur on the background:
 *  blurs are made by drawing small and scaling up (SPEC-music §7). */
export const TV = new URLSearchParams(window.location.search).has('tv')
