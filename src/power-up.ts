import type { CanadianCity } from './canadian-cities'
import { TokenType, type Coordinates, type Token } from './token-store'

const EARTH_RADIUS_KILOMETERS = 6371
const POWER_UP_CANDIDATE_RATIO = 0.1
const POWER_UP_TARGET_RANK = 3
const TEAM_TARGET_LOCK_POWER_UP_COUNT = 3
const POWER_UP_SPAWN_SWITCH_PROBABILITY = 0.5
const RANDOM_TARGET_RESELECTION_PROBABILITY = 0.1
const POWER_UP_USE_PROBABILITY = 0.1

export type TargetSelectionToken = Pick<Token, 'id' | 'name' | 'longitude' | 'latitude'> & {
  type?: Token['type']
  powerUps?: readonly string[]
}

export function selectTeamsForPowerUpRetarget(
  powerUp: TargetSelectionToken,
  teams: readonly TargetSelectionToken[],
  tokens: readonly TargetSelectionToken[],
  random = Math.random,
): TargetSelectionToken[] {
  return teams.filter((team) => (
    team.type === TokenType.Team &&
    isTargetWithinRank(team, powerUp.id, tokens, POWER_UP_TARGET_RANK) &&
    random() < POWER_UP_SPAWN_SWITCH_PROBABILITY
  ))
}

export function shouldReselectTarget(random = Math.random): boolean {
  return random() < RANDOM_TARGET_RESELECTION_PROBABILITY
}

export function shouldUsePowerUp(random = Math.random): boolean {
  return random() < POWER_UP_USE_PROBABILITY
}

export function hasNearbyTeamWithinSpeed(
  sourceTeam: Pick<Token, 'id' | 'longitude' | 'latitude' | 'speed'>,
  tokens: readonly Pick<Token, 'id' | 'longitude' | 'latitude' | 'type'>[],
): boolean {
  return tokens.some((token) => (
    token.id !== sourceTeam.id &&
    token.type === TokenType.Team &&
    greatCircleDistance(sourceTeam, token) <= sourceTeam.speed
  ))
}

export function getClosestPowerUpTarget(
  sourceToken: TargetSelectionToken,
  tokens: readonly TargetSelectionToken[],
): TargetSelectionToken | undefined {
  return rankTargetTokens(sourceToken, tokens)
    .find(({ token }) => token.type === TokenType.PowerUp)?.token
}

export function isTargetWithinRank(
  sourceToken: TargetSelectionToken,
  targetTokenId: string,
  tokens: readonly TargetSelectionToken[],
  rank: number,
): boolean {
  return rankTargetTokens(sourceToken, tokens)
    .slice(0, rank)
    .some(({ token }) => token.id === targetTokenId)
}

export function selectPowerUpCity(
  cities: readonly CanadianCity[],
  tokens: readonly Coordinates[],
  random = Math.random,
): CanadianCity | undefined {
  if (cities.length === 0) {
    return undefined
  }

  if (tokens.length === 0) {
    return cities[Math.floor(random() * cities.length)]
  }

  const rankedCities = cities
    .map((city) => ({
      city,
      nearestTokenDistance: tokens.reduce(
        (nearestDistance, token) =>
          Math.min(nearestDistance, greatCircleDistance(city, token)),
        Number.POSITIVE_INFINITY,
      ),
    }))
    .sort((left, right) => right.nearestTokenDistance - left.nearestTokenDistance)
  const candidateCount = Math.max(1, Math.ceil(rankedCities.length * POWER_UP_CANDIDATE_RATIO))
  const farthestCities = rankedCities.slice(0, candidateCount)

  return farthestCities[Math.floor(random() * farthestCities.length)]?.city
}

export function getNextPowerUpName(tokens: readonly { name: string }[]): string {
  const usedNames = new Set(tokens.map((token) => token.name))
  let number = 1

  while (usedNames.has(`Power Up ${number}`)) {
    number += 1
  }

  return `Power Up ${number}`
}

export function selectTargetToken(
  sourceToken: TargetSelectionToken,
  tokens: readonly TargetSelectionToken[],
  random = Math.random,
): TargetSelectionToken | undefined {
  const rankedTokens = rankTargetTokens(sourceToken, tokens)
  const eligibleRankedTokens = (sourceToken.powerUps?.length ?? 0) >= TEAM_TARGET_LOCK_POWER_UP_COUNT
    ? rankedTokens.filter(({ token }) => token.type === TokenType.Team)
    : rankedTokens
  if (eligibleRankedTokens.length === 0) {
    return undefined
  }

  const selection = random()
  let cumulativeProbability = 0
  for (const [index, rankedToken] of eligibleRankedTokens.entries()) {
    cumulativeProbability += 0.5 ** (index + 1)
    if (selection < cumulativeProbability) {
      return rankedToken.token
    }
  }

  return eligibleRankedTokens[0]!.token
}

function rankTargetTokens(
  sourceToken: TargetSelectionToken,
  tokens: readonly TargetSelectionToken[],
): { token: TargetSelectionToken; distance: number }[] {
  return tokens
    .filter((token) => token.id !== sourceToken.id && token.type !== TokenType.Eliminated)
    .map((token) => ({
      token,
      distance: greatCircleDistance(sourceToken, token),
    }))
    .sort((left, right) => left.distance - right.distance)
}

function greatCircleDistance(left: Coordinates, right: Coordinates): number {
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