import { describe, expect, it, vi } from 'vitest'
import {
  advanceAlongRoute,
  fetchTargetRoute,
  getRandomAdvanceDistance,
  greatCircleDistance,
  getStoppedTokenIds,
  getTargetRouteKey,
  resolveSimultaneousAdvances,
  resolveTeamCollisionOutcomes,
  shouldAdvance,
} from './target-route'
import { TokenType } from './token-store'

const endpoints = {
  longitude: -79.3832,
  latitude: 43.6532,
}

const target = {
  longitude: -73.5673,
  latitude: 45.5017,
}

describe('Target road routing', () => {
  it('returns the road geometry from the routing service', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            geometry: {
              coordinates: [
                [-79.3832, 43.6532],
                [-76.2, 44.1],
                [-73.5673, 45.5017],
              ],
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTargetRoute(endpoints, target)).resolves.toEqual([
      { longitude: -79.3832, latitude: 43.6532 },
      { longitude: -76.2, latitude: 44.1 },
      { longitude: -73.5673, latitude: 45.5017 },
    ])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toContain('router.project-osrm.org/route/v1/driving')
    expect(fetchMock.mock.calls[0]?.[0]).toContain('geometries=geojson')
  })

  it('rejects when the routing service cannot find a route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ code: 'NoRoute', routes: [] }),
      }),
    )

    await expect(fetchTargetRoute(endpoints, target)).rejects.toThrow('No road route')
  })

  it('uses a fixed 50% movement probability', () => {
    expect(shouldAdvance(() => 0.49)).toBe(true)
    expect(shouldAdvance(() => 0.5)).toBe(false)
    expect(getRandomAdvanceDistance(100, () => 0)).toBe(10)
    expect(getRandomAdvanceDistance(100, () => 1)).toBe(100)
  })

  it('uses each Team speed for route movement', () => {
    const tokens = [
      {
        id: 'alpha',
        type: TokenType.Team,
        targetTokenId: 'bravo',
        speed: 100,
        longitude: 0,
        latitude: 0,
      },
      {
        id: 'bravo',
        type: TokenType.PowerUp,
        targetTokenId: null,
        speed: 250,
        longitude: 2,
        latitude: 0,
      },
    ] as const
    const route = [tokens[0]!, tokens[1]!]
    const plans = resolveSimultaneousAdvances(
      tokens,
      new Map([[getTargetRouteKey(tokens[0]!, tokens[1]!), route]]),
      () => 0,
    )

    expect(plans).toHaveLength(1)
    expect(plans[0]?.distanceTravelledKilometers).toBeCloseTo(10)
  })

  it('allows a Team to reach a Power Up target', () => {
    const tokens = [
      {
        id: 'alpha',
        type: TokenType.Team,
        targetTokenId: 'power-up',
        speed: 250,
        longitude: 0,
        latitude: 0,
      },
      {
        id: 'power-up',
        type: TokenType.PowerUp,
        targetTokenId: null,
        speed: 250,
        longitude: 1,
        latitude: 0,
      },
    ] as const
    const route = [tokens[0]!, tokens[1]!]
    const plans = resolveSimultaneousAdvances(
      tokens,
      new Map([[getTargetRouteKey(tokens[0]!, tokens[1]!), route]]),
      () => 0,
      undefined,
      new Map([['alpha', 250]]),
    )

    expect(plans[0]).toMatchObject({
      tokenId: 'alpha',
      targetTokenId: 'power-up',
      reachedTarget: true,
      coordinates: tokens[1],
    })
  })

  it('moves along the route and stops at the target instead of overshooting', () => {
    const route = [
      { longitude: 0, latitude: 0 },
      { longitude: 1, latitude: 0 },
      { longitude: 2, latitude: 0 },
    ]

    const partialAdvance = advanceAlongRoute(route, 100)
    expect(partialAdvance.reachedTarget).toBe(false)
    expect(partialAdvance.coordinates.longitude).toBeGreaterThan(0)
    expect(partialAdvance.coordinates.longitude).toBeLessThan(1)

    const fullAdvance = advanceAlongRoute(route, 500)
    expect(fullAdvance.reachedTarget).toBe(true)
    expect(fullAdvance.coordinates).toEqual(route.at(-1))
  })

  it('plans moving targets simultaneously from the same snapshot', () => {
    const tokens = [
      {
        id: 'alpha',
        type: TokenType.Team,
        targetTokenId: 'bravo',
        speed: 250,
        longitude: 0,
        latitude: 0,
      },
      {
        id: 'bravo',
        type: TokenType.Team,
        targetTokenId: 'charlie',
        speed: 250,
        longitude: 3,
        latitude: 0,
      },
      {
        id: 'charlie',
        type: TokenType.PowerUp,
        targetTokenId: null,
        speed: 250,
        longitude: 6,
        latitude: 0,
      },
    ] as const
    const routes = new Map([
      [
        getTargetRouteKey(tokens[0]!, tokens[1]!),
        [tokens[0]!, tokens[1]!],
      ],
      [
        getTargetRouteKey(tokens[1]!, tokens[2]!),
        [tokens[1]!, tokens[2]!],
      ],
    ])

    const plans = resolveSimultaneousAdvances(tokens, routes, () => 0)

    expect(plans.map((plan) => plan.tokenId)).toEqual(['alpha', 'bravo'])
    expect(plans[0]?.coordinates.longitude).toBeGreaterThan(0)
    expect(plans[0]?.coordinates.longitude).toBeLessThan(3)
    expect(plans[1]?.coordinates.longitude).toBeGreaterThan(3)
    expect(plans[1]?.coordinates.longitude).toBeLessThan(6)
  })

  it('stops opposing Teams before they pass each other', () => {
    const tokens = [
      {
        id: 'alpha',
        type: TokenType.Team,
        targetTokenId: 'bravo',
        speed: 250,
        longitude: -2,
        latitude: 0,
      },
      {
        id: 'bravo',
        type: TokenType.Team,
        targetTokenId: 'alpha',
        speed: 250,
        longitude: 2,
        latitude: 0,
      },
    ] as const
    const routes = new Map([
      [getTargetRouteKey(tokens[0]!, tokens[1]!), [tokens[0]!, tokens[1]!]],
      [getTargetRouteKey(tokens[1]!, tokens[0]!), [tokens[1]!, tokens[0]!]],
    ])
    const randomValues = [0, 0.99999, 0, 0.99999]
    const random = () => randomValues.shift() ?? 0.99999

    const plans = resolveSimultaneousAdvances(tokens, routes, random)

    expect(plans.map((plan) => plan.tokenId)).toEqual(['alpha', 'bravo'])
    expect(plans[0]?.coordinates.longitude).toBeLessThan(plans[1]?.coordinates.longitude ?? 0)
    expect(greatCircleDistance(plans[0]!.coordinates, plans[1]!.coordinates)).toBeLessThanOrEqual(10.1)
    expect(plans[0]?.collisionTokenIds).toEqual(['bravo'])
    expect(plans[1]?.collisionTokenIds).toEqual(['alpha'])
    expect(resolveTeamCollisionOutcomes(plans, tokens, () => 0.99999)).toEqual({
      winnerIds: ['bravo'],
      loserIds: ['alpha'],
      eliminations: [{ winnerId: 'bravo', loserIds: ['alpha'] }],
    })
  })

  it('stops both tokens when a Team is within 10 km of its target', () => {
    const tokens = [
      {
        id: 'alpha',
        type: TokenType.Team,
        targetTokenId: 'bravo',
        speed: 250,
        longitude: 0,
        latitude: 0,
      },
      {
        id: 'bravo',
        type: TokenType.Team,
        targetTokenId: 'charlie',
        speed: 250,
        longitude: 0.05,
        latitude: 0,
      },
      {
        id: 'charlie',
        type: TokenType.PowerUp,
        targetTokenId: null,
        speed: 250,
        longitude: 2,
        latitude: 0,
      },
    ] as const

    expect([...getStoppedTokenIds(tokens)]).toEqual(['alpha', 'bravo'])
    expect(resolveSimultaneousAdvances(tokens, new Map(), () => 0)).toEqual([])
  })
})
