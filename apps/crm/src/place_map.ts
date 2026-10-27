/**
 * The Desk's map: Leaflet over a bundled world outline (Natural Earth 110m, this chunk only), so opening it sends nothing. Loaded only
 * when the Map page opens and the map block is in view (dynamic import, its own chunk). Only the "Detailed map" choice adds tile images
 * from tile.openstreetmap.org. Pins are divIcons (no marker png assets).
 */
import type { Map as LeafletMap, LayerGroup, TileLayer } from 'leaflet'
import countries from './map/ne_110m_countries.json'
import { onResizeFrame } from './desk'
import { S } from './strings'
import type { View } from './place_geo'

export interface Pin {
  place: string
  lat: number
  lon: number
  people: { id: string; name: string; initials: string }[]
  approx?: boolean
}
export interface MapHandle {
  setPins(pins: Pin[]): void
  setView(v: View): void
  setTiles(on: boolean): void
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

export async function createMap(el: HTMLElement, view: View, onPick: (id: string) => void, tiles: { on: boolean; onToggle(on: boolean): void }): Promise<MapHandle> {
  const [L, { default: css }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css?inline')])
  el.before(Object.assign(document.createElement('style'), { textContent: css }))
  const map: LeafletMap = L.map(el, { zoomControl: true, maxZoom: 19 }).setView([view.lat, view.lon], view.zoom)
  L.geoJSON(countries as GeoJSON.FeatureCollection, { interactive: false, attribution: S.desk.mapLocalAttribution, style: { color: '#5b6b80', weight: 0.6, fillColor: '#1d2633', fillOpacity: 1 } }).addTo(map)
  let osm: TileLayer | undefined
  const toggle = document.createElement('button')
  toggle.className = 'desk-map-tiles'
  toggle.dataset.mapTiles = ''
  toggle.textContent = S.desk.mapTiles
  const setTiles = (on: boolean): void => {
    toggle.setAttribute('aria-pressed', String(on))
    if (on) (osm ??= L.tileLayer(TILES, { maxZoom: 19, attribution: S.desk.mapAttribution })).addTo(map)
    else osm?.remove()
  }
  toggle.onclick = (): void => { const on = toggle.getAttribute('aria-pressed') !== 'true'; setTiles(on); tiles.onToggle(on) }
  const control = new L.Control({ position: 'topright' })
  control.onAdd = (): HTMLElement => { L.DomEvent.disableClickPropagation(toggle); return toggle }
  control.addTo(map)
  setTiles(tiles.on)
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
        dot.className = pin.approx ? 'desk-pin approx' : 'desk-pin'
        dot.textContent = one ? pin.people[0].initials : String(pin.people.length)
        L.marker([pin.lat, pin.lon], { icon: L.divIcon({ html: dot, className: '', iconSize: [34, 34], iconAnchor: [17, 17] }), title: pin.place })
          .bindPopup(popupOf(pin, onPick)).addTo(layer)
      }
    },
    setView: (v) => { map.setView([v.lat, v.lon], v.zoom) },
    setTiles,
    destroy() { live = false; resize.disconnect(); map.remove() },
  }
}
