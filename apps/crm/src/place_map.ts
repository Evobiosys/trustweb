/**
 * The Desk's map: Leaflet with OpenStreetMap tiles. Loaded only when the Map page opens and the map block is in view (dynamic import,
 * its own chunk); the only requests it makes are tile images from tile.openstreetmap.org. Pins are divIcons (no marker png assets).
 */
import type { Map as LeafletMap, LayerGroup } from 'leaflet'
import { onResizeFrame } from './desk'
import { S } from './strings'
import type { View } from './place_geo'

export interface Pin {
  place: string
  lat: number
  lon: number
  people: { id: string; name: string; initials: string }[]
}
export interface MapHandle {
  setPins(pins: Pin[]): void
  setView(v: View): void
  destroy(): void
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

function popupOf(pin: Pin, onPick: (id: string) => void): HTMLElement {
  const box = document.createElement('div')
  box.className = 'desk-popup'
  const h = document.createElement('strong')
  h.textContent = pin.place
  box.append(h)
  for (const p of pin.people) {
    const b = document.createElement('button')
    b.className = 'desk-link'
    b.textContent = p.name
    b.onclick = (): void => onPick(p.id)
    box.append(b)
  }
  return box
}

export async function createMap(el: HTMLElement, view: View, onPick: (id: string) => void): Promise<MapHandle> {
  const [L, { default: css }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css?inline')])
  el.before(Object.assign(document.createElement('style'), { textContent: css }))
  const map: LeafletMap = L.map(el, { zoomControl: true }).setView([view.lat, view.lon], view.zoom)
  L.tileLayer(TILES, { maxZoom: 19, attribution: S.desk.mapAttribution }).addTo(map)
  const layer: LayerGroup = L.layerGroup().addTo(map)
  let live = true
  const resize = new ResizeObserver(onResizeFrame(() => { if (live) map.invalidateSize() }))
  resize.observe(el)
  return {
    setPins(pins) {
      layer.clearLayers()
      for (const pin of pins) {
        const one = pin.people.length === 1
        const dot = document.createElement('span')
        dot.className = 'desk-pin'
        dot.textContent = one ? pin.people[0].initials : String(pin.people.length)
        L.marker([pin.lat, pin.lon], { icon: L.divIcon({ html: dot, className: '', iconSize: [34, 34], iconAnchor: [17, 17] }), title: pin.place })
          .bindPopup(popupOf(pin, onPick)).addTo(layer)
      }
    },
    setView: (v) => { map.setView([v.lat, v.lon], v.zoom) },
    destroy() { live = false; resize.disconnect(); map.remove() },
  }
}
