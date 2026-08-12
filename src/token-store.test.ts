import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ELIMINATED_COLOR,
  ELIMINATION_POWER_UP_NAME,
  DEFAULT_PLAYER_COLOR,
  DEFAULT_POWER_UP_COLOR,
  DEFAULT_TEAM_COLOR,
  DEFAULT_SPEED_KILOMETERS,
  TokenStore,
  TokenType,
  type StorageLike,
} from './token-store'

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  seed(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('TokenStore', () => {
  it('starts empty when storage has no token payload', () => {
    const store = new TokenStore(new MemoryStorage())

    expect(store.list()).toEqual([])
  })

  it('creates and persists a trimmed token', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)

    const token = store.create('  North star  ', { longitude: 12, latitude: 48 })
    const reloadedStore = new TokenStore(storage)

    expect(token.name).toBe('North star')
    expect(token.type).toBe(TokenType.Team)
    expect(token.color).toBe(DEFAULT_TEAM_COLOR)
    expect(token.speed).toBe(DEFAULT_SPEED_KILOMETERS)
    expect(token.powerUps).toEqual([])
    expect(reloadedStore.list()).toEqual([token])
  })

  it('undoes and redoes writes while discarding redo history after a new write', () => {
    const store = new TokenStore(new MemoryStorage())
    const token = store.create('North star', { longitude: 12, latitude: 48 })
    store.rename(token.id, 'South star')

    expect(store.canUndo()).toBe(true)
    expect(store.undo()).toBe(true)
    expect(store.list()[0]?.name).toBe('North star')
    expect(store.canRedo()).toBe(true)
    expect(store.redo()).toBe(true)
    expect(store.list()[0]?.name).toBe('South star')

    expect(store.undo()).toBe(true)
    store.setNotes(token.id, 'Replacement write')
    expect(store.canRedo()).toBe(false)
    expect(store.redo()).toBe(false)
  })

  it('creates and persists multiple token seeds in one batch', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)

    const tokens = store.createMany([
      { name: 'Toronto', coordinates: { longitude: -79.3832, latitude: 43.6532 } },
      { name: 'Vancouver', coordinates: { longitude: -123.1207, latitude: 49.2827 }, type: TokenType.Team },
    ])

    expect(tokens).toHaveLength(2)
    expect(tokens.every((token) => token.type === TokenType.Team)).toBe(true)
    expect(tokens.every((token) => token.color === DEFAULT_TEAM_COLOR)).toBe(true)
    expect(new TokenStore(storage).list()).toEqual(tokens)
  })

  it('persists and edits token types', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const token = store.create('Power marker', { longitude: 12, latitude: 48 }, undefined, TokenType.PowerUp)

    expect(token.type).toBe(TokenType.PowerUp)
    expect(token.color).toBe(DEFAULT_POWER_UP_COLOR)
    const updatedToken = store.setType(token.id, TokenType.Team)

    expect(updatedToken.type).toBe(TokenType.Team)
    expect(new TokenStore(storage).list()[0]?.type).toBe(TokenType.Team)
  })

  it('supports Player tokens without giving them a target', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const player = store.create('Player marker', { longitude: 12, latitude: 48 }, undefined, TokenType.Player)
    const team = store.create('Team marker', { longitude: 20, latitude: 50 })

    expect(player).toMatchObject({
      type: TokenType.Player,
      color: DEFAULT_PLAYER_COLOR,
      targetTokenId: null,
    })
    expect(() => store.setTarget(player.id, team.id)).toThrow('Only Team tokens')
    expect(store.setTarget(team.id, player.id).targetTokenId).toBe(player.id)

    const reloadedPlayer = new TokenStore(storage).list().find((token) => token.id === player.id)
    expect(reloadedPlayer).toMatchObject({ type: TokenType.Player, targetTokenId: null })
  })

  it('persists and validates speed settings', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const token = store.create('Advancing team', { longitude: 0, latitude: 0 })

    const speedUpdatedToken = store.setSpeed(token.id, 320.5)

    expect(speedUpdatedToken.speed).toBe(320.5)
    expect(new TokenStore(storage).list()[0]).toMatchObject({
      speed: 320.5,
    })
    const importedToken = new TokenStore(new MemoryStorage()).importData(store.exportData())[0]
    expect(importedToken?.speed).toBe(320.5)
    expect(() => store.setSpeed(token.id, -1)).toThrow('non-negative')
    expect(() => store.setSpeed(token.id, Number.NaN)).toThrow('non-negative')
  })

  it('persists, edits, and collects Team Power Ups atomically', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const team = store.create('Collector', { longitude: 0, latitude: 0 })
    const powerUp = store.create(
      'Power Up 1',
      { longitude: 1, latitude: 1 },
      undefined,
      TokenType.PowerUp,
    )
    const player = store.create(
      'Player marker',
      { longitude: 2, latitude: 2 },
      undefined,
      TokenType.Player,
    )

    expect(store.setTarget(team.id, powerUp.id).targetTokenId).toBe(powerUp.id)
    expect(store.setPowerUps(team.id, ['  Shield  ', 'Map'])).toMatchObject({
      powerUps: ['Shield', 'Map'],
    })

    const movedTokens = store.moveMany(
      [{ id: team.id, coordinates: powerUp }],
      [{ teamId: team.id, powerUpId: powerUp.id }],
    )

    expect(movedTokens[0]).toMatchObject({
      id: team.id,
      targetTokenId: null,
      powerUps: ['Shield', 'Map', 'Power Up 1'],
    })
    expect(store.list()).toHaveLength(2)
    expect(new TokenStore(storage).list()[0]).toMatchObject({
      powerUps: ['Shield', 'Map', 'Power Up 1'],
      targetTokenId: null,
    })

    const imported = new TokenStore(new MemoryStorage()).importData(store.exportData())
    expect(imported.find((token) => token.id !== player.id)?.powerUps).toEqual([
      'Shield',
      'Map',
      'Power Up 1',
    ])

    const encounteredPowerUp = store.create(
      'Power Up 2',
      { longitude: 1.1, latitude: 1.1 },
      undefined,
      TokenType.PowerUp,
    )
    expect(store.moveMany(
      [{ id: team.id, coordinates: encounteredPowerUp }],
      [{ teamId: team.id, powerUpId: encounteredPowerUp.id }],
    )[0]?.powerUps).toEqual(['Shield', 'Map', 'Power Up 1', 'Power Up 2'])
    expect(() => store.setPowerUps(player.id, [])).toThrow('Only Team')
  })

  it('moves a collision winner and eliminates the loser atomically', () => {
    const store = new TokenStore(new MemoryStorage())
    const winner = store.create('Winner', { longitude: 0, latitude: 0 })
    const loser = store.create('Loser', { longitude: 1, latitude: 0 })
    const observer = store.create('Observer', { longitude: 2, latitude: 0 })

    store.setTarget(winner.id, loser.id)
    store.setTarget(observer.id, loser.id)

    const movedTokens = store.moveMany(
      [{ id: winner.id, coordinates: loser }],
      [],
      [loser.id],
      [{ teamId: winner.id, powerUpName: ELIMINATION_POWER_UP_NAME }],
    )

    expect(movedTokens[0]).toMatchObject({
      id: winner.id,
      longitude: 1,
      latitude: 0,
      targetTokenId: null,
      powerUps: [ELIMINATION_POWER_UP_NAME],
    })
    expect(store.list().map((token) => token.id)).toEqual([winner.id, loser.id, observer.id])
    expect(store.list()[1]).toMatchObject({
      type: TokenType.Eliminated,
      color: DEFAULT_ELIMINATED_COLOR,
      targetTokenId: null,
    })
    expect(store.list()[2]?.targetTokenId).toBeNull()
    expect(() => store.setTarget(winner.id, loser.id)).toThrow('Eliminated tokens')
  })

  it('uses one Power Up from the front of a Team inventory', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const team = store.create('Consumer', { longitude: 0, latitude: 0 }, undefined, TokenType.Team, undefined, [
      'First',
      'Second',
    ])

    expect(store.usePowerUp(team.id).powerUps).toEqual(['Second'])
    expect(new TokenStore(storage).list()[0]?.powerUps).toEqual(['Second'])
  })

  it('retains an eliminated collision loser position, trajectory, and inventory', () => {
    const store = new TokenStore(new MemoryStorage())
    const winner = store.create('Winner', { longitude: 0, latitude: 0 })
    const loser = store.create('Loser', { longitude: 1, latitude: 0 })
    const observer = store.create('Observer', { longitude: 2, latitude: 0 })
    store.setPowerUps(loser.id, ['Shield'])
    store.setTarget(winner.id, loser.id)
    store.setTarget(observer.id, loser.id)

    const loserStop = { longitude: 1.2, latitude: 0.1 }
    store.moveMany(
      [
        { id: winner.id, coordinates: { longitude: 1, latitude: 0 } },
        { id: loser.id, coordinates: loserStop },
      ],
      [],
      [loser.id],
    )

    const eliminatedLoser = store.list().find((token) => token.id === loser.id)
    expect(eliminatedLoser).toMatchObject({
      type: TokenType.Eliminated,
      color: DEFAULT_ELIMINATED_COLOR,
      latitude: loserStop.latitude,
      targetTokenId: null,
      powerUps: ['Shield'],
    })
    expect(eliminatedLoser?.longitude).toBeCloseTo(loserStop.longitude)
    expect(eliminatedLoser?.trajectory).toEqual([
      expect.objectContaining({ longitude: 1, latitude: 0 }),
    ])
    expect(store.list().find((token) => token.id === observer.id)?.targetTokenId).toBeNull()
    expect(() => store.move(loser.id, { longitude: 3, latitude: 3 })).toThrow('cannot move')
    expect(() => store.moveMany([{ id: loser.id, coordinates: { longitude: 3, latitude: 3 } }])).toThrow(
      'cannot move',
    )
  })

  it('persists and transfers Team targets while clearing deleted targets', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const team = store.create('Team alpha', { longitude: 0, latitude: 0 })
    const powerUp = store.create('Power marker', { longitude: 12, latitude: 48 }, undefined, TokenType.PowerUp)

    const targetedToken = store.setTarget(team.id, powerUp.id)
    expect(targetedToken.targetTokenId).toBe(powerUp.id)
    expect(new TokenStore(storage).list()[0]?.targetTokenId).toBe(powerUp.id)
    expect(() => store.setTarget(team.id, team.id)).toThrow('cannot target itself')
    expect(() => store.setTarget(powerUp.id, team.id)).toThrow('Only Team tokens')

    const importedTokens = new TokenStore(new MemoryStorage()).importData(store.exportData())
    expect(importedTokens[0]?.targetTokenId).toBe(importedTokens[1]?.id)

    store.remove(powerUp.id)
    expect(store.list()[0]?.targetTokenId).toBeNull()
    expect(new TokenStore(storage).list()[0]?.targetTokenId).toBeNull()
  })

  it('persists notes and defaults notes for legacy tokens', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const token = store.create('Note holder', { longitude: 12, latitude: 48 })
    const updatedToken = store.setNotes(token.id, '  Meet at the north entrance.  ')

    expect(updatedToken.notes).toBe('  Meet at the north entrance.  ')
    expect(new TokenStore(storage).list()[0]?.notes).toBe('  Meet at the north entrance.  ')

    const legacyStorage = new MemoryStorage()
    legacyStorage.seed(
      'umerica-token-map.tokens.v1',
      JSON.stringify({ version: 1, tokens: [{ id: 'legacy', name: 'Legacy', longitude: 0, latitude: 0 }] }),
    )

    expect(new TokenStore(legacyStorage).list()[0]?.notes).toBe('')
  })

  it('rejects empty names and invalid latitudes', () => {
    const store = new TokenStore(new MemoryStorage())

    expect(() => store.create('   ', { longitude: 0, latitude: 0 })).toThrow(
      'Token name cannot be empty',
    )
    expect(() => store.create('North star', { longitude: 0, latitude: 91 })).toThrow(
      'Token coordinates are invalid',
    )
  })

  it('normalizes longitudes when moving a token', () => {
    const store = new TokenStore(new MemoryStorage())
    const token = store.create('Dateline', { longitude: 179, latitude: 0 })

    const movedToken = store.move(token.id, { longitude: 541, latitude: 10 })

    expect(movedToken.longitude).toBe(-179)
    expect(movedToken.latitude).toBe(10)
    expect(movedToken.trajectory).toEqual([
      expect.objectContaining({ longitude: 179, latitude: 0 }),
    ])
  })

  it('moves multiple tokens atomically and records each previous position', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const firstToken = store.create('First', { longitude: 0, latitude: 0 })
    const secondToken = store.create('Second', { longitude: 10, latitude: 10 })

    const movedTokens = store.moveMany([
      { id: firstToken.id, coordinates: { longitude: 1, latitude: 1 } },
      { id: secondToken.id, coordinates: { longitude: 11, latitude: 11 } },
    ])

    expect(movedTokens.map((token) => token.id)).toEqual([firstToken.id, secondToken.id])
    expect(movedTokens[0]?.trajectory).toEqual([
      expect.objectContaining({ longitude: 0, latitude: 0 }),
    ])
    expect(movedTokens[1]?.trajectory).toEqual([
      expect.objectContaining({ longitude: 10, latitude: 10 }),
    ])
    expect(new TokenStore(storage).list()).toEqual(store.list())
  })

  it('clears a token trajectory without changing its current position', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const token = store.create('Clearable route', { longitude: 0, latitude: 0 })

    store.move(token.id, { longitude: 10, latitude: 10 })
    const clearedToken = store.clearTrajectory(token.id)

    expect(clearedToken).toMatchObject({
      name: 'Clearable route',
      longitude: 10,
      latitude: 10,
      trajectory: [],
    })
    expect(new TokenStore(storage).list()[0]?.trajectory).toEqual([])
  })

  it('records and edits trajectory points', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)
    const token = store.create('Route', { longitude: 0, latitude: 0 })

    store.move(token.id, { longitude: 10, latitude: 10 })
    const movedToken = store.move(token.id, { longitude: 20, latitude: 20 })
    const insertedToken = store.addTrajectoryPoint(token.id, { longitude: 5, latitude: 5 }, 1)
    const insertedPoint = insertedToken.trajectory[1]

    expect(movedToken.trajectory).toHaveLength(2)
    expect(insertedToken.trajectory).toHaveLength(3)
    expect(insertedPoint).toEqual(expect.objectContaining({ longitude: 5, latitude: 5 }))

    const repositionedToken = store.moveTrajectoryPoint(token.id, insertedPoint.id, {
      longitude: 6,
      latitude: 6,
    })
    expect(repositionedToken.trajectory[1]).toEqual(
      expect.objectContaining({ id: insertedPoint.id, longitude: 6, latitude: 6 }),
    )

    store.removeTrajectoryPoint(token.id, insertedPoint.id)
    const reloadedToken = new TokenStore(storage).list()[0]
    expect(reloadedToken?.trajectory).toHaveLength(2)
  })

  it('uses fixed colors for each token type and defaults legacy tokens', () => {
    const storage = new MemoryStorage()
    const store = new TokenStore(storage)

    const team = store.create('Team marker', { longitude: 12, latitude: 48 }, '#00AACC')
    const player = store.create('Player marker', { longitude: 13, latitude: 48 }, '#00AACC', TokenType.Player)
    const powerUp = store.create('Power marker', { longitude: 14, latitude: 48 }, '#00AACC', TokenType.PowerUp)
    const eliminated = store.create('Eliminated marker', { longitude: 15, latitude: 48 }, '#00AACC', TokenType.Eliminated)

    expect(team.color).toBe(DEFAULT_TEAM_COLOR)
    expect(player.color).toBe(DEFAULT_PLAYER_COLOR)
    expect(powerUp.color).toBe(DEFAULT_POWER_UP_COLOR)
    expect(eliminated.color).toBe(DEFAULT_ELIMINATED_COLOR)

    expect(new TokenStore(storage).list().map((token) => token.color)).toEqual([
      DEFAULT_TEAM_COLOR,
      DEFAULT_PLAYER_COLOR,
      DEFAULT_POWER_UP_COLOR,
      DEFAULT_ELIMINATED_COLOR,
    ])

    const legacyStorage = new MemoryStorage()
    legacyStorage.seed(
      'umerica-token-map.tokens.v1',
      JSON.stringify({
        version: 1,
        tokens: [{ id: 'legacy', name: 'Legacy', color: '#112233', longitude: 0, latitude: 0 }],
      }),
    )

    expect(new TokenStore(legacyStorage).list()[0]).toMatchObject({
      color: DEFAULT_TEAM_COLOR,
      type: TokenType.Team,
    })
  })

  it('preserves Eliminated inventory and clears imported targets aimed at it', () => {
    const imported = new TokenStore(new MemoryStorage()).importData(JSON.stringify({
      version: 4,
      tokens: [
        {
          id: 'team-source',
          name: 'Team source',
          color: DEFAULT_TEAM_COLOR,
          type: TokenType.Team,
          targetTokenId: 'eliminated-source',
          longitude: 0,
          latitude: 0,
        },
        {
          id: 'eliminated-source',
          name: 'Eliminated source',
          color: DEFAULT_ELIMINATED_COLOR,
          type: TokenType.Eliminated,
          powerUps: ['Shield'],
          longitude: 1,
          latitude: 1,
        },
      ],
    }))

    expect(imported[0]?.targetTokenId).toBeNull()
    expect(imported[1]).toMatchObject({
      type: TokenType.Eliminated,
      color: DEFAULT_ELIMINATED_COLOR,
      powerUps: ['Shield'],
    })
  })

  it('exports and imports token data with fresh ids', () => {
    const sourceStore = new TokenStore(new MemoryStorage())
    const sourceToken = sourceStore.create(
      'Imported place',
      { longitude: 12, latitude: 48 },
      '#123456',
      TokenType.PowerUp,
    )
    sourceStore.setNotes(sourceToken.id, 'Imported note')
    sourceStore.move(sourceToken.id, { longitude: 13, latitude: 49 })
    const destinationStore = new TokenStore(new MemoryStorage())
    const exportedData = JSON.parse(sourceStore.exportData()) as {
      tokens: Array<{ notes?: string }>
    }

    expect(exportedData.tokens[0]?.notes).toBe('Imported note')

    const importedTokens = destinationStore.importData(sourceStore.exportData())

    expect(importedTokens[0]).toMatchObject({
      name: sourceToken.name,
      color: sourceToken.color,
      type: TokenType.PowerUp,
      longitude: 13,
      latitude: 49,
      notes: 'Imported note',
    })
    expect(importedTokens[0]?.id).not.toBe(sourceToken.id)
    expect(importedTokens[0]?.trajectory[0]).toMatchObject({ longitude: 12, latitude: 48 })
    expect(importedTokens[0]?.trajectory[0]?.id).not.toBe(sourceToken.id)
    expect(destinationStore.list()).toEqual(importedTokens)
  })

  it('renames and removes tokens', () => {
    const store = new TokenStore(new MemoryStorage())
    const token = store.create('Old name', { longitude: 0, latitude: 0 })

    store.rename(token.id, 'New name')
    expect(store.list()[0]?.name).toBe('New name')

    store.remove(token.id)
    expect(store.list()).toEqual([])
  })

  it('resets tokens and removes only its persisted data', () => {
    const storage = new MemoryStorage()
    storage.seed('unrelated.preference', 'kept')
    const store = new TokenStore(storage)
    store.create('Old match token', { longitude: 0, latitude: 0 })

    store.reset()

    expect(store.list()).toEqual([])
    expect(store.canUndo()).toBe(false)
    expect(new TokenStore(storage).list()).toEqual([])
    expect(storage.getItem('unrelated.preference')).toBe('kept')
  })

  it('fails closed for malformed or schema-invalid cached data', () => {
    const malformedStorage = new MemoryStorage()
    malformedStorage.seed('umerica-token-map.tokens.v1', '{not json')
    expect(new TokenStore(malformedStorage).list()).toEqual([])

    const invalidStorage = new MemoryStorage()
    invalidStorage.seed(
      'umerica-token-map.tokens.v1',
      JSON.stringify({ version: 1, tokens: [{ id: 'bad', name: '', longitude: 0, latitude: 0 }] }),
    )
    expect(new TokenStore(invalidStorage).list()).toEqual([])
  })
})