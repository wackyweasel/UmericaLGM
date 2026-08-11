import { TokenType, type Coordinates, type Token } from './token-store'

const ROUTING_SERVICE_URL = 'https://router.project-osrm.org/route/v1/driving'
const EARTH_RADIUS_KILOMETERS = 6371
const MIN_ADVANCE_DISTANCE_FACTOR = 0.1
const TARGET_STOP_DISTANCE_KILOMETERS = 10
const COLLISION_MUTUAL_SURVIVAL_PROBABILITY = 0.5

type AdvanceToken = Pick<
  Token,
  'id' | 'type' | 'targetTokenId' | 'speed' | 'longitude' | 'latitude'
>

interface OsrmRouteResponse {
  code: string
  routes?: Array<{
    geometry?: {
      coordinates?: unknown
    }
  }>
}

export async function fetchTargetRoute(
  start: Coordinates,
  end: Coordinates,
  signal?: AbortSignal,
): Promise<Coordinates[]> {
  const url = `${ROUTING_SERVICE_URL}/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson&steps=false`
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Routing service returned ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (!isOsrmRouteResponse(payload) || payload.code !== 'Ok') {
    throw new Error('No road route is available for this target')
  }

  const coordinates = payload.routes?.[0]?.geometry?.coordinates
  if (!Array.isArray(coordinates)) {
    throw new Error('Routing service returned no route geometry')
  }

  const route = coordinates.map(readRouteCoordinate)
  if (route.length < 2) {
    throw new Error('Routing service returned an incomplete route')
  }

  return route
}

export interface RouteAdvanceResult {
  coordinates: Coordinates
  distanceTravelledKilometers: number
  reachedTarget: boolean
}

export function shouldAdvance(random = Math.random): boolean {
  return random() < 0.75
}

export function getRandomAdvanceDistance(speed: number, random = Math.random): number {
  return speed * (MIN_ADVANCE_DISTANCE_FACTOR + random() * (1 - MIN_ADVANCE_DISTANCE_FACTOR))
}

export function getTargetRouteKey(
  sourceToken: Pick<Token, 'id' | 'longitude' | 'latitude'>,
  targetToken: Pick<Token, 'id' | 'longitude' | 'latitude'>,
): string {
  return [
    sourceToken.id,
    sourceToken.longitude,
    sourceToken.latitude,
    targetToken.id,
    targetToken.longitude,
    targetToken.latitude,
  ].join(':')
}

export interface SimultaneousAdvancePlan {
  tokenId: string
  targetTokenId: string
  coordinates: Coordinates
  distanceTravelledKilometers: number
  reachedTarget: boolean
  encounterTokenIds: readonly string[]
  collisionTokenIds: readonly string[]
}

export interface TeamCollisionResolution {
  winnerIds: string[]
  loserIds: string[]
  retargetIds: string[]
  eliminations: TeamElimination[]
}

export interface TeamElimination {
  winnerId: string
  loserIds: string[]
}

