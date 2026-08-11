import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type VectorTileSource,
} from 'maplibre-gl'
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TokenType, type Coordinates, type Token } from './token-store'

setWorkerUrl(maplibreWorker)

const MAP_VIEW_STORAGE_KEY = 'umerica-token-map.view.v1'
const MAP_VIEW_STORAGE_VERSION = 1
const MIN_MAP_ZOOM = 1
const MAX_MAP_ZOOM = 20
const TARGET_ROUTE_SOURCE_ID = 'selected-token-target-route'
const TARGET_ROUTE_LAYER_ID = 'selected-token-target-route-line'
const TRAJECTORY_SOURCE_ID = 'token-trajectories'
const TRAJECTORY_LAYER_ID = 'token-trajectories-line'
const TRAJECTORY_HIT_LAYER_ID = 'token-trajectories-hit'
const LOW_ZOOM_ROAD_LAYER_ID = 'token-atlas-low-zoom-roads'
const ROAD_SOURCE_LAYER = 'transportation'

export type MapTheme = 'light' | 'dark'

const MAP_STYLE_URLS: Record<MapTheme, string> = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/fiord',
}

interface MapViewState {
  longitude: number
  latitude: number
  zoom: number
}

const DEFAULT_MAP_VIEW: MapViewState = {
  longitude: 0,
  latitude: 20,
  zoom: 1.35,
}

export interface TokenMapCallbacks {
  onMapClick: (coordinates: Coordinates) => void
  onTokenSelect: (tokenId: string) => void
  onTokenMove: (tokenId: string, coordinates: Coordinates) => void
  onTrajectoryPointMove: (tokenId: string, pointId: string, coordinates: Coordinates) => void
  onTrajectoryPointRemove: (tokenId: string, pointId: string) => void
  onTrajectoryPointAdd: (tokenId: string, insertIndex: number, coordinates: Coordinates) => void
}

export class TokenMap {
  private readonly map: MapLibreMap
  private readonly markers = new Map<string, Marker>()
  private readonly trajectoryMarkers = new Map<string, Marker>()
  private readonly callbacks: TokenMapCallbacks
  private latestTokens: readonly Token[] = []
  private targetRoute: readonly Coordinates[] = []
  private trajectoryTokenId: string | null = null
  private readonly draggingTrajectoryPoints = new Map<string, Coordinates>()
  private isStyleReady = false
  private trajectoryInteractionsBound = false
  private mapTheme: MapTheme
  private vectorTileRequestVersion = 0

  constructor(container: HTMLElement, callbacks: TokenMapCallbacks, theme: MapTheme = 'light') {
    this.callbacks = callbacks
    this.mapTheme = theme
    const initialMapView = readMapView()
    this.map = new MapLibreMap({
      container,
      style: MAP_STYLE_URLS[theme],
      center: [initialMapView.longitude, initialMapView.latitude],
      zoom: initialMapView.zoom,
      minZoom: MIN_MAP_ZOOM,
      maxZoom: MAX_MAP_ZOOM,
      renderWorldCopies: true,
    })

    this.map.on('moveend', () => saveMapView(this.map))
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    this.map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
    this.map.getCanvas().setAttribute('aria-label', 'Interactive world map')
    this.map.on('style.load', () => this.initializeStyleLayers())
    this.map.on('sourcedata', (event) => {
      if (event.isSourceLoaded) {
        this.initializeLowZoomRoadLayer()
      }
    })
    this.map.on('click', (event) => {
      if (this.isTrajectoryLineAtPoint(event.point)) {
        return
      }

      this.callbacks.onMapClick({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
      })
    })
  }

