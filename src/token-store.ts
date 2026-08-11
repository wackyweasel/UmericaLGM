export const TOKEN_STORAGE_KEY = 'umerica-token-map.tokens.v1'
export const DEFAULT_TEAM_COLOR = '#e53935'
export const DEFAULT_PLAYER_COLOR = '#1e88e5'
export const DEFAULT_POWER_UP_COLOR = '#e4f05f'
export const DEFAULT_ELIMINATED_COLOR = '#757575'
export const DEFAULT_TOKEN_COLOR = DEFAULT_TEAM_COLOR
export const DEFAULT_SPEED_KILOMETERS = 250
export const ELIMINATION_POWER_UP_NAME = 'Elimination Power Up'

export const TokenType = {
  Team: 'Team',
  Player: 'Player',
  PowerUp: 'Power Up',
  Eliminated: 'Eliminated',
} as const

export type TokenType = (typeof TokenType)[keyof typeof TokenType]

const STORAGE_VERSION = 1
const TOKEN_DATA_VERSION = 4
const LEGACY_TOKEN_DATA_VERSION = 1
const EARLIER_TOKEN_DATA_VERSION = 2
const PREVIOUS_TOKEN_DATA_VERSION = 3
const MAX_HISTORY_ENTRIES = 100

export interface Coordinates {
  longitude: number
  latitude: number
}

export interface TokenSeed {
  name: string
  coordinates: Coordinates
  color?: string
  type?: TokenType
  notes?: string
  speed?: number
  powerUps?: readonly string[]
}

export interface TrajectoryPoint extends Coordinates {
  id: string
}

export interface Token extends Coordinates {
  id: string
  name: string
  color: string
  type: TokenType
  notes: string
  targetTokenId: string | null
  speed: number
  powerUps: string[]
  trajectory: TrajectoryPoint[]
}

interface StoredTrajectoryPoint extends Coordinates {
  id: string
}

interface StoredToken extends Coordinates {
  id: string
  name: string
  color?: string
  type?: TokenType
  notes?: string
  targetTokenId?: string | null
  speed?: number
  powerUps?: string[]
  trajectory?: StoredTrajectoryPoint[]
}

interface TransferToken extends Coordinates {
  id?: string
  name: string
  color: string
  type?: TokenType
  notes?: string
  targetTokenId?: string | null
  speed?: number
  powerUps?: string[]
  trajectory?: Coordinates[]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PowerUpCollection {
  teamId: string
  powerUpId: string
}

export interface PowerUpReward {
  teamId: string
  powerUpName: string
}

export class TokenStore {
  private tokens: Token[]
  private undoStack: Token[][] = []
  private redoStack: Token[][] = []
  private readonly listeners = new Set<() => void>()
  private readonly storage: StorageLike
  private readonly storageKey: string

  constructor(storage: StorageLike = getBrowserStorage(), storageKey = TOKEN_STORAGE_KEY) {
    this.storage = storage
    this.storageKey = storageKey
    this.tokens = readTokens(storage, storageKey)
  }