export function resolveTeamCollisionOutcomes(
  plans: readonly SimultaneousAdvancePlan[],
  tokens: readonly Pick<Token, 'id' | 'type'>[],
  random = Math.random,
): TeamCollisionResolution {
  const tokenById = new Map(tokens.map((token) => [token.id, token]))
  const collisionNeighbors = new Map<string, Set<string>>()

  for (const plan of plans) {
    const sourceToken = tokenById.get(plan.tokenId)
    if (sourceToken?.type !== TokenType.Team) {
      continue
    }

    for (const collisionTokenId of plan.collisionTokenIds) {
      const targetToken = tokenById.get(collisionTokenId)
      if (targetToken?.type !== TokenType.Team || targetToken.id === sourceToken.id) {
        continue
      }

      const sourceNeighbors = collisionNeighbors.get(sourceToken.id) ?? new Set<string>()
      sourceNeighbors.add(targetToken.id)
      collisionNeighbors.set(sourceToken.id, sourceNeighbors)

      const targetNeighbors = collisionNeighbors.get(targetToken.id) ?? new Set<string>()
      targetNeighbors.add(sourceToken.id)
      collisionNeighbors.set(targetToken.id, targetNeighbors)
    }
  }

  const visited = new Set<string>()
  const winnerIds: string[] = []
  const loserIds: string[] = []
  const retargetIds: string[] = []
  const eliminations: TeamElimination[] = []
  for (const teamId of collisionNeighbors.keys()) {
    if (visited.has(teamId)) {
      continue
    }

    const component: string[] = []
    const pending = [teamId]
    visited.add(teamId)
    while (pending.length > 0) {
      const currentTeamId = pending.pop()!
      component.push(currentTeamId)
      for (const neighborId of collisionNeighbors.get(currentTeamId) ?? []) {
        if (visited.has(neighborId)) {
          continue
        }

        visited.add(neighborId)
        pending.push(neighborId)
      }
    }

    if (random() < COLLISION_MUTUAL_SURVIVAL_PROBABILITY) {
      retargetIds.push(...component)
      continue
    }

    const winnerIndex = Math.min(component.length - 1, Math.floor(random() * component.length))
    const winnerId = component[winnerIndex]!
    const componentLoserIds = component.filter((candidateId) => candidateId !== winnerId)
    winnerIds.push(winnerId)
    loserIds.push(...componentLoserIds)
    retargetIds.push(winnerId)
    eliminations.push({ winnerId, loserIds: componentLoserIds })
  }

  return { winnerIds, loserIds, retargetIds, eliminations }
}

interface AdvanceCandidate {
  tokenId: string
  targetTokenId: string
  motion: RouteMotion
  requestedDistanceKilometers: number
  stopTime: number | null
  encounterTokenIds: Set<string>
  collisionTokenIds: Set<string>
}

interface RouteMotion {
  route: readonly Coordinates[]
  cumulativeDistances: readonly number[]
  totalDistanceKilometers: number
}

export function resolveSimultaneousAdvances(
  tokens: readonly AdvanceToken[],
  routes: ReadonlyMap<string, readonly Coordinates[]>,
  random = Math.random,
  advancingTokenIds?: ReadonlySet<string>,
  advanceDistances?: ReadonlyMap<string, number>,
): SimultaneousAdvancePlan[] {
  const tokenById = new Map(tokens.map((token) => [token.id, token]))
  const candidates: AdvanceCandidate[] = []

  for (const token of tokens) {
    if (token.type !== TokenType.Team || !token.targetTokenId) {
      continue
    }

    const targetToken = tokenById.get(token.targetTokenId)
    if (!targetToken) {
      continue
    }

    const isAdvancing = advancingTokenIds
      ? advancingTokenIds.has(token.id)
      : shouldAdvance(random)
    if (!isAdvancing) {
      continue
    }

    const route = routes.get(getTargetRouteKey(token, targetToken))
    if (!route) {
      continue
    }

    const requestedDistanceKilometers = advanceDistances?.get(token.id)
      ?? getRandomAdvanceDistance(token.speed, random)
    const motion = createRouteMotion(route)
    const advance = advanceAlongMotion(motion, requestedDistanceKilometers)
    const isImmediateTeamContact =
      targetToken.type === TokenType.Team &&
      greatCircleDistance(token, targetToken) <= TARGET_STOP_DISTANCE_KILOMETERS
    if (
      advance.coordinates.longitude === token.longitude &&
      advance.coordinates.latitude === token.latitude &&
      !isImmediateTeamContact
    ) {
      continue
    }

    candidates.push({
      tokenId: token.id,
      targetTokenId: targetToken.id,
      motion,
      requestedDistanceKilometers,
      stopTime: null,
      encounterTokenIds: new Set(),
      collisionTokenIds: new Set(),
    })
  }

  resolveStopCollisions(tokenById, candidates)

  return candidates.map((candidate) => {
    const advance = advanceAlongMotion(
      candidate.motion,
      candidate.requestedDistanceKilometers * (candidate.stopTime ?? 1),
    )
    return {
      tokenId: candidate.tokenId,
      targetTokenId: candidate.targetTokenId,
      coordinates: advance.coordinates,
      distanceTravelledKilometers: advance.distanceTravelledKilometers,
      reachedTarget: advance.reachedTarget,
      encounterTokenIds: [...candidate.encounterTokenIds],
      collisionTokenIds: [...candidate.collisionTokenIds],
    }
  })
}