  render(tokens: readonly Token[], selectedTokenId: string | null): void {
    this.latestTokens = tokens
    const tokenIds = new Set(tokens.map((token) => token.id))

    for (const [tokenId, marker] of this.markers) {
      if (!tokenIds.has(tokenId)) {
        marker.remove()
        this.markers.delete(tokenId)
      }
    }

    for (const token of tokens) {
      const marker = this.markers.get(token.id)
      if (marker) {
        marker.setLngLat([token.longitude, token.latitude])
        marker.setDraggable(token.type !== TokenType.Eliminated)
        this.updateMarkerElement(marker.getElement(), token, token.id === selectedTokenId)
        continue
      }

      this.markers.set(token.id, this.createMarker(token, token.id === selectedTokenId))
    }

    this.renderTrajectories()
  }

  setTrajectoryVisible(tokenId: string | null): void {
    const token = tokenId ? this.latestTokens.find((candidate) => candidate.id === tokenId) : undefined
    this.trajectoryTokenId = token ? tokenId : null
    this.renderTrajectories()
  }

  setTargetRoute(path: readonly Coordinates[] | null): void {
    this.targetRoute = path ?? []
    this.renderTargetRoute()
  }

  setPlacementMode(isActive: boolean): void {
    this.map.getContainer().classList.toggle('is-placing', isActive)
  }

  setTheme(theme: MapTheme): void {
    if (theme === this.mapTheme) {
      return
    }

    this.mapTheme = theme
    this.isStyleReady = false
    this.map.setStyle(MAP_STYLE_URLS[theme])
  }

  private initializeStyleLayers(): void {
    this.configureVectorTiles()
    this.enhanceDarkRoadLayers()
    this.enhanceDarkContextLayers()
    this.initializeLowZoomRoadLayer()
    if (!this.map.getSource(TARGET_ROUTE_SOURCE_ID)) {
      this.initializeTrajectoryLayer()
    }
  }

  private enhanceDarkRoadLayers(): void {
    if (this.mapTheme !== 'dark') {
      return
    }

    const roadLayers = this.map.getStyle().layers
      .map((layer) => layer as unknown as Record<string, unknown>)
      .filter((layer) => (
        layer.type === 'line' &&
        layer['source-layer'] === 'transportation' &&
        typeof layer.id === 'string' &&
        /^(highway|tunnel|bridge)_/.test(layer.id) &&
        (/major|motorway/.test(layer.id) || layer.id === 'highway_minor')
      ))

    for (const layer of roadLayers) {
      const layerId = layer.id as string
      const isMotorway = layerId.includes('motorway')
      const isCasing = layerId.endsWith('_casing')
      const isSubtle = layerId.endsWith('_subtle')
      const isMinorRoad = layerId === 'highway_minor'
      const lineColor = isCasing
        ? isMotorway ? '#98886a' : '#7f8da5'
        : isMinorRoad ? '#66748e' : isMotorway ? '#665b4a' : '#536078'
      const lineOpacity = isSubtle ? 0.68 : isCasing ? 0.7 : 0.78
      this.map.setPaintProperty(layerId, 'line-color', lineColor)
      this.map.setPaintProperty(layerId, 'line-opacity', lineOpacity)
    }
  }

  private enhanceDarkContextLayers(): void {
    if (this.mapTheme !== 'dark') {
      return
    }

    const styleLayers = this.map.getStyle().layers
    for (const layer of styleLayers) {
      if (layer.type === 'line' && layer['source-layer'] === 'boundary') {
        const isCountryFrontier = layer.id.startsWith('boundary_country')
        this.map.setPaintProperty(
          layer.id,
          'line-color',
          isCountryFrontier ? '#a4b8cf' : '#819ab7',
        )
        this.map.setPaintProperty(layer.id, 'line-opacity', isCountryFrontier ? 0.64 : 0.38)
        continue
      }

      if (layer.type !== 'symbol') {
        continue
      }

      if (layer['source-layer'] === 'place') {
        const isPrimaryPlaceLabel = /place_(country|city|town)/.test(layer.id)
        this.map.setPaintProperty(
          layer.id,
          'text-color',
          isPrimaryPlaceLabel ? '#d1dce3' : '#b4c4cf',
        )
        this.map.setPaintProperty(layer.id, 'text-halo-color', '#303a52')
        this.map.setPaintProperty(layer.id, 'text-halo-width', isPrimaryPlaceLabel ? 1.2 : 1)
        continue
      }

      if (layer.id === 'highway_name_other') {
        this.map.setPaintProperty(layer.id, 'text-color', '#aebbd0')
        this.map.setPaintProperty(layer.id, 'text-halo-color', '#303a52')
        this.map.setPaintProperty(layer.id, 'text-halo-width', 1.5)
      }
    }
  }

