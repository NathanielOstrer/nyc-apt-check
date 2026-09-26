import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Level, MapFeature, Place } from '../checks/types'

const LEVEL_COLOR: Record<Level, string> = {
  high: '#c62828',
  medium: '#e08a00',
  low: '#5f7f3a',
  info: '#1f6fb2',
  clear: '#777',
}

interface Props {
  place: Place
  features: MapFeature[]
}

export function RiskMap({ place, features }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { scrollWheelZoom: false })
    // OSM's own tiles are fine for light personal use with attribution. CARTO's basemaps now need a key.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    map.current = m
    layer.current = L.layerGroup().addTo(m)
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  // Recenter only when the address changes, so late-arriving features do not move the view.
  useEffect(() => {
    map.current?.setView([place.lat, place.lon], 15)
  }, [place.lat, place.lon])

  useEffect(() => {
    const group = layer.current
    if (!group) return
    group.clearLayers()
    for (const f of features) {
      const color = LEVEL_COLOR[f.level]
      if (f.kind === 'polygon') {
        // Esri rings are [lon, lat]. Leaflet wants [lat, lon].
        const latlngs = f.rings.map((ring) => ring.map(([x, y]) => [y, x] as [number, number]))
        L.polygon(latlngs, { color, weight: 2, fillOpacity: 0.15 }).bindTooltip(f.label).addTo(group)
      } else {
        L.circleMarker([f.lat, f.lon], { radius: 6, color, weight: 2, fillOpacity: 0.6 }).bindTooltip(f.label).addTo(group)
      }
    }
    L.circleMarker([place.lat, place.lon], { radius: 9, color: '#111', weight: 3, fillColor: '#fff', fillOpacity: 1 })
      .bindTooltip(place.label, { permanent: false })
      .addTo(group)
  }, [features, place])

  return <div className="map" ref={el} role="img" aria-label={`A map of the area around ${place.label}`} />
}