function resolveStopCollisions(
  tokenById: ReadonlyMap<string, AdvanceToken>,
  candidates: AdvanceCandidate[],
): void {
  const candidateById = new Map(candidates.map((candidate) => [candidate.tokenId, candidate]))
  const activeTokens = [...tokenById.values()].filter((token) => token.type !== TokenType.Eliminated)

  while (true) {
    let earliestEncounter: { tokenId: string; otherTokenId: string; time: number } | null = null

    for (const candidate of candidates) {
      if (candidate.stopTime !== null) {
        continue
      }

      const token = tokenById.get(candidate.tokenId)
      if (!token) {
        continue
      }

      for (const otherToken of activeTokens) {
        if (otherToken.id === token.id) {
          continue
        }

        const otherCandidate = candidateById.get(otherToken.id)
        const allowInitialContact =
          otherToken.type === TokenType.Team && token.targetTokenId === otherToken.id
        const encounterTime = findFirstStopTime(
          candidate,
          otherToken,
          otherCandidate,
          allowInitialContact,
        )
        if (
          encounterTime === null ||
          (earliestEncounter !== null && encounterTime >= earliestEncounter.time)
        ) {
          continue
        }

        earliestEncounter = {
          tokenId: candidate.tokenId,
          otherTokenId: otherToken.id,
          time: encounterTime,
        }
      }
    }

    if (!earliestEncounter) {
      return
    }

    const movingCandidate = candidateById.get(earliestEncounter.tokenId)
    if (movingCandidate) {
      movingCandidate.stopTime = earliestEncounter.time
      movingCandidate.encounterTokenIds.add(earliestEncounter.otherTokenId)
    }

    const targetCandidate = candidateById.get(earliestEncounter.otherTokenId)
    const targetToken = tokenById.get(earliestEncounter.otherTokenId)
    if (targetToken?.type === TokenType.Team) {
      movingCandidate?.collisionTokenIds.add(targetToken.id)
      movingCandidate?.encounterTokenIds.add(targetToken.id)
      targetCandidate?.collisionTokenIds.add(earliestEncounter.tokenId)
      targetCandidate?.encounterTokenIds.add(earliestEncounter.tokenId)
    }
    if (targetCandidate && (targetCandidate.stopTime === null || targetCandidate.stopTime > earliestEncounter.time)) {
      targetCandidate.stopTime = earliestEncounter.time
    }
  }
}

function findFirstStopTime(
  movingCandidate: AdvanceCandidate,
  targetToken: AdvanceToken,
  targetCandidate: AdvanceCandidate | undefined,
  allowInitialContact = false,
): number | null {
  const breakpoints = new Set<number>([0, 1])
  addMotionBreakpoints(breakpoints, movingCandidate)
  if (targetCandidate) {
    addMotionBreakpoints(breakpoints, targetCandidate)
  }

  const times = [...breakpoints].sort((left, right) => left - right)
  for (let index = 0; index < times.length - 1; index += 1) {
    const intervalStart = times[index]!
    const intervalEnd = times[index + 1]!
    const movingStart = getCandidatePosition(movingCandidate, intervalStart)
    const movingEnd = getCandidatePosition(movingCandidate, intervalEnd)
    const targetStart = getTargetPosition(targetToken, targetCandidate, intervalStart)
    const targetEnd = getTargetPosition(targetToken, targetCandidate, intervalEnd)
    const distanceAt = (time: number) =>
      greatCircleDistance(
        getCandidatePosition(movingCandidate, time),
        getTargetPosition(targetToken, targetCandidate, time),
      )

    const distanceAtStart = distanceAt(intervalStart)
    if (distanceAtStart <= TARGET_STOP_DISTANCE_KILOMETERS) {
      if (intervalStart === 0 && allowInitialContact) {
        return 0
      }

      continue
    }

    let closestTime = findClosestTime(
      movingStart,
      movingEnd,
      targetStart,
      targetEnd,
      intervalStart,
      intervalEnd,
    )
    let closestDistance = distanceAt(closestTime)
    if (closestDistance > TARGET_STOP_DISTANCE_KILOMETERS) {
      if (closestDistance > TARGET_STOP_DISTANCE_KILOMETERS * 2) {
        continue
      }

      closestTime = findClosestTimeBySearch(distanceAt, intervalStart, intervalEnd)
      closestDistance = distanceAt(closestTime)
      if (closestDistance > TARGET_STOP_DISTANCE_KILOMETERS) {
        continue
      }
    }

    let lowerTime = intervalStart
    let upperTime = closestTime
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const middleTime = (lowerTime + upperTime) / 2
      if (distanceAt(middleTime) <= TARGET_STOP_DISTANCE_KILOMETERS) {
        upperTime = middleTime
      } else {
        lowerTime = middleTime
      }
    }
    return upperTime
  }

  return null
}