  private initializeTrajectoryLayer(): void {
    this.isStyleReady = true
    this.map.addSource(TARGET_ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    })
    this.map.addLayer({
      id: TARGET_ROUTE_LAYER_ID,
      type: 'line',
      source: TARGET_ROUTE_SOURCE_ID,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#ec7455',
        'line-dasharray': [0.1, 1.8],
        'line-opacity': 0.9,
        'line-width': 2.5,
      },
    })
    this.map.addSource(TRAJECTORY_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    })
    this.map.addLayer({
      id: TRAJECTORY_LAYER_ID,
      type: 'line',
      source: TRAJECTORY_SOURCE_ID,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-dasharray': [2, 2],
        'line-opacity': 0.72,
        'line-width': 2,
      },
    })
    this.map.addLayer({
      id: TRAJECTORY_HIT_LAYER_ID,
      type: 'line',
      source: TRAJECTORY_SOURCE_ID,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#000000',
        'line-opacity': 0,
        'line-width': 12,
      },
    })
    if (!this.trajectoryInteractionsBound) {
      this.map.on('click', TRAJECTORY_HIT_LAYER_ID, (event) => {
        event.originalEvent.stopPropagation()

        const token = this.latestTokens.find((candidate) => candidate.id === this.trajectoryTokenId)
        if (!token) {
          return
        }

        const path = [...token.trajectory, token]
        const segmentIndex = this.findClosestTrajectorySegment(path, event.point)
        if (segmentIndex === null) {
          return
        }

        this.callbacks.onTrajectoryPointAdd(token.id, segmentIndex + 1, {
          longitude: event.lngLat.lng,
          latitude: event.lngLat.lat,
        })
      })
      this.map.on('mouseenter', TRAJECTORY_HIT_LAYER_ID, () => {
        this.map.getCanvas().style.cursor = 'crosshair'
      })
      this.map.on('mouseleave', TRAJECTORY_HIT_LAYER_ID, () => {
        this.map.getCanvas().style.cursor = ''
      })
      this.trajectoryInteractionsBound = true
    }
    this.renderTargetRoute()
    this.renderTrajectories()
  }

  private initializeLowZoomRoadLayer(): void {
    const style = this.map.getStyle()
    const roadSourceId = this.findRoadSourceId()
    if (
      typeof roadSourceId !== 'string' ||
      !this.map.getSource(roadSourceId) ||
      this.map.getLayer(LOW_ZOOM_ROAD_LAYER_ID)
    ) {
      return
    }

    const firstSymbolLayerId = style.layers.find((layer) => layer.type === 'symbol')?.id
    const isDarkTheme = this.mapTheme === 'dark'
    this.map.addLayer({
      id: LOW_ZOOM_ROAD_LAYER_ID,
      type: 'line',
      source: roadSourceId,
      'source-layer': 'transportation',
      minzoom: MIN_MAP_ZOOM,
      maxzoom: 6,
      filter: [
        'all',
        ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true],
        ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false],
        ['!=', ['get', 'ramp'], 1],
      ],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': [
          'match',
          ['get', 'class'],
          'motorway',
          isDarkTheme ? '#b69a68' : '#d98254',
          isDarkTheme ? '#8492aa' : '#dda16e',
        ],
        'line-opacity': isDarkTheme ? 0.68 : 0.8,
        'line-width': [
          'interpolate',
          ['exponential', 1.2],
          ['zoom'],
          MIN_MAP_ZOOM,
          isDarkTheme ? 0.65 : 0.4,
          3,
          isDarkTheme ? 0.85 : 0.5,
          4,
          isDarkTheme ? 1.15 : 0.6,
          5,
          isDarkTheme ? 1.65 : 1.2,
        ],
      },
    }, firstSymbolLayerId)
  }

  private configureVectorTiles(): void {
    const roadSourceId = this.findRoadSourceId()
    if (!roadSourceId) {
      return
    }

    const source = this.map.getSource(roadSourceId)
    if (!source || source.type !== 'vector') {
      return
    }

    const vectorSource = source as VectorTileSource
    const tileJsonUrl = vectorSource.url
    if (!tileJsonUrl) {
      return
    }

    const requestVersion = ++this.vectorTileRequestVersion
    void fetch(tileJsonUrl, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(response.statusText)))
      .then((tileJson: unknown) => {
        if (!isTileJson(tileJson) || requestVersion !== this.vectorTileRequestVersion) {
          return
        }

        const currentSource = this.map.getSource(roadSourceId)
        if (currentSource !== vectorSource) {
          return
        }

        vectorSource.setTiles(tileJson.tiles.map((url) => appendRequestVersion(url, requestVersion)))
      })
      .catch(() => undefined)
  }

  private findRoadSourceId(): string | undefined {
    return this.map.getStyle().layers
      .map((layer) => layer as unknown as Record<string, unknown>)
      .find((layer) => (
        layer['source-layer'] === ROAD_SOURCE_LAYER &&
        typeof layer.source === 'string'
      ))?.source as string | undefined
  }

  private renderTargetRoute(): void {
    if (!this.isStyleReady) {
      return
    }

    const source = this.map.getSource(TARGET_ROUTE_SOURCE_ID) as GeoJSONSource | undefined
    if (!source) {
      return
    }

    source.setData({
      type: 'FeatureCollection',
      features:
        this.targetRoute.length >= 2
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: this.targetRoute.map((point) => [point.longitude, point.latitude]),
                },
              },
            ]
          : [],
    })
  }

  private renderTrajectories(): void {
    this.removeStaleTrajectoryMarkers()

    if (!this.isStyleReady) {
      return
    }

    const token = this.latestTokens.find((candidate) => candidate.id === this.trajectoryTokenId)
    const source = this.map.getSource(TRAJECTORY_SOURCE_ID) as GeoJSONSource | undefined
    if (!source) {
      this.removeTrajectoryMarkers()
      return
    }

    if (!token) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      })
      this.removeTrajectoryMarkers()
      return
    }

    this.updateTrajectorySource(source, token)

    const pointIds = new Set(token.trajectory.map((point) => point.id))
    for (const [pointId, marker] of this.trajectoryMarkers) {
      if (!pointIds.has(pointId)) {
        marker.remove()
        this.trajectoryMarkers.delete(pointId)
      }
    }

    for (const point of token.trajectory) {
      const marker = this.trajectoryMarkers.get(point.id)
      if (marker) {
        marker.setLngLat([point.longitude, point.latitude])
        this.updateTrajectoryMarkerElement(marker.getElement(), token, point.id)
        continue
      }

      this.trajectoryMarkers.set(point.id, this.createTrajectoryMarker(token, point.id, point))
    }
  }

  private createTrajectoryMarker(token: Token, pointId: string, point: Coordinates): Marker {
    const element = document.createElement('button')
    let didDrag = false
    element.type = 'button'
    element.className = 'trajectory-point-marker'
    element.innerHTML = '<span aria-hidden="true"></span>'
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      if (didDrag) {
        didDrag = false
        return
      }

      this.callbacks.onTrajectoryPointRemove(token.id, pointId)
    })

    const marker = new Marker({ element, anchor: 'center', draggable: true })
      .setLngLat([point.longitude, point.latitude])
      .addTo(this.map)

    marker.on('dragstart', () => {
      didDrag = true
    })
    marker.on('drag', () => {
      const coordinates = marker.getLngLat()
      this.draggingTrajectoryPoints.set(pointId, {
        longitude: coordinates.lng,
        latitude: coordinates.lat,
      })

      const currentToken = this.latestTokens.find((candidate) => candidate.id === token.id)
      const source = this.map.getSource(TRAJECTORY_SOURCE_ID) as GeoJSONSource | undefined
      if (currentToken && source) {
        this.updateTrajectorySource(source, currentToken)
      }
    })
    marker.on('dragend', () => {
      const coordinates = marker.getLngLat()
      this.callbacks.onTrajectoryPointMove(token.id, pointId, {
        longitude: coordinates.lng,
        latitude: coordinates.lat,
      })
      this.draggingTrajectoryPoints.delete(pointId)
      window.setTimeout(() => {
        didDrag = false
      }, 0)
    })

    this.updateTrajectoryMarkerElement(element, token, pointId)
    return marker
  }

  private updateTrajectoryMarkerElement(element: HTMLElement, token: Token, pointId: string): void {
    element.style.setProperty('--trajectory-color', token.color)
    element.setAttribute('aria-label', `Delete trajectory point from ${token.name}`)
    element.title = `Delete trajectory point. Drag to reposition. (${pointId.slice(0, 8)})`
  }

  private removeStaleTrajectoryMarkers(): void {
    const token = this.latestTokens.find((candidate) => candidate.id === this.trajectoryTokenId)
    const pointIds = new Set(token?.trajectory.map((point) => point.id) ?? [])

    for (const [pointId, marker] of this.trajectoryMarkers) {
      if (!pointIds.has(pointId)) {
        marker.remove()
        this.trajectoryMarkers.delete(pointId)
      }
    }
  }

  private removeTrajectoryMarkers(): void {
    for (const marker of this.trajectoryMarkers.values()) {
      marker.remove()
    }
    this.trajectoryMarkers.clear()
  }

  private updateTrajectorySource(source: GeoJSONSource, token: Token): void {
    const path = [
      ...token.trajectory.map((point) => this.draggingTrajectoryPoints.get(point.id) ?? point),
      token,
    ]
    source.setData({
      type: 'FeatureCollection',
      features:
        path.length >= 2
          ? [
              {
                type: 'Feature',
                properties: { color: token.color },
                geometry: {
                  type: 'LineString',
                  coordinates: path.map((point) => [point.longitude, point.latitude]),
                },
              },
            ]
          : [],
    })
  }

  private findClosestTrajectorySegment(
    path: readonly Coordinates[],
    clickPoint: { x: number; y: number },
  ): number | null {
    let closestSegmentIndex: number | null = null
    let closestDistance = Number.POSITIVE_INFINITY
    const worldWidth = this.getWorldWidth()

    for (let index = 0; index < path.length - 1; index += 1) {
      const start = this.map.project([path[index].longitude, path[index].latitude])
      const end = this.map.project([path[index + 1].longitude, path[index + 1].latitude])
      const adjustedStart = adjustForWorldCopy(start, clickPoint, worldWidth)
      const adjustedEnd = adjustForWorldCopy(end, clickPoint, worldWidth)
      const distance = distanceToSegment(clickPoint, adjustedStart, adjustedEnd)

      if (distance < closestDistance) {
        closestDistance = distance
        closestSegmentIndex = index
      }
    }

    return closestSegmentIndex
  }

  private getWorldWidth(): number {
    const left = this.map.project([-180, 0]).x
    const right = this.map.project([180, 0]).x
    return Math.abs(right - left)
  }

  private isTrajectoryLineAtPoint(point: { x: number; y: number }): boolean {
    if (!this.isStyleReady || !this.map.getLayer(TRAJECTORY_HIT_LAYER_ID)) {
      return false
    }

    return this.map.queryRenderedFeatures([point.x, point.y], { layers: [TRAJECTORY_HIT_LAYER_ID] }).length > 0
  }

  private createMarker(token: Token, isSelected: boolean): Marker {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'token-marker'
    element.innerHTML = `
      <span class="token-marker__label" data-role="token-label"></span>
      <span class="token-marker__pin" aria-hidden="true"><span></span></span>
    `
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      this.callbacks.onTokenSelect(token.id)
    })

    this.updateMarkerElement(element, token, isSelected)

    const marker = new Marker({
      element,
      anchor: 'bottom',
      draggable: token.type !== TokenType.Eliminated,
    })
      .setLngLat([token.longitude, token.latitude])
      .addTo(this.map)

    marker.on('dragend', () => {
      const coordinates = marker.getLngLat()
      this.callbacks.onTokenMove(token.id, {
        longitude: coordinates.lng,
        latitude: coordinates.lat,
      })
    })

    return marker
  }

  private updateMarkerElement(element: HTMLElement, token: Token, isSelected: boolean): void {
    const label = element.querySelector<HTMLElement>('[data-role="token-label"]')
    if (label) {
      label.textContent = token.name
    }

    element.style.setProperty('--token-color', token.color)
    element.classList.toggle('is-selected', isSelected)
    element.setAttribute('aria-label', `${token.name} token`)
    element.setAttribute('aria-pressed', String(isSelected))
    element.title = token.type === TokenType.Eliminated
      ? `${token.name} token. Eliminated tokens cannot move.`
      : `${token.name} token. Drag to move.`
  }
}