  list(): Token[] {
    return this.tokens.map(cloneToken)
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  undo(): boolean {
    const previousTokens = this.undoStack.pop()
    if (!previousTokens) {
      return false
    }

    this.pushHistory(this.redoStack, this.tokens)
    this.persist(previousTokens)
    this.notify()
    return true
  }

  redo(): boolean {
    const nextTokens = this.redoStack.pop()
    if (!nextTokens) {
      return false
    }

    this.pushHistory(this.undoStack, this.tokens)
    this.persist(nextTokens)
    this.notify()
    return true
  }

  create(
    name: string,
    coordinates: Coordinates,
    _color: string | undefined = undefined,
    type: TokenType = TokenType.Team,
    speed: number | undefined = undefined,
    powerUps: readonly string[] | undefined = undefined,
  ): Token {
    return this.createMany([{ name, coordinates, type, speed, powerUps }])[0]!
  }

  createMany(seeds: readonly TokenSeed[]): Token[] {
    if (seeds.length === 0) {
      return []
    }

    const createdTokens = seeds.map((seed) => {
      const type = validateTokenType(seed.type ?? TokenType.Team)
      return {
        id: createTokenId(),
        name: validateName(seed.name),
        color: defaultColorForType(type),
        type,
        notes: validateNotes(seed.notes ?? ''),
        targetTokenId: null,
        speed: validateSpeed(seed.speed ?? DEFAULT_SPEED_KILOMETERS),
        powerUps: type === TokenType.Team || type === TokenType.Eliminated
          ? normalizePowerUps(seed.powerUps)
          : [],
        trajectory: [],
        ...normalizeCoordinates(seed.coordinates),
      }
    })

    this.commit([...this.tokens, ...createdTokens])
    return createdTokens.map(cloneToken)
  }

  rename(id: string, name: string): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const updatedToken = {
      ...this.tokens[tokenIndex],
      name: validateName(name),
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  setType(id: string, type: TokenType): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const nextType = validateTokenType(type)
    const updatedToken = {
      ...this.tokens[tokenIndex],
      type: nextType,
      color: defaultColorForType(nextType),
      targetTokenId: nextType === TokenType.Team ? this.tokens[tokenIndex].targetTokenId : null,
      powerUps: nextType === TokenType.Team || nextType === TokenType.Eliminated
        ? this.tokens[tokenIndex].powerUps
        : [],
    }

    const nextTokens = this.tokens.map((candidate, index) => {
      if (index === tokenIndex) {
        return updatedToken
      }

      return nextType === TokenType.Eliminated && candidate.targetTokenId === id
        ? { ...candidate, targetTokenId: null }
        : candidate
    })
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  setNotes(id: string, notes: string): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const updatedToken = {
      ...this.tokens[tokenIndex],
      notes: validateNotes(notes),
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  setTarget(id: string, targetTokenId: string | null): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const token = this.tokens[tokenIndex]
    if (token.type !== TokenType.Team) {
      throw new Error('Only Team tokens can have a target')
    }

    const normalizedTargetId = targetTokenId || null
    if (normalizedTargetId !== null) {
      if (normalizedTargetId === id) {
        throw new Error('A Team token cannot target itself')
      }
      const targetToken = this.tokens.find((candidate) => candidate.id === normalizedTargetId)
      if (!targetToken) {
        throw new Error(`Target token not found: ${normalizedTargetId}`)
      }
      if (targetToken.type === TokenType.Eliminated) {
        throw new Error('Eliminated tokens cannot be targeted')
      }
    }

    const updatedToken = {
      ...token,
      targetTokenId: normalizedTargetId,
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  setSpeed(id: string, speed: number): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const updatedToken = {
      ...this.tokens[tokenIndex],
      speed: validateSpeed(speed),
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  setPowerUps(id: string, powerUps: readonly string[]): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const token = this.tokens[tokenIndex]
    if (token.type !== TokenType.Team) {
      throw new Error('Only Team tokens can have power ups')
    }

    const updatedToken = {
      ...token,
      powerUps: normalizePowerUps(powerUps),
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  usePowerUp(id: string): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const token = this.tokens[tokenIndex]
    if (token.type !== TokenType.Team) {
      throw new Error('Only Team tokens can use power ups')
    }
    if (token.powerUps.length === 0) {
      throw new Error('Team has no power ups')
    }

    const updatedToken = {
      ...token,
      powerUps: token.powerUps.slice(1),
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  exportData(): string {
    const tokens: TransferToken[] = this.tokens.map(({ id, name, color, type, notes, targetTokenId, speed, powerUps, longitude, latitude, trajectory }) => ({
      id,
      name,
      color,
      type,
      notes,
      targetTokenId,
      speed,
      powerUps,
      longitude,
      latitude,
      trajectory: trajectory.map(({ longitude: pointLongitude, latitude: pointLatitude }) => ({
        longitude: pointLongitude,
        latitude: pointLatitude,
      })),
    }))

    return JSON.stringify({ version: TOKEN_DATA_VERSION, tokens }, null, 2)
  }

  importData(serialized: string): Token[] {
    const transferTokens = readTransferTokens(serialized)
    const importedIdMap = new Map<string, string>()
    const importedTypeBySourceId = new Map<string, TokenType>()
    const importedTokens = transferTokens.map((token) => {
      const id = createTokenId()
      const type = validateTokenType(token.type ?? TokenType.Team)
      if (token.id) {
        importedIdMap.set(token.id, id)
        importedTypeBySourceId.set(token.id, type)
      }

      return {
        id,
        name: validateName(token.name),
        color: defaultColorForType(type),
        type,
        notes: validateNotes(token.notes ?? ''),
        targetTokenId: null,
        speed: validateSpeed(token.speed ?? DEFAULT_SPEED_KILOMETERS),
        powerUps: type === TokenType.Team || type === TokenType.Eliminated
          ? normalizePowerUps(token.powerUps)
          : [],
        trajectory: (token.trajectory ?? []).map((point) => ({
          id: createTokenId(),
          ...normalizeCoordinates(point),
        })),
        ...normalizeCoordinates(token),
      }
    })
    const resolvedTokens = importedTokens.map((token, index) => {
      const sourceToken = transferTokens[index]!
      const targetTokenId =
        token.type === TokenType.Team &&
        sourceToken.targetTokenId &&
        sourceToken.targetTokenId !== sourceToken.id &&
        importedTypeBySourceId.get(sourceToken.targetTokenId) !== TokenType.Eliminated
          ? importedIdMap.get(sourceToken.targetTokenId) ?? null
          : null

      return { ...token, targetTokenId }
    })

    this.commit([...this.tokens, ...resolvedTokens])
    return resolvedTokens.map(cloneToken)
  }

  clear(): void {
    this.commit([])
  }

  moveMany(
    moves: readonly { id: string; coordinates: Coordinates }[],
    collections: readonly PowerUpCollection[] = [],
    eliminatedTokenIds: readonly string[] = [],
    rewards: readonly PowerUpReward[] = [],
  ): Token[] {
    if (moves.length === 0 && collections.length === 0 && eliminatedTokenIds.length === 0 && rewards.length === 0) {
      return []
    }

    const eliminatedIds = new Set<string>()
    for (const id of eliminatedTokenIds) {
      if (eliminatedIds.has(id)) {
        throw new Error(`Token elimination specified more than once: ${id}`)
      }

      this.requireTokenIndex(id)
      eliminatedIds.add(id)
    }

    const normalizedMoves = moves.map((move) => ({
      id: move.id,
      coordinates: normalizeCoordinates(move.coordinates),
    }))
    const moveById = new Map<string, Coordinates>()
    for (const move of normalizedMoves) {
      if (moveById.has(move.id)) {
        throw new Error(`Token move specified more than once: ${move.id}`)
      }

      const token = this.tokens[this.requireTokenIndex(move.id)]!
      if (token.type === TokenType.Eliminated) {
        throw new Error('Eliminated tokens cannot move')
      }
      moveById.set(move.id, move.coordinates)
    }

    const collectionsByPowerUp = new Map<string, PowerUpCollection>()
    const collectedPowerUpsByTeam = new Map<string, string[]>()
    for (const collection of collections) {
      if (collectionsByPowerUp.has(collection.powerUpId)) {
        throw new Error(`Power Up collected more than once: ${collection.powerUpId}`)
      }
      if (collectedPowerUpsByTeam.has(collection.teamId)) {
        throw new Error(`Team collected more than one Power Up: ${collection.teamId}`)
      }

      const team = this.tokens[this.requireTokenIndex(collection.teamId)]!
      const powerUp = this.tokens[this.requireTokenIndex(collection.powerUpId)]!
      if (eliminatedIds.has(team.id) || eliminatedIds.has(powerUp.id)) {
        throw new Error('A collected token cannot be eliminated in the same operation')
      }
      if (team.type !== TokenType.Team) {
        throw new Error('Only Team tokens can collect Power Ups')
      }
      if (powerUp.type !== TokenType.PowerUp) {
        throw new Error('Only Power Up tokens can be collected')
      }
      collectionsByPowerUp.set(collection.powerUpId, collection)
      collectedPowerUpsByTeam.set(collection.teamId, [powerUp.name])
    }

    const rewardedPowerUpsByTeam = new Map<string, string[]>()
    for (const reward of rewards) {
      const team = this.tokens[this.requireTokenIndex(reward.teamId)]!
      if (eliminatedIds.has(team.id)) {
        throw new Error('An eliminated token cannot receive a Power Up reward')
      }
      if (team.type !== TokenType.Team) {
        throw new Error('Only Team tokens can receive Power Up rewards')
      }

      const powerUpName = normalizePowerUps([reward.powerUpName])[0]!
      const teamRewards = rewardedPowerUpsByTeam.get(team.id) ?? []
      teamRewards.push(powerUpName)
      rewardedPowerUpsByTeam.set(team.id, teamRewards)
    }

    const collectedTokenIds = new Set(collectionsByPowerUp.keys())
    const nextTokens = this.tokens
      .filter((token) => !collectedTokenIds.has(token.id))
      .map((token) => {
        const nextCoordinates = moveById.get(token.id)
        const collectedPowerUps = collectedPowerUpsByTeam.get(token.id)
        const rewardedPowerUps = rewardedPowerUpsByTeam.get(token.id)
        const isEliminated = eliminatedIds.has(token.id)
        const nextType = isEliminated ? TokenType.Eliminated : token.type
        const nextTargetTokenId = isEliminated
          ? null
          : token.targetTokenId &&
              (eliminatedIds.has(token.targetTokenId) || collectedTokenIds.has(token.targetTokenId))
            ? null
            : token.targetTokenId
        const moved = nextCoordinates !== undefined && !coordinatesEqual(token, nextCoordinates)
        if (
          !nextCoordinates &&
          collectedPowerUps === undefined &&
          rewardedPowerUps === undefined &&
          nextTargetTokenId === token.targetTokenId &&
          nextType === token.type
        ) {
          return token
        }

        return {
          ...token,
          ...(nextCoordinates ?? {}),
          type: nextType,
          color: defaultColorForType(nextType),
          targetTokenId: nextTargetTokenId,
          powerUps: nextType === TokenType.Team || nextType === TokenType.Eliminated
            ? [...token.powerUps, ...(collectedPowerUps ?? []), ...(rewardedPowerUps ?? [])]
            : [],
          trajectory: moved ? appendTrajectoryPoint(token.trajectory, token) : token.trajectory,
        }
      })

    this.commit(nextTokens)
    return normalizedMoves.map((move) => cloneToken(nextTokens.find((token) => token.id === move.id)!))
  }

  move(id: string, coordinates: Coordinates): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const token = this.tokens[tokenIndex]
    if (token.type === TokenType.Eliminated) {
      throw new Error('Eliminated tokens cannot move')
    }
    const nextCoordinates = normalizeCoordinates(coordinates)
    const trajectory = coordinatesEqual(token, nextCoordinates)
      ? token.trajectory
      : appendTrajectoryPoint(token.trajectory, token)
    const updatedToken = {
      ...token,
      ...nextCoordinates,
      trajectory,
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  clearTrajectory(id: string): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const updatedToken = {
      ...this.tokens[tokenIndex],
      trajectory: [],
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  addTrajectoryPoint(id: string, coordinates: Coordinates, insertIndex = Number.MAX_SAFE_INTEGER): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const token = this.tokens[tokenIndex]
    const point: TrajectoryPoint = {
      id: createTokenId(),
      ...normalizeCoordinates(coordinates),
    }
    const safeInsertIndex = Math.min(Math.max(Math.trunc(insertIndex), 0), token.trajectory.length)
    const updatedToken = {
      ...token,
      trajectory: [
        ...token.trajectory.slice(0, safeInsertIndex),
        point,
        ...token.trajectory.slice(safeInsertIndex),
      ],
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  moveTrajectoryPoint(id: string, pointId: string, coordinates: Coordinates): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const token = this.tokens[tokenIndex]
    const pointIndex = token.trajectory.findIndex((point) => point.id === pointId)
    if (pointIndex === -1) {
      throw new Error(`Trajectory point not found: ${pointId}`)
    }

    const updatedPoint = {
      ...token.trajectory[pointIndex],
      ...normalizeCoordinates(coordinates),
    }
    const trajectory = [...token.trajectory]
    trajectory[pointIndex] = updatedPoint
    const updatedToken = { ...token, trajectory }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  removeTrajectoryPoint(id: string, pointId: string): Token {
    const tokenIndex = this.requireTokenIndex(id)
    const token = this.tokens[tokenIndex]
    if (!token.trajectory.some((point) => point.id === pointId)) {
      throw new Error(`Trajectory point not found: ${pointId}`)
    }

    const updatedToken = {
      ...token,
      trajectory: token.trajectory.filter((point) => point.id !== pointId),
    }

    const nextTokens = [...this.tokens]
    nextTokens[tokenIndex] = updatedToken
    this.commit(nextTokens)
    return cloneToken(updatedToken)
  }

  remove(id: string): void {
    this.requireTokenIndex(id)
    this.commit(
      this.tokens
        .filter((token) => token.id !== id)
        .map((token) => (token.targetTokenId === id ? { ...token, targetTokenId: null } : token)),
    )
  }

  private requireTokenIndex(id: string): number {
    const tokenIndex = this.tokens.findIndex((token) => token.id === id)
    if (tokenIndex === -1) {
      throw new Error(`Token not found: ${id}`)
    }

    return tokenIndex
  }

  private commit(nextTokens: Token[]): void {
    if (tokensEqual(this.tokens, nextTokens)) {
      return
    }

    this.pushHistory(this.undoStack, this.tokens)
    this.redoStack = []
    this.persist(nextTokens)
    this.notify()
  }

  private pushHistory(history: Token[][], tokens: readonly Token[]): void {
    history.push(tokens.map(cloneToken))
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.shift()
    }
  }

  private persist(nextTokens: readonly Token[]): void {
    const serialized = JSON.stringify({ version: STORAGE_VERSION, tokens: nextTokens })
    this.storage.setItem(this.storageKey, serialized)
    this.tokens = nextTokens.map(cloneToken)
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

function getBrowserStorage(): StorageLike {
  if (typeof window === 'undefined') {
    throw new Error('A browser storage implementation is required')
  }

  return window.localStorage
}

function readTokens(storage: StorageLike, storageKey: string): Token[] {
  let serialized: string | null

  try {
    serialized = storage.getItem(storageKey)
  } catch {
    return []
  }

  if (!serialized) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!isStoredPayload(parsed)) {
      return []
    }

    const tokens = parsed.tokens.map((token) => {
      const type = token.type ?? TokenType.Team
      return {
        id: token.id,
        name: token.name,
        color: defaultColorForType(type),
        type,
        notes: validateNotes(token.notes ?? ''),
        targetTokenId: token.targetTokenId ?? null,
        speed: validateSpeed(token.speed ?? DEFAULT_SPEED_KILOMETERS),
        powerUps: type === TokenType.Team || type === TokenType.Eliminated
          ? normalizePowerUps(token.powerUps)
          : [],
        trajectory: readStoredTrajectory(token.trajectory),
        ...normalizeCoordinates(token),
      }
    })
    const tokenIds = new Set(tokens.map((token) => token.id))

    const tokenById = new Map(tokens.map((token) => [token.id, token]))
    return tokens.map((token) => ({
      ...token,
      targetTokenId:
        token.type === TokenType.Team &&
        token.targetTokenId &&
        token.targetTokenId !== token.id &&
        tokenIds.has(token.targetTokenId) &&
        tokenById.get(token.targetTokenId)?.type !== TokenType.Eliminated
          ? token.targetTokenId
          : null,
    }))
  } catch {
    return []
  }
}

function isStoredPayload(value: unknown): value is { version: number; tokens: StoredToken[] } {
  if (!isRecord(value) || value.version !== STORAGE_VERSION || !Array.isArray(value.tokens)) {
    return false
  }

  return value.tokens.every(isToken)
}

function isToken(value: unknown): value is StoredToken {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    isValidCoordinates(value) &&
    (value.color === undefined || isValidColor(value.color)) &&
    (value.type === undefined || isValidTokenType(value.type)) &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    (value.targetTokenId === undefined ||
      value.targetTokenId === null ||
      (typeof value.targetTokenId === 'string' && value.targetTokenId.trim().length > 0)) &&
    (value.speed === undefined || isValidSpeed(value.speed)) &&
    (value.powerUps === undefined || isValidPowerUps(value.powerUps)) &&
    (value.trajectory === undefined ||
      (Array.isArray(value.trajectory) && value.trajectory.every(isStoredTrajectoryPoint)))
  )
}

function isStoredTrajectoryPoint(value: unknown): value is StoredTrajectoryPoint {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    isValidCoordinates(value)
  )
}

function readTransferTokens(serialized: string): TransferToken[] {
  let parsed: unknown

  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new Error('Token data is invalid JSON')
  }

  if (!isTransferPayload(parsed)) {
    throw new Error('Token data has an unsupported format')
  }

  return parsed.tokens.map((token) => {
    const type = token.type ?? TokenType.Team
    return {
    id: token.id,
    name: token.name.trim(),
    color: defaultColorForType(type),
    type,
    notes: token.notes ?? '',
    targetTokenId: token.targetTokenId ?? null,
    speed: validateSpeed(token.speed ?? DEFAULT_SPEED_KILOMETERS),
    powerUps: type === TokenType.Team || type === TokenType.Eliminated
      ? normalizePowerUps(token.powerUps)
      : [],
    trajectory: (token.trajectory ?? []).map(normalizeCoordinates),
    ...normalizeCoordinates(token),
    }
  })
}

function isTransferPayload(value: unknown): value is { version: number; tokens: TransferToken[] } {
  if (
    !isRecord(value) ||
    (value.version !== TOKEN_DATA_VERSION &&
      value.version !== PREVIOUS_TOKEN_DATA_VERSION &&
      value.version !== EARLIER_TOKEN_DATA_VERSION &&
      value.version !== LEGACY_TOKEN_DATA_VERSION) ||
    !Array.isArray(value.tokens)
  ) {
    return false
  }

  return value.tokens.every(isTransferToken)
}

function isTransferToken(value: unknown): value is TransferToken {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    isValidCoordinates(value) &&
    isValidColor(value.color) &&
    (value.type === undefined || isValidTokenType(value.type)) &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    (value.id === undefined || (typeof value.id === 'string' && value.id.trim().length > 0)) &&
    (value.targetTokenId === undefined ||
      value.targetTokenId === null ||
      (typeof value.targetTokenId === 'string' && value.targetTokenId.trim().length > 0)) &&
    (value.speed === undefined || isValidSpeed(value.speed)) &&
    (value.powerUps === undefined || isValidPowerUps(value.powerUps)) &&
    (value.trajectory === undefined ||
      (Array.isArray(value.trajectory) && value.trajectory.every(isTransferTrajectoryPoint)))
  )
}

function isTransferTrajectoryPoint(value: unknown): value is Coordinates {
  return isRecord(value) && isValidCoordinates(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateName(name: string): string {
  const trimmedName = name.trim()
  if (!trimmedName) {
    throw new Error('Token name cannot be empty')
  }

  return trimmedName
}

function defaultColorForType(type: TokenType): string {
  switch (type) {
    case TokenType.Player:
      return DEFAULT_PLAYER_COLOR
    case TokenType.PowerUp:
      return DEFAULT_POWER_UP_COLOR
    case TokenType.Eliminated:
      return DEFAULT_ELIMINATED_COLOR
    case TokenType.Team:
      return DEFAULT_TEAM_COLOR
  }
}

function validateTokenType(type: TokenType): TokenType {
  if (!isValidTokenType(type)) {
    throw new Error('Token type is invalid')
  }

  return type
}

function validateNotes(notes: string): string {
  if (typeof notes !== 'string') {
    throw new Error('Token notes must be text')
  }

  return notes
}

function validateSpeed(speed: number): number {
  if (!isValidSpeed(speed)) {
    throw new Error('Speed must be a non-negative number')
  }

  return speed
}

function isValidSpeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizePowerUps(powerUps: readonly string[] | undefined): string[] {
  return (powerUps ?? []).map((powerUp) => {
    if (typeof powerUp !== 'string' || !powerUp.trim()) {
      throw new Error('Power Up names must be non-empty text')
    }

    return powerUp.trim()
  })
}

function isValidPowerUps(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((powerUp) => (
    typeof powerUp === 'string' && powerUp.trim().length > 0
  ))
}

function isValidTokenType(value: unknown): value is TokenType {
  return (
    value === TokenType.Team ||
    value === TokenType.Player ||
    value === TokenType.PowerUp ||
    value === TokenType.Eliminated
  )
}

function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function readStoredTrajectory(points: readonly StoredTrajectoryPoint[] | undefined): TrajectoryPoint[] {
  return (points ?? []).map((point) => ({
    id: point.id,
    ...normalizeCoordinates(point),
  }))
}

function appendTrajectoryPoint(points: readonly TrajectoryPoint[], coordinates: Coordinates): TrajectoryPoint[] {
  const lastPoint = points.at(-1)
  if (lastPoint && coordinatesEqual(lastPoint, coordinates)) {
    return [...points]
  }

  return [
    ...points,
    {
      id: createTokenId(),
      ...normalizeCoordinates(coordinates),
    },
  ]
}

function coordinatesEqual(first: Coordinates, second: Coordinates): boolean {
  return first.longitude === second.longitude && first.latitude === second.latitude
}

function tokensEqual(first: readonly Token[], second: readonly Token[]): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

function cloneToken(token: Token): Token {
  return {
    ...token,
    powerUps: [...token.powerUps],
    trajectory: token.trajectory.map((point) => ({ ...point })),
  }
}

function normalizeCoordinates(coordinates: Coordinates): Coordinates {
  if (!isValidCoordinates(coordinates)) {
    throw new Error('Token coordinates are invalid')
  }

  return {
    longitude: normalizeLongitude(coordinates.longitude),
    latitude: coordinates.latitude,
  }
}

function isValidCoordinates(value: Coordinates | Record<string, unknown>): boolean {
  return (
    typeof value.longitude === 'number' &&
    typeof value.latitude === 'number' &&
    Number.isFinite(value.longitude) &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90
  )
}

function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180
}

function createTokenId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}