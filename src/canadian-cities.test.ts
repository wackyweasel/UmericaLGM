import { describe, expect, it } from 'vitest'
import { CANADIAN_CITIES } from './canadian-cities'

describe('Canadian city snapshot', () => {
  it('contains the fixed population-filtered GeoNames records', () => {
    expect(CANADIAN_CITIES).toHaveLength(761)
    expect(new Set(CANADIAN_CITIES.map((city) => city.geonameId)).size).toBe(CANADIAN_CITIES.length)
    expect(CANADIAN_CITIES.every((city) => city.population >= 10000)).toBe(true)
    expect(CANADIAN_CITIES.every((city) => city.latitude >= -90 && city.latitude <= 90)).toBe(true)
    expect(CANADIAN_CITIES.every((city) => city.longitude >= -180 && city.longitude <= 180)).toBe(true)
  })

  it('keeps Ottawa at its GeoNames coordinates', () => {
    expect(CANADIAN_CITIES.find((city) => city.name === 'Ottawa')).toEqual({
      geonameId: 6094817,
      name: 'Ottawa',
      latitude: 45.41117,
      longitude: -75.69812,
      population: 1017449,
      featureCode: 'PPLC',
    })
  })
})