function adjustForWorldCopy(
  point: { x: number; y: number },
  target: { x: number; y: number },
  worldWidth: number,
): { x: number; y: number } {
  if (!Number.isFinite(worldWidth) || worldWidth === 0) {
    return point
  }

  return {
    x: point.x + Math.round((target.x - point.x) / worldWidth) * worldWidth,
    y: point.y,
  }
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared),
  )
  const closestX = start.x + projection * deltaX
  const closestY = start.y + projection * deltaY
  return Math.hypot(point.x - closestX, point.y - closestY)
}

export function clearStoredMapView(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(MAP_VIEW_STORAGE_KEY)
  } catch {
    // Browser storage can be unavailable in restricted contexts.
  }
}

function readMapView(): MapViewState {
  if (typeof window === 'undefined') {
    return DEFAULT_MAP_VIEW
  }

  try {
    const serialized = window.localStorage.getItem(MAP_VIEW_STORAGE_KEY)
    if (!serialized) {
      return DEFAULT_MAP_VIEW
    }

    const parsed: unknown = JSON.parse(serialized)
    if (!isStoredMapView(parsed)) {
      return DEFAULT_MAP_VIEW
    }

    return {
      longitude: normalizeLongitude(parsed.longitude),
      latitude: parsed.latitude,
      zoom: parsed.zoom,
    }
  } catch {
    return DEFAULT_MAP_VIEW
  }
}

function saveMapView(map: MapLibreMap): void {
  if (typeof window === 'undefined') {
    return
  }

  const center = map.getCenter()
  const mapView = {
    version: MAP_VIEW_STORAGE_VERSION,
    longitude: normalizeLongitude(center.lng),
    latitude: center.lat,
    zoom: map.getZoom(),
  }

  try {
    window.localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify(mapView))
  } catch {
    // Browser storage can be unavailable in restricted contexts.
  }
}

function isStoredMapView(value: unknown): value is MapViewState & { version: number } {
  if (!isRecord(value) || value.version !== MAP_VIEW_STORAGE_VERSION) {
    return false
  }

  return (
    typeof value.longitude === 'number' &&
    typeof value.latitude === 'number' &&
    typeof value.zoom === 'number' &&
    Number.isFinite(value.longitude) &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.zoom) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.zoom >= MIN_MAP_ZOOM &&
    value.zoom <= MAX_MAP_ZOOM
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTileJson(value: unknown): value is { tiles: string[] } {
  return isRecord(value) && Array.isArray(value.tiles) && value.tiles.every((tile) => typeof tile === 'string')
}

function appendRequestVersion(url: string, version: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}map-request=${version}`
}

function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180
}
