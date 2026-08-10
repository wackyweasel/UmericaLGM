import { describe, expect, it } from 'vitest'
import {
  getClosestPowerUpTarget,
  getNextPowerUpName,
  hasNearbyTeamWithinSpeed,
  isTargetWithinRank,
  selectPowerUpCity,
  selectTeamsForPowerUpRetarget,
  selectTargetToken,
  shouldReselectTarget,
  shouldUsePowerUp,
} from './power-up'
import type { CanadianCity } from './canadian-cities'
import { TokenType } from './token-store'

const testCities: readonly CanadianCity[] = [
  { geonameId: 1, name: 'Origin', latitude: 0, longitude: 0, population: 10000, featureCode: 'PPL' },
  { geonameId: 2, name: 'Middle', latitude: 0, longitude: 20, population: 10000, featureCode: 'PPL' },
  { geonameId: 3, name: 'Far', latitude: 0, longitude: 80, population: 10000, featureCode: 'PPL' },
]

describe('Power Up city selection', () => {
  it('chooses the city farthest from the nearest existing token', () => {
    const selectedCity = selectPowerUpCity(testCities, [{ latitude: 0, longitude: 0 }])

    expect(selectedCity?.name).toBe('Far')
  })

  it('chooses randomly within the farthest group', () => {
    const cities = Array.from({ length: 20 }, (_, index) => ({
      geonameId: index + 1,
      name: `City ${index}`,
      latitude: 0,
      longitude: index + 1,
      population: 10000,
      featureCode: 'PPL',
    }))
    const selectedCity = selectPowerUpCity(cities, [{ latitude: 0, longitude: 0 }], () => 0.99)

    expect(selectedCity?.name).toBe('City 18')
  })

  it('uses the random fallback when there are no existing tokens', () => {
    const selectedCity = selectPowerUpCity(testCities, [], () => 0)

    expect(selectedCity?.name).toBe('Origin')
  })

  it('names a Power Up with the lowest available integer', () => {
    expect(
      getNextPowerUpName([
        { name: 'Power Up 1' },
        { name: 'Team marker' },
        { name: 'Power Up 3' },
      ]),
    ).toBe('Power Up 2')
    expect(getNextPowerUpName([])).toBe('Power Up 1')
  })

  it('selects targets by descending geometric probability from closest to farthest', () => {
    const tokens = [
      { id: 'source', name: 'Source', longitude: 0, latitude: 0 },
      { id: 'closest', name: 'Closest', longitude: 1, latitude: 0 },
      { id: 'second', name: 'Second', longitude: 2, latitude: 0 },
      { id: 'third', name: 'Third', longitude: 3, latitude: 0 },
    ]

    expect(selectTargetToken(tokens[0]!, tokens, () => 0.49)?.id).toBe('closest')
    expect(selectTargetToken(tokens[0]!, tokens, () => 0.5)?.id).toBe('second')
    expect(selectTargetToken(tokens[0]!, tokens, () => 0.75)?.id).toBe('third')
    expect(selectTargetToken(tokens[0]!, tokens, () => 0.99)?.id).toBe('closest')
  })

  it('restricts random target selection to other Teams at three Power Ups', () => {
    const source = {
      id: 'source',
      name: 'Source',
      longitude: 0,
      latitude: 0,
      type: TokenType.Team,
      powerUps: ['One', 'Two', 'Three'],
    }
    const player = { id: 'player', name: 'Player', longitude: 1, latitude: 0, type: TokenType.Player }
    const powerUp = { id: 'power-up', name: 'Power Up', longitude: 2, latitude: 0, type: TokenType.PowerUp }
    const otherTeam = { id: 'other-team', name: 'Other Team', longitude: 3, latitude: 0, type: TokenType.Team }

    expect(selectTargetToken(source, [source, player, powerUp, otherTeam], () => 0)?.id).toBe(otherTeam.id)
    expect(selectTargetToken({ ...source, powerUps: ['One', 'Two'] }, [source, player, powerUp, otherTeam], () => 0)?.id)
      .toBe(player.id)
  })

  it('returns no random target when a Team with three Power Ups has no other Team', () => {
    const source = {
      id: 'source',
      name: 'Source',
      longitude: 0,
      latitude: 0,
      type: TokenType.Team,
      powerUps: ['One', 'Two', 'Three'],
    }
    const player = { id: 'player', name: 'Player', longitude: 1, latitude: 0, type: TokenType.Player }

    expect(selectTargetToken(source, [source, player], () => 0)).toBeUndefined()
  })

  it('never selects an Eliminated token as a target', () => {
    const source = { id: 'source', name: 'Source', longitude: 0, latitude: 0 }
    const eliminated = {
      id: 'eliminated',
      name: 'Eliminated',
      longitude: 1,
      latitude: 0,
      type: TokenType.Eliminated,
    }
    const player = {
      id: 'player',
      name: 'Player',
      longitude: 2,
      latitude: 0,
      type: TokenType.Player,
    }

    expect(selectTargetToken(source, [source, eliminated, player], () => 0)).toMatchObject({
      id: player.id,
    })
  })

  it('finds the closest Power Up and checks rank among eligible targets', () => {
    const source = { id: 'source', name: 'Source', longitude: 0, latitude: 0, type: TokenType.Team }
    const nearestTeam = { id: 'team', name: 'Team', longitude: 1, latitude: 0, type: TokenType.Team }
    const nearestPlayer = { id: 'player', name: 'Player', longitude: 2, latitude: 0, type: TokenType.Player }
    const anotherToken = { id: 'another', name: 'Another', longitude: 2.5, latitude: 0, type: TokenType.Team }
    const closestPowerUp = {
      id: 'closest-power-up',
      name: 'Closest Power Up',
      longitude: 3,
      latitude: 0,
      type: TokenType.PowerUp,
    }
    const fartherPowerUp = {
      id: 'farther-power-up',
      name: 'Farther Power Up',
      longitude: 4,
      latitude: 0,
      type: TokenType.PowerUp,
    }
    const tokens = [source, nearestTeam, nearestPlayer, anotherToken, closestPowerUp, fartherPowerUp]

    expect(getClosestPowerUpTarget(source, tokens)?.id).toBe(closestPowerUp.id)
    expect(isTargetWithinRank(source, closestPowerUp.id, tokens, 3)).toBe(false)
    expect(isTargetWithinRank(source, closestPowerUp.id, tokens, 4)).toBe(true)
  })

  it('selects only eligible Teams for the spawned Power Up switch', () => {
    const powerUp = {
      id: 'new-power-up',
      name: 'New Power Up',
      longitude: 3,
      latitude: 0,
      type: TokenType.PowerUp,
    }
    const eligibleTeam = { id: 'eligible', name: 'Eligible', longitude: 0, latitude: 0, type: TokenType.Team }
    const ineligibleTeam = { id: 'ineligible', name: 'Ineligible', longitude: -10, latitude: 0, type: TokenType.Team }
    const nearbyTeamOne = { id: 'nearby-one', name: 'Nearby One', longitude: -9, latitude: 0, type: TokenType.Team }
    const nearbyTeamTwo = { id: 'nearby-two', name: 'Nearby Two', longitude: -8, latitude: 0, type: TokenType.Team }
    const player = { id: 'player', name: 'Player', longitude: 1, latitude: 0, type: TokenType.Player }
    const tokens = [eligibleTeam, player, powerUp, ineligibleTeam, nearbyTeamOne, nearbyTeamTwo]

    expect(selectTeamsForPowerUpRetarget(powerUp, [eligibleTeam, ineligibleTeam], tokens, () => 0.49))
      .toEqual([eligibleTeam])
    expect(selectTeamsForPowerUpRetarget(powerUp, [eligibleTeam], tokens, () => 0.5)).toEqual([])
  })

  it('uses the fixed 10% target-reselection chance', () => {
    expect(shouldReselectTarget(() => 0.09)).toBe(true)
    expect(shouldReselectTarget(() => 0.1)).toBe(false)
  })

  it('uses the fixed 10% Power Up usage chance', () => {
    expect(shouldUsePowerUp(() => 0.09)).toBe(true)
    expect(shouldUsePowerUp(() => 0.1)).toBe(false)
  })

  it('finds another Team within the source Team speed radius', () => {
    const sourceTeam = {
      id: 'source',
      longitude: 0,
      latitude: 0,
      speed: 250,
      type: TokenType.Team,
    }
    const nearbyTeam = {
      id: 'nearby',
      longitude: 2,
      latitude: 0,
      type: TokenType.Team,
    }
    const farTeam = {
      id: 'far',
      longitude: 3,
      latitude: 0,
      type: TokenType.Team,
    }

    expect(hasNearbyTeamWithinSpeed(sourceTeam, [sourceTeam, nearbyTeam])).toBe(true)
    expect(hasNearbyTeamWithinSpeed(sourceTeam, [sourceTeam, farTeam])).toBe(false)
    expect(hasNearbyTeamWithinSpeed(sourceTeam, [sourceTeam, { ...nearbyTeam, type: TokenType.Eliminated }])).toBe(false)
  })
})