function addMotionBreakpoints(breakpoints: Set<number>, candidate: AdvanceCandidate): void {
  if (candidate.stopTime !== null && candidate.stopTime > 0 && candidate.stopTime < 1) {
    breakpoints.add(candidate.stopTime)
  }

  if (candidate.requestedDistanceKilometers <= 0) {
    return
  }

  for (const routeDistance of candidate.motion.cumulativeDistances) {
    const time = routeDistance / candidate.requestedDistanceKilometers
    if (time > 0 && time < 1) {
      breakpoints.add(time)
    }
    if (time >= 1) {
      break
    }
  }
}

function getCandidatePosition(candidate: AdvanceCandidate, time: number): Coordinates {
  const movementTime = candidate.stopTime === null ? time : Math.min(time, candidate.stopTime)
  return getRoutePosition(
    candidate.motion,
    candidate.requestedDistanceKilometers * movementTime,
  )
}

function getTargetPosition(
  targetToken: AdvanceToken,
  targetCandidate: AdvanceCandidate | undefined,
  time: number,
): Coordinates {
  return targetCandidate ? getCandidatePosition(targetCandidate, time) : targetToken
}

function findClosestTime(
  movingStart: Coordinates,
  movingEnd: Coordinates,
  targetStart: Coordinates,
  targetEnd: Coordinates,
  startTime: number,
  endTime: number,
): number {
  const latitudeScale = Math.cos(toRadians((movingStart.latitude + targetStart.latitude) / 2))
  const relativeStart = {
    longitude: (movingStart.longitude - targetStart.longitude) * latitudeScale,
    latitude: movingStart.latitude - targetStart.latitude,
  }
  const relativeVelocity = {
    longitude:
      ((movingEnd.longitude - movingStart.longitude) -
        (targetEnd.longitude - targetStart.longitude)) * latitudeScale,
    latitude:
      (movingEnd.latitude - movingStart.latitude) -
      (targetEnd.latitude - targetStart.latitude),
  }
  const velocitySquared =
    relativeVelocity.longitude ** 2 + relativeVelocity.latitude ** 2
  const fraction =
    velocitySquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            -(
              relativeStart.longitude * relativeVelocity.longitude +
              relativeStart.latitude * relativeVelocity.latitude
            ) / velocitySquared,
          ),
        )
  return startTime + (endTime - startTime) * fraction
}

function findClosestTimeBySearch(
  distanceAt: (time: number) => number,
  startTime: number,
  endTime: number,
): number {
  let lowerTime = startTime
  let upperTime = endTime
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const leftTime = lowerTime + (upperTime - lowerTime) / 3
    const rightTime = upperTime - (upperTime - lowerTime) / 3
    if (distanceAt(leftTime) <= distanceAt(rightTime)) {
      upperTime = rightTime
    } else {
      lowerTime = leftTime
    }
  }

  const middleTime = (lowerTime + upperTime) / 2
  const candidates = [startTime, middleTime, endTime]
  return candidates.reduce((closestTime, time) =>
    distanceAt(time) < distanceAt(closestTime) ? time : closestTime,
  )
}

export function advanceAlongRoute(
  route: readonly Coordinates[],
  distanceKilometers: number,
): RouteAdvanceResult {
  return advanceAlongMotion(createRouteMotion(route), distanceKilometers)
}

function advanceAlongMotion(motion: RouteMotion, distanceKilometers: number): RouteAdvanceResult {
  const { route, totalDistanceKilometers, cumulativeDistances } = motion
  const start = route[0]
  const target = route.at(-1)
  if (!start || !target || route.length < 2 || distanceKilometers <= 0) {
    return {
      coordinates: start ?? target ?? { longitude: 0, latitude: 0 },
      distanceTravelledKilometers: 0,
      reachedTarget: route.length < 2,
    }
  }

  if (distanceKilometers >= totalDistanceKilometers) {
    return {
      coordinates: target,
      distanceTravelledKilometers: totalDistanceKilometers,
      reachedTarget: true,
    }
  }

  const segmentEndIndex = findFirstGreaterDistance(cumulativeDistances, distanceKilometers)
  let segmentIndex = Math.max(0, segmentEndIndex - 1)
  while (
    segmentIndex < route.length - 1 &&
    cumulativeDistances[segmentIndex + 1] === cumulativeDistances[segmentIndex]
  ) {
    segmentIndex += 1
  }

  if (segmentIndex >= route.length - 1) {
    return {
      coordinates: target,
      distanceTravelledKilometers: totalDistanceKilometers,
      reachedTarget: false,
    }
  }

  const segmentStart = route[segmentIndex]!
  const segmentEnd = route[segmentIndex + 1]!
  const segmentStartDistance = cumulativeDistances[segmentIndex]!
  const segmentDistance = cumulativeDistances[segmentIndex + 1]! - segmentStartDistance
  const ratio = (distanceKilometers - segmentStartDistance) / segmentDistance
  return {
    coordinates: {
      longitude: segmentStart.longitude + (segmentEnd.longitude - segmentStart.longitude) * ratio,
      latitude: segmentStart.latitude + (segmentEnd.latitude - segmentStart.latitude) * ratio,
    },
    distanceTravelledKilometers: distanceKilometers,
    reachedTarget: false,
  }
}

function createRouteMotion(route: readonly Coordinates[]): RouteMotion {
  const cumulativeDistances = [0]
  for (let index = 0; index < route.length - 1; index += 1) {
    const previousDistance = cumulativeDistances[index]!
    cumulativeDistances.push(
      previousDistance + greatCircleDistance(route[index]!, route[index + 1]!),
    )
  }

  return {
    route,
    cumulativeDistances,
    totalDistanceKilometers: cumulativeDistances.at(-1) ?? 0,
  }
}

function getRoutePosition(motion: RouteMotion, distanceKilometers: number): Coordinates {
  return advanceAlongMotion(motion, distanceKilometers).coordinates
}

function findFirstGreaterDistance(distances: readonly number[], value: number): number {
  let lowerIndex = 0
  let upperIndex = distances.length
  while (lowerIndex < upperIndex) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2)
    if (distances[middleIndex]! > value) {
      upperIndex = middleIndex
    } else {
      lowerIndex = middleIndex + 1
    }
  }

  return lowerIndex
}

function isOsrmRouteResponse(value: unknown): value is OsrmRouteResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    ('routes' in value ? value.routes === undefined || Array.isArray(value.routes) : true)
  )
}

function readRouteCoordinate(value: unknown): Coordinates {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    value[1] < -90 ||
    value[1] > 90
  ) {
    throw new Error('Routing service returned invalid route geometry')
  }

  return {
    longitude: value[0],
    latitude: value[1],
  }
}

export function greatCircleDistance(left: Coordinates, right: Coordinates): number {
  const latitudeDelta = toRadians(right.latitude - left.latitude)
  const longitudeDelta = toRadians(right.longitude - left.longitude)
  const leftLatitude = toRadians(left.latitude)
  const rightLatitude = toRadians(right.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2

  return EARTH_RADIUS_KILOMETERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}
