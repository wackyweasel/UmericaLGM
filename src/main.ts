import './style.css'
import {
  ChevronsRight,
  Crosshair,
  Ellipsis,
  LockKeyhole,
  MapPinned,
  Menu,
  Moon,
  Plus,
  RotateCcw,
  Sun,
  Trash2,
  Users,
  X,
  Zap,
  createIcons,
} from 'lucide'
import { CANADIAN_CITIES } from './canadian-cities'
import { clearStoredMapView, TokenMap } from './map'
import {
  getClosestPowerUpTarget,
  getNextPowerUpName,
  hasNearbyTeamWithinSpeed,
  selectPowerUpCity,
  selectTeamsForPowerUpRetarget,
  selectTargetToken,
  shouldReselectTarget,
  shouldUsePowerUp,
} from './power-up'
import {
  advanceAlongRoute,
  fetchTargetRoute,
  getRandomAdvanceDistance,
  getStoppedTokenIds,
  getTargetRouteKey,
  resolveSimultaneousAdvances,
  resolveTeamCollisionOutcomes,
  shouldAdvance,
} from './target-route'
import {
  DEFAULT_SPEED_KILOMETERS,
  ELIMINATION_POWER_UP_NAME,
  TokenStore,
  TokenType,
  type Coordinates,
  type Token,
} from './token-store'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root was not found')
}

type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'umericalgm.theme.v1'

function readStoredTheme(): Theme {
  return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

const initialTheme = readStoredTheme()

applyTheme(initialTheme)

app.innerHTML = `
  <div class="app-shell">
    <main class="map-stage">
      <div id="map" class="map-canvas" aria-label="Interactive world map"></div>
      <button
        id="show-controls"
        class="map-only-toggle"
        type="button"
        aria-label="Show token controls"
        title="Show token controls"
        hidden
      >
        <i data-lucide="menu" aria-hidden="true"></i>
        <span>Controls</span>
      </button>

      <aside id="control-panel" class="control-panel" aria-label="Token controls">
        <header class="panel-header">
          <div class="brand-lockup">
            <span class="brand-mark" aria-hidden="true"><i data-lucide="map-pinned"></i></span>
            <div>
              <p class="eyebrow">Live game map</p>
              <h1>LGM Canuda</h1>
            </div>
          </div>
          <div class="panel-actions">
            <details id="data-menu" class="data-menu">
              <summary class="data-menu-trigger" aria-label="Open data menu" title="Data menu">
                <i data-lucide="ellipsis" aria-hidden="true"></i>
                <span class="sr-only">Data menu</span>
              </summary>
              <div class="data-menu-list">
                <button id="export-data-button" type="button">Export tokens</button>
                <button id="import-data-button" type="button">Import tokens</button>
                <button id="erase-data-button" class="menu-danger" type="button">Erase local data</button>
              </div>
            </details>
            <button
              id="theme-toggle-button"
              class="panel-toggle theme-toggle"
              type="button"
              aria-pressed="false"
              aria-label="Switch to dark mode"
              title="Switch to dark mode"
            >
              <i data-lucide="moon" class="theme-icon theme-icon--moon" aria-hidden="true"></i>
              <i data-lucide="sun" class="theme-icon theme-icon--sun" aria-hidden="true"></i>
            </button>
            <button
              id="toggle-controls"
              class="panel-toggle"
              type="button"
              aria-controls="control-panel"
              aria-expanded="true"
              aria-label="Hide controls"
              title="Hide controls"
            >
              <i data-lucide="x" aria-hidden="true"></i>
            </button>
          </div>
        </header>

        <section class="panel-block create-block">
          <div class="section-heading">
            <div>
              <p class="section-kicker">Map controls</p>
              <h2>Deploy &amp; advance</h2>
            </div>
          </div>

          <form id="new-token-form" class="token-form" novalidate>
            <label for="token-name">New token</label>
            <div class="input-action-row">
              <input
                id="token-name"
                name="token-name"
                type="text"
                maxlength="60"
                placeholder="e.g. Summer studio"
                autocomplete="off"
                required
              />
              <button class="primary-button" type="submit">
                <i data-lucide="plus" aria-hidden="true"></i>
                <span>Place token</span>
              </button>
            </div>
            <p id="token-name-error" class="form-message is-error" role="alert" hidden></p>
          </form>

          <div id="placement-status" class="placement-status" role="status" hidden>
            <span class="placement-pulse" aria-hidden="true"></span>
            <span id="placement-message"></span>
            <button id="cancel-placement" class="text-button" type="button">Cancel</button>
          </div>

          <p class="control-label">Quick actions</p>
          <div class="quick-actions">
            <button
              id="power-up-button"
              class="quick-action quick-action--power"
              type="button"
              aria-label="Place Power Up far from other tokens"
              title="Place Power Up far from other tokens"
            >
              <i data-lucide="zap" aria-hidden="true"></i>
              <span>Power Up</span>
            </button>
            <button
              id="deploy-teams-button"
              class="quick-action"
              type="button"
              aria-label="Deploy one Team token at a Canadian city"
              title="Deploy one Team token at a Canadian city"
            >
              <i data-lucide="users" aria-hidden="true"></i>
              <span>Deploy team</span>
            </button>
            <button
              id="advance-teams-button"
              class="quick-action quick-action--advance"
              type="button"
              aria-label="Advance all Team tokens"
              title="Advance all Team tokens"
            >
              <i data-lucide="chevrons-right" aria-hidden="true"></i>
              <span>Advance teams</span>
            </button>
          </div>
          <label class="visibility-toggle">
            <input id="hide-eliminated-toggle" name="hide-eliminated" type="checkbox" />
            <span>Hide eliminated tokens</span>
          </label>
        </section>

        <section id="selected-panel" class="panel-block selected-block" hidden>
          <div class="section-heading">
            <div>
              <p class="section-kicker">Selected token</p>
              <h2>Details</h2>
            </div>
          </div>

          <div class="token-form">
            <label for="selected-token-name">Name</label>
            <input id="selected-token-name" name="selected-token-name" type="text" maxlength="60" required />
            <div class="type-field">
              <label for="selected-token-type">Type</label>
              <select id="selected-token-type" name="selected-token-type">
                <option value="${TokenType.Team}">${TokenType.Team}</option>
                <option value="${TokenType.Player}">${TokenType.Player}</option>
                <option value="${TokenType.PowerUp}">${TokenType.PowerUp}</option>
                <option value="${TokenType.Eliminated}">${TokenType.Eliminated}</option>
              </select>
            </div>
            <button
              id="hidden-info-toggle"
              class="secondary-button hidden-info-toggle"
              type="button"
              aria-expanded="false"
              aria-controls="hidden-info-panel"
            >
              <i data-lucide="lock-keyhole" aria-hidden="true"></i>
              <span>Hidden info</span>
              <span class="hidden-info-chevron" aria-hidden="true">&#9662;</span>
            </button>
            <div id="hidden-info-panel" class="hidden-info-panel" hidden>
              <label for="selected-token-notes">Notes</label>
              <textarea
                id="selected-token-notes"
                name="selected-token-notes"
                maxlength="4000"
                rows="5"
                placeholder="Write notes for this token"
              ></textarea>
              <div id="target-field" class="target-field" hidden>
                <button id="select-target-button" class="secondary-button" type="button">
                  <i data-lucide="crosshair" aria-hidden="true"></i>
                  <span>Select target</span>
                </button>
                <label for="selected-token-target">Target</label>
                <select id="selected-token-target" name="selected-token-target">
                  <option value="">No target</option>
                </select>
                <label for="selected-token-speed">Speed (km)</label>
                <input
                  id="selected-token-speed"
                  name="selected-token-speed"
                  type="number"
                  min="0"
                  step="any"
                  inputmode="decimal"
                  value="${DEFAULT_SPEED_KILOMETERS}"
                />
                <label for="selected-token-power-ups">Power ups</label>
                <textarea
                  id="selected-token-power-ups"
                  name="selected-token-power-ups"
                  rows="4"
                  placeholder="One Power Up per line"
                ></textarea>
                <button id="advance-token-button" class="primary-button" type="button">Advance</button>
              </div>
            </div>
            <p id="selected-name-error" class="form-message is-error" role="alert" hidden></p>
          </div>

          <div class="detail-actions">
            <button id="clear-trajectory" class="danger-button" type="button">
              <i data-lucide="rotate-ccw" aria-hidden="true"></i>
              <span>Clear path</span>
            </button>
            <button id="delete-token" class="danger-button" type="button">
              <i data-lucide="trash-2" aria-hidden="true"></i>
              <span>Delete</span>
            </button>
          </div>
        </section>

        <p id="activity-message" class="panel-status" role="status" hidden></p>
      </aside>

      <dialog id="export-dialog" class="data-dialog" aria-labelledby="export-dialog-title">
        <form method="dialog" class="data-dialog-form">
          <h2 id="export-dialog-title">Export tokens</h2>
          <textarea id="export-data" readonly spellcheck="false" aria-label="Token data"></textarea>
          <p id="export-status" class="dialog-status" role="status" hidden></p>
          <div class="dialog-actions">
            <button id="copy-data-button" class="primary-button" type="button">Copy to clipboard</button>
            <button class="text-button" type="submit">Close</button>
          </div>
        </form>
      </dialog>

      <dialog id="import-dialog" class="data-dialog" aria-labelledby="import-dialog-title">
        <form id="import-form" class="data-dialog-form" novalidate>
          <h2 id="import-dialog-title">Import tokens</h2>
          <label for="import-data">Token data</label>
          <textarea
            id="import-data"
            spellcheck="false"
            placeholder="Paste exported token data"
            required
          ></textarea>
          <p id="import-error" class="form-message is-error" role="alert" hidden></p>
          <div class="dialog-actions">
            <button class="primary-button" type="submit">Import tokens</button>
            <button id="cancel-import" class="text-button" type="button">Cancel</button>
          </div>
        </form>
      </dialog>

      <div id="live-status" class="sr-only" role="status" aria-live="polite"></div>
    </main>
  </div>
`

createIcons({
  icons: {
    ChevronsRight,
    Crosshair,
    Ellipsis,
    LockKeyhole,
    MapPinned,
    Menu,
    Moon,
    Plus,
    RotateCcw,
    Sun,
    Trash2,
    Users,
    X,
    Zap,
  },
})

const tokenStore = new TokenStore()
const mapView = new TokenMap(document.querySelector<HTMLElement>('#map')!, {
  onMapClick: handleMapClick,
  onTokenSelect: selectToken,
  onTokenMove: moveToken,
  onTrajectoryPointMove: moveTrajectoryPoint,
  onTrajectoryPointRemove: removeTrajectoryPoint,
  onTrajectoryPointAdd: addTrajectoryPoint,
}, initialTheme)

const appShell = document.querySelector<HTMLElement>('.app-shell')!
const controlPanel = document.querySelector<HTMLElement>('#control-panel')!
const themeToggleButton = document.querySelector<HTMLButtonElement>('#theme-toggle-button')!
const toggleControlsButton = document.querySelector<HTMLButtonElement>('#toggle-controls')!
const showControlsButton = document.querySelector<HTMLButtonElement>('#show-controls')!
const dataMenu = document.querySelector<HTMLDetailsElement>('#data-menu')!
const dataMenuTrigger = dataMenu.querySelector<HTMLElement>('.data-menu-trigger')!
const dataMenuList = dataMenu.querySelector<HTMLElement>('.data-menu-list')!
const exportDataButton = document.querySelector<HTMLButtonElement>('#export-data-button')!
const importDataButton = document.querySelector<HTMLButtonElement>('#import-data-button')!
const eraseDataButton = document.querySelector<HTMLButtonElement>('#erase-data-button')!
const newTokenForm = document.querySelector<HTMLFormElement>('#new-token-form')!
const tokenNameInput = document.querySelector<HTMLInputElement>('#token-name')!
const tokenNameError = document.querySelector<HTMLParagraphElement>('#token-name-error')!
const placementStatus = document.querySelector<HTMLDivElement>('#placement-status')!
const placementMessage = document.querySelector<HTMLSpanElement>('#placement-message')!
const cancelPlacementButton = document.querySelector<HTMLButtonElement>('#cancel-placement')!
const selectedPanel = document.querySelector<HTMLElement>('#selected-panel')!
const selectedTokenNameInput = document.querySelector<HTMLInputElement>('#selected-token-name')!
const selectedTokenTypeInput = document.querySelector<HTMLSelectElement>('#selected-token-type')!
const hiddenInfoToggle = document.querySelector<HTMLButtonElement>('#hidden-info-toggle')!
const hiddenInfoPanel = document.querySelector<HTMLDivElement>('#hidden-info-panel')!
const selectedTokenNotesInput = document.querySelector<HTMLTextAreaElement>('#selected-token-notes')!
const targetField = document.querySelector<HTMLDivElement>('#target-field')!
const selectTargetButton = document.querySelector<HTMLButtonElement>('#select-target-button')!
const selectedTokenTargetInput = document.querySelector<HTMLSelectElement>('#selected-token-target')!
const selectedTokenSpeedInput = document.querySelector<HTMLInputElement>('#selected-token-speed')!
const selectedTokenPowerUpsInput = document.querySelector<HTMLTextAreaElement>(
  '#selected-token-power-ups',
)!
const advanceTokenButton = document.querySelector<HTMLButtonElement>('#advance-token-button')!
const powerUpButton = document.querySelector<HTMLButtonElement>('#power-up-button')!
const selectedNameError = document.querySelector<HTMLParagraphElement>('#selected-name-error')!
const clearTrajectoryButton = document.querySelector<HTMLButtonElement>('#clear-trajectory')!
const deleteTokenButton = document.querySelector<HTMLButtonElement>('#delete-token')!
const deployTeamsButton = document.querySelector<HTMLButtonElement>('#deploy-teams-button')!
const advanceTeamsButton = document.querySelector<HTMLButtonElement>('#advance-teams-button')!
const hideEliminatedToggle = document.querySelector<HTMLInputElement>('#hide-eliminated-toggle')!
const activityMessage = document.querySelector<HTMLParagraphElement>('#activity-message')!
const liveStatus = document.querySelector<HTMLDivElement>('#live-status')!
const placeButton = newTokenForm.querySelector<HTMLButtonElement>('button[type="submit"]')!
const exportDialog = document.querySelector<HTMLDialogElement>('#export-dialog')!
const exportDataTextarea = document.querySelector<HTMLTextAreaElement>('#export-data')!
const copyDataButton = document.querySelector<HTMLButtonElement>('#copy-data-button')!
const exportStatus = document.querySelector<HTMLParagraphElement>('#export-status')!
const importDialog = document.querySelector<HTMLDialogElement>('#import-dialog')!
const importForm = document.querySelector<HTMLFormElement>('#import-form')!
const importDataTextarea = document.querySelector<HTMLTextAreaElement>('#import-data')!
const importError = document.querySelector<HTMLParagraphElement>('#import-error')!
const cancelImportButton = document.querySelector<HTMLButtonElement>('#cancel-import')!

let selectedTokenId: string | null = null
let renderedSelectedTokenId: string | null = null
let placementName = ''
let isPlacementMode = false
let isAdvancing = false
let activeTheme = initialTheme
let hideEliminatedTokens = hideEliminatedToggle.checked
let targetRouteRequestKey: string | null = null
let targetRouteAbortController: AbortController | null = null
const targetRouteCache = new Map<string, readonly Coordinates[]>()

toggleControlsButton.addEventListener('click', () => setControlsCollapsed(true))
showControlsButton.addEventListener('click', () => setControlsCollapsed(false))
themeToggleButton.addEventListener('click', toggleTheme)
dataMenu.addEventListener('toggle', positionDataMenu)
window.addEventListener('resize', positionDataMenu)
controlPanel.addEventListener('scroll', positionDataMenu)
exportDataButton.addEventListener('click', openExportDialog)
importDataButton.addEventListener('click', openImportDialog)
eraseDataButton.addEventListener('click', eraseLocalData)
copyDataButton.addEventListener('click', copyExportData)
cancelImportButton.addEventListener('click', () => importDialog.close())
importDataTextarea.addEventListener('input', () => clearFormMessage(importError))
selectedTokenNameInput.addEventListener('input', saveSelectedTokenName)
selectedTokenTypeInput.addEventListener('change', saveSelectedTokenType)
selectedTokenNotesInput.addEventListener('input', saveSelectedTokenNotes)
selectedTokenTargetInput.addEventListener('change', saveSelectedTokenTarget)
selectedTokenSpeedInput.addEventListener('change', saveSelectedTokenSpeed)
selectedTokenPowerUpsInput.addEventListener('change', saveSelectedTokenPowerUps)
selectTargetButton.addEventListener('click', selectTarget)
advanceTokenButton.addEventListener('click', advanceSelectedToken)
hiddenInfoToggle.addEventListener('click', () => setHiddenInfoExpanded(hiddenInfoPanel.hasAttribute('hidden')))
powerUpButton.addEventListener('click', spawnPowerUp)
deployTeamsButton.addEventListener('click', deployTeams)
advanceTeamsButton.addEventListener('click', advanceTeams)
hideEliminatedToggle.addEventListener('change', () => {
  hideEliminatedTokens = hideEliminatedToggle.checked
  render(false)
})
clearTrajectoryButton.addEventListener('click', clearSelectedTrajectory)
tokenNameInput.addEventListener('input', () => clearFormMessage(tokenNameError))
updateThemeToggle(activeTheme)

newTokenForm.addEventListener('submit', (event) => {
  event.preventDefault()
  clearFormMessage(tokenNameError)

  const name = tokenNameInput.value.trim()
  if (!name) {
    showFormMessage(tokenNameError, 'Give this token a name first.')
    tokenNameInput.focus()
    return
  }

  placementName = name
  setPlacementMode(true)
})

importForm.addEventListener('submit', (event) => {
  event.preventDefault()
  clearFormMessage(importError)

  try {
    const importedTokens = tokenStore.importData(importDataTextarea.value)
    selectedTokenId = importedTokens[0]?.id ?? null
    render()
    importDialog.close()
    announce(`Imported ${importedTokens.length} token${importedTokens.length === 1 ? '' : 's'}.`)
  } catch (error) {
    showFormMessage(importError, getErrorMessage(error))
  }
})

cancelPlacementButton.addEventListener('click', () => {
  setPlacementMode(false)
  tokenNameInput.focus()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isPlacementMode) {
    setPlacementMode(false)
    tokenNameInput.focus()
  }
})

deleteTokenButton.addEventListener('click', () => {
  if (!selectedTokenId) {
    return
  }

  const selectedToken = getSelectedToken(tokenStore.list())
  if (!selectedToken || !window.confirm(`Delete ${selectedToken.name}?`)) {
    return
  }

  try {
    tokenStore.remove(selectedToken.id)
    selectedTokenId = null
    render()
    announce(`Deleted ${selectedToken.name}.`)
    showActivity('Token deleted.')
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
})

function clearSelectedTrajectory(): void {
  if (!selectedTokenId) {
    return
  }

  const selectedToken = getSelectedToken(tokenStore.list())
  if (!selectedToken || selectedToken.trajectory.length === 0) {
    return
  }

  if (!window.confirm(`Clear the trajectory for ${selectedToken.name}? This cannot be undone.`)) {
    return
  }

  try {
    tokenStore.clearTrajectory(selectedToken.id)
    render()
    announce(`${selectedToken.name} trajectory cleared.`)
    showActivity('Trajectory cleared locally.')
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function handleMapClick(coordinates: Coordinates): void {
  if (!isPlacementMode) {
    selectedTokenId = null
    activityMessage.hidden = true
    ;(document.activeElement as HTMLElement | null)?.blur()
    render()
    return
  }

  try {
    const token = tokenStore.create(placementName, coordinates)
    selectedTokenId = token.id
    tokenNameInput.value = ''
    setPlacementMode(false)
    render()
    showActivity(`Placed ${token.name} locally.`)
    announce(`${token.name} placed and saved.`)
    selectedTokenNameInput.focus()
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function selectToken(tokenId: string): void {
  selectedTokenId = tokenId
  render()
  const selectedToken = getSelectedToken(tokenStore.list())
  if (selectedToken) {
    announce(`${selectedToken.name} selected.`)
    showActivity(`${selectedToken.name} selected.`)
  }
}

function moveToken(tokenId: string, coordinates: Coordinates): void {
  try {
    const token = tokenStore.move(tokenId, coordinates)
    selectedTokenId = tokenId
    render()
    showActivity('Position saved locally.')
    announce(`${token.name} moved.`)
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function moveTrajectoryPoint(tokenId: string, pointId: string, coordinates: Coordinates): void {
  try {
    tokenStore.moveTrajectoryPoint(tokenId, pointId, coordinates)
    render()
    announce('Trajectory point moved.')
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function removeTrajectoryPoint(tokenId: string, pointId: string): void {
  try {
    tokenStore.removeTrajectoryPoint(tokenId, pointId)
    render()
    announce('Trajectory point deleted.')
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function addTrajectoryPoint(tokenId: string, insertIndex: number, coordinates: Coordinates): void {
  try {
    tokenStore.addTrajectoryPoint(tokenId, coordinates, insertIndex)
    render()
    announce('Trajectory point added.')
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function spawnPowerUp(): void {
  const tokens = tokenStore.list()
  const city = selectPowerUpCity(CANADIAN_CITIES, tokens)
  if (!city) {
    showActivity('No Canadian cities are available.', true)
    return
  }

  try {
    if (isPlacementMode) {
      setPlacementMode(false)
    }

    const token = tokenStore.create(getNextPowerUpName(tokens), {
      longitude: city.longitude,
      latitude: city.latitude,
    }, undefined, TokenType.PowerUp)
    const retargetedTeams = retargetTeamsForSpawnedPowerUp(token.id)
    selectedTokenId = token.id
    render()
    const targetMessage = retargetedTeams > 0
      ? ` Selected ${retargetedTeams} new target${retargetedTeams === 1 ? '' : 's'}.`
      : ''
    showActivity(`Power Up placed in ${city.name}.${targetMessage}`)
    announce(`Power Up placed in ${city.name}.${targetMessage}`)
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function deployTeams(): void {
  const city = selectPowerUpCity(CANADIAN_CITIES, tokenStore.list())
  if (!city) {
    showActivity('No Canadian cities are available.', true)
    return
  }

  try {
    if (isPlacementMode) {
      setPlacementMode(false)
    }

    const token = tokenStore.create(city.name, {
      longitude: city.longitude,
      latitude: city.latitude,
    }, undefined, TokenType.Team)
    selectedTokenId = token.id
    render()
    showActivity(`Team token placed in ${city.name}.`)
    announce(`Team token placed in ${city.name}.`)
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

async function advanceTeams(): Promise<void> {
  if (isAdvancing) {
    return
  }

  let snapshot: Token[]
  let selectedTargetCount = 0
  let usedPowerUpCount = 0
  try {
    const initialSnapshot = tokenStore.list()
    const targetlessTeamIds = initialSnapshot
      .filter((token) => token.type === TokenType.Team && token.targetTokenId === null)
      .map((token) => token.id)
    const preparation = prepareAdvanceTargets(targetlessTeamIds)
    snapshot = preparation.tokens
    selectedTargetCount = preparation.targetChangeCount
    usedPowerUpCount = preparation.usedPowerUpCount
  } catch (error) {
    showActivity(getErrorMessage(error), true)
    return
  }

  const teamTokens = snapshot.filter((token) => token.type === TokenType.Team)
  if (teamTokens.length === 0) {
    return
  }

  const tokenById = new Map(snapshot.map((token) => [token.id, token]))
  const stoppedTokenIds = getStoppedTokenIds(snapshot)
  const advancingTokenIds = new Set<string>()
  const advanceDistances = new Map<string, number>()
  const routeRequests = teamTokens.flatMap((teamToken) => {
    const targetToken = teamToken.targetTokenId ? tokenById.get(teamToken.targetTokenId) : undefined
    if (
      !targetToken ||
      stoppedTokenIds.has(teamToken.id) ||
      teamToken.speed <= 0 ||
      (teamToken.longitude === targetToken.longitude && teamToken.latitude === targetToken.latitude)
    ) {
      return []
    }

    if (!shouldAdvance()) {
      return []
    }

    advancingTokenIds.add(teamToken.id)
    advanceDistances.set(teamToken.id, getRandomAdvanceDistance(teamToken.speed))

    return [{
      key: getTargetRouteKey(teamToken, targetToken),
      source: teamToken,
      target: targetToken,
    }]
  })

  isAdvancing = true
  advanceTeamsButton.disabled = true

  try {
    const routes = new Map<string, readonly Coordinates[]>()
    let unavailableRoutes = 0
    const routeResults = await Promise.all(
      routeRequests.map(async ({ key, source, target }) => {
        const cachedRoute = targetRouteCache.get(key)
        if (cachedRoute) {
          return { key, route: cachedRoute, unavailable: false }
        }

        try {
          const route = await fetchTargetRoute(source, target)
          targetRouteCache.set(key, route)
          return { key, route, unavailable: false }
        } catch {
          return { key, route: undefined, unavailable: true }
        }
      }),
    )

    for (const result of routeResults) {
      if (result.route) {
        routes.set(result.key, result.route)
      }
      if (result.unavailable) {
        unavailableRoutes += 1
      }
    }

    if (!matchesTokenSnapshot(snapshot, tokenStore.list())) {
      showActivity('Advance cancelled because a token or target changed.', true)
      return
    }

    const plans = resolveSimultaneousAdvances(
      snapshot,
      routes,
      Math.random,
      advancingTokenIds,
      advanceDistances,
    )
    const collisionResolution = resolveTeamCollisionOutcomes(plans, snapshot)
    const losingTeamIds = new Set(collisionResolution.loserIds)
    const collectionsByPowerUp = new Map<string, { teamId: string; powerUpId: string }>()
    const collectedTeamIds = new Set<string>()
    for (const plan of plans) {
      if (losingTeamIds.has(plan.tokenId)) {
        continue
      }

      const targetToken = tokenById.get(plan.targetTokenId)
      if (!plan.reachedTarget || targetToken?.type !== TokenType.PowerUp) {
        continue
      }

      collectedTeamIds.add(plan.tokenId)
      if (!collectionsByPowerUp.has(targetToken.id)) {
        collectionsByPowerUp.set(targetToken.id, { teamId: plan.tokenId, powerUpId: targetToken.id })
      }
    }

    const retargetTeamIds = new Set([...collisionResolution.winnerIds, ...collectedTeamIds])
    const eliminationRewards = collisionResolution.eliminations.flatMap(({ winnerId, loserIds }) =>
      loserIds.map(() => ({ teamId: winnerId, powerUpName: ELIMINATION_POWER_UP_NAME })),
    )
    tokenStore.moveMany(
      plans.map((plan) => ({ id: plan.tokenId, coordinates: plan.coordinates })),
      [...collectionsByPowerUp.values()],
      collisionResolution.loserIds,
      eliminationRewards,
    )
    const retargetedTeams = retargetTeams([...retargetTeamIds])
    const tokenLabel = plans.length === 1 ? 'Team token' : 'Team tokens'
    const routeMessage = unavailableRoutes > 0
      ? ` ${unavailableRoutes} route${unavailableRoutes === 1 ? '' : 's'} unavailable.`
      : ''
    const collisionMessage = collisionResolution.loserIds.length > 0
      ? ` ${collisionResolution.loserIds.length} Team${collisionResolution.loserIds.length === 1 ? '' : 's'} lost a collision and ${collisionResolution.loserIds.length === 1 ? 'was' : 'were'} eliminated.`
      : ''
    const collectionMessage = collectionsByPowerUp.size > 0
      ? ` Collected ${collectionsByPowerUp.size} Power Up${collectionsByPowerUp.size === 1 ? '' : 's'}.`
      : ''
    const usedPowerUpMessage = usedPowerUpCount > 0
      ? ` Used ${usedPowerUpCount} Power Up${usedPowerUpCount === 1 ? '' : 's'}.`
      : ''
    const selectedTargets = selectedTargetCount + retargetedTeams
    const targetMessage = selectedTargets > 0
      ? ` Selected ${selectedTargets} target${selectedTargets === 1 ? '' : 's'}.`
      : ''
    showActivity(`Advanced ${plans.length} ${tokenLabel}.${collisionMessage}${collectionMessage}${usedPowerUpMessage}${targetMessage}${routeMessage}`)
    announce(`Advanced ${plans.length} ${tokenLabel}.${collisionMessage}${collectionMessage}${usedPowerUpMessage}${targetMessage}`)
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  } finally {
    isAdvancing = false
    render(false)
  }
}

function matchesTokenSnapshot(snapshot: readonly Token[], currentTokens: readonly Token[]): boolean {
  if (snapshot.length !== currentTokens.length) {
    return false
  }

  const currentById = new Map(currentTokens.map((token) => [token.id, token]))
  return snapshot.every((token) => {
    const currentToken = currentById.get(token.id)
    return (
      currentToken?.type === token.type &&
      currentToken.targetTokenId === token.targetTokenId &&
      currentToken.speed === token.speed &&
      powerUpsEqual(currentToken.powerUps, token.powerUps) &&
      currentToken.longitude === token.longitude &&
      currentToken.latitude === token.latitude
    )
  })
}

function powerUpsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((powerUp, index) => powerUp === right[index])
}

function setPlacementMode(isActive: boolean): void {
  isPlacementMode = isActive
  mapView.setPlacementMode(isActive)
  tokenNameInput.disabled = isActive
  placeButton.disabled = isActive
  cancelPlacementButton.hidden = !isActive
  placementStatus.hidden = !isActive

  if (isActive) {
    placementMessage.textContent = `Click the map to place "${placementName}".`
    announce(`Placement mode active for ${placementName}.`)
  } else {
    placementName = ''
  }
}

function setControlsCollapsed(isCollapsed: boolean): void {
  if (isCollapsed && isPlacementMode) {
    setPlacementMode(false)
  }

  const label = isCollapsed ? 'Show controls' : 'Hide controls'
  appShell.classList.toggle('is-map-only', isCollapsed)
  toggleControlsButton.setAttribute('aria-expanded', String(!isCollapsed))
  toggleControlsButton.setAttribute('aria-label', label)
  toggleControlsButton.title = label
  showControlsButton.hidden = !isCollapsed

  if (isCollapsed) {
    showControlsButton.focus()
  } else {
    toggleControlsButton.focus()
  }
}

function toggleTheme(): void {
  activeTheme = activeTheme === 'light' ? 'dark' : 'light'
  applyTheme(activeTheme)
  mapView.setTheme(activeTheme)
  window.localStorage.setItem(THEME_STORAGE_KEY, activeTheme)
  updateThemeToggle(activeTheme)
}

function updateThemeToggle(theme: Theme): void {
  const isDark = theme === 'dark'
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'

  themeToggleButton.setAttribute('aria-pressed', String(isDark))
  themeToggleButton.setAttribute('aria-label', label)
  themeToggleButton.title = label
}

function openExportDialog(): void {
  dataMenu.open = false
  exportDataTextarea.value = tokenStore.exportData()
  exportStatus.hidden = true
  exportDialog.showModal()
}

function positionDataMenu(): void {
  if (!dataMenu.open) {
    return
  }

  const triggerRect = dataMenuTrigger.getBoundingClientRect()
  const menuWidth = dataMenuList.offsetWidth
  const menuHeight = dataMenuList.offsetHeight
  const viewportPadding = 8
  const menuGap = 6
  const opensBelow = triggerRect.bottom + menuGap + menuHeight <= window.innerHeight - viewportPadding
  const top = opensBelow
    ? triggerRect.bottom + menuGap
    : Math.max(viewportPadding, triggerRect.top - menuHeight - menuGap)
  const left = Math.min(
    Math.max(viewportPadding, triggerRect.right - menuWidth),
    window.innerWidth - menuWidth - viewportPadding,
  )

  dataMenuList.style.top = `${top}px`
  dataMenuList.style.left = `${left}px`
}

function openImportDialog(): void {
  dataMenu.open = false
  importDataTextarea.value = ''
  clearFormMessage(importError)
  importDialog.showModal()
  importDataTextarea.focus()
}

async function copyExportData(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportDataTextarea.value)
    exportStatus.textContent = 'Copied to clipboard.'
    exportStatus.hidden = false
  } catch {
    exportStatus.textContent = 'Copy failed. Select the text and copy it manually.'
    exportStatus.hidden = false
    exportDataTextarea.focus()
    exportDataTextarea.select()
  }
}

function eraseLocalData(): void {
  dataMenu.open = false
  if (!window.confirm('Erase all saved tokens and the saved map view?')) {
    return
  }

  try {
    tokenStore.clear()
    clearStoredMapView()
    window.location.reload()
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function setHiddenInfoExpanded(isExpanded: boolean): void {
  hiddenInfoPanel.hidden = !isExpanded
  hiddenInfoToggle.setAttribute('aria-expanded', String(isExpanded))
  const chevron = hiddenInfoToggle.querySelector<HTMLSpanElement>('.hidden-info-chevron')
  if (chevron) {
    chevron.textContent = isExpanded ? '\u25b2' : '\u25bc'
  }
  updateTargetRoute()
}

function updateTargetRoute(): void {
  const tokens = tokenStore.list()
  const selectedToken = getSelectedToken(tokens)
  const targetTokenId = selectedToken?.targetTokenId
  const targetToken = targetTokenId
    ? tokens.find((token) => token.id === targetTokenId)
    : undefined

  if (hiddenInfoPanel.hidden || selectedToken?.type !== TokenType.Team || !targetToken) {
    clearTargetRoute()
    return
  }

  const routeKey = getTargetRouteKey(selectedToken, targetToken)
  const cachedRoute = targetRouteCache.get(routeKey)
  if (cachedRoute) {
    cancelTargetRouteRequest()
    mapView.setTargetRoute(cachedRoute)
    return
  }

  if (targetRouteRequestKey === routeKey) {
    return
  }

  cancelTargetRouteRequest()
  const controller = new AbortController()
  targetRouteAbortController = controller
  targetRouteRequestKey = routeKey
  mapView.setTargetRoute(null)

  void fetchTargetRoute(selectedToken, targetToken, controller.signal)
    .then((route) => {
      if (targetRouteRequestKey !== routeKey || controller.signal.aborted) {
        return
      }

      targetRouteCache.set(routeKey, route)
      mapView.setTargetRoute(route)
    })
    .catch((error: unknown) => {
      if (targetRouteRequestKey !== routeKey || controller.signal.aborted) {
        return
      }

      mapView.setTargetRoute(null)
      showActivity(error instanceof Error ? error.message : 'Could not load the road route.', true)
    })
    .finally(() => {
      if (targetRouteRequestKey === routeKey) {
        targetRouteRequestKey = null
        targetRouteAbortController = null
      }
    })
}

function clearTargetRoute(): void {
  cancelTargetRouteRequest()
  mapView.setTargetRoute(null)
}

function cancelTargetRouteRequest(): void {
  targetRouteRequestKey = null
  targetRouteAbortController?.abort()
  targetRouteAbortController = null
}

function saveSelectedTokenName(): void {
  clearFormMessage(selectedNameError)
  const selectedToken = getSelectedToken(tokenStore.list())
  if (!selectedToken) {
    return
  }

  const nextName = selectedTokenNameInput.value.trim()
  if (!nextName) {
    showFormMessage(selectedNameError, 'Token name cannot be empty')
    return
  }

  if (nextName === selectedToken.name) {
    return
  }

  try {
    tokenStore.rename(selectedToken.id, nextName)
    render(false)
  } catch (error) {
    showFormMessage(selectedNameError, getErrorMessage(error))
  }
}

function saveSelectedTokenType(): void {
  const selectedToken = getSelectedToken(tokenStore.list())
  if (!selectedToken) {
    return
  }

  const nextType = selectedTokenTypeInput.value === TokenType.PowerUp
    ? TokenType.PowerUp
    : selectedTokenTypeInput.value === TokenType.Player
      ? TokenType.Player
      : selectedTokenTypeInput.value === TokenType.Eliminated
        ? TokenType.Eliminated
        : TokenType.Team
  if (nextType === selectedToken.type) {
    return
  }

  try {
    tokenStore.setType(selectedToken.id, nextType)
    render(false)
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function saveSelectedTokenNotes(): void {
  if (!selectedTokenId) {
    return
  }

  const selectedToken = getSelectedToken(tokenStore.list())
  if (!selectedToken) {
    return
  }

  try {
    if (selectedTokenNotesInput.value !== selectedToken.notes) {
      tokenStore.setNotes(selectedToken.id, selectedTokenNotesInput.value)
    }
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function saveSelectedTokenTarget(): void {
  const tokens = tokenStore.list()
  const selectedToken = getSelectedToken(tokens)
  if (!selectedToken || selectedToken.type !== TokenType.Team) {
    return
  }

  const targetTokenId = selectedTokenTargetInput.value || null
  if (targetTokenId === selectedToken.targetTokenId) {
    return
  }

  try {
    tokenStore.setTarget(selectedToken.id, targetTokenId)
    render(false)
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function saveSelectedTokenSpeed(): void {
  const selectedToken = getSelectedToken(tokenStore.list())
  if (!selectedToken || selectedToken.type !== TokenType.Team) {
    return
  }

  const value = selectedTokenSpeedInput.value.trim()
  if (!value) {
    selectedTokenSpeedInput.value = String(selectedToken.speed)
    showActivity('Speed must be a non-negative number.', true)
    return
  }

  const nextSpeed = Number(value)
  if (nextSpeed === selectedToken.speed) {
    return
  }

  try {
    tokenStore.setSpeed(selectedToken.id, nextSpeed)
    render(false)
  } catch (error) {
    selectedTokenSpeedInput.value = String(selectedToken.speed)
    showActivity(getErrorMessage(error), true)
  }
}

function saveSelectedTokenPowerUps(): void {
  const selectedToken = getSelectedToken(tokenStore.list())
  if (!selectedToken || selectedToken.type !== TokenType.Team) {
    return
  }

  const powerUps = selectedTokenPowerUpsInput.value
    .split(/\r?\n/)
    .map((powerUp) => powerUp.trim())
    .filter(Boolean)

  try {
    const updatedToken = tokenStore.setPowerUps(selectedToken.id, powerUps)
    selectedTokenPowerUpsInput.value = updatedToken.powerUps.join('\n')
    render(false)
  } catch (error) {
    selectedTokenPowerUpsInput.value = selectedToken.powerUps.join('\n')
    showActivity(getErrorMessage(error), true)
  }
}

function selectTarget(): void {
  const selectedToken = getSelectedToken(tokenStore.list())
  if (!selectedToken || selectedToken.type !== TokenType.Team) {
    return
  }

  try {
    const targetToken = retargetTeam(selectedToken.id)
    if (!targetToken) {
      return
    }

    render(false)
    showActivity(`Target selected: ${targetToken.name}.`)
    announce(`Target selected: ${targetToken.name}.`)
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  }
}

function retargetTeam(
  teamId: string,
): Pick<Token, 'id' | 'name' | 'longitude' | 'latitude'> | undefined {
  const tokens = tokenStore.list()
  const teamToken = tokens.find((token) => token.id === teamId)
  if (!teamToken || teamToken.type !== TokenType.Team) {
    return undefined
  }

  const targetToken = selectTargetToken(teamToken, tokens)
  if (targetToken?.id !== teamToken.targetTokenId) {
    tokenStore.setTarget(teamToken.id, targetToken?.id ?? null)
  }
  return targetToken
}

function collectPowerUpForTeam(
  teamId: string,
  powerUpId: string,
  coordinates?: Coordinates,
): Pick<Token, 'id' | 'name' | 'longitude' | 'latitude'> | undefined {
  tokenStore.moveMany(
    coordinates ? [{ id: teamId, coordinates }] : [],
    [{ teamId, powerUpId }],
  )
  return retargetTeam(teamId)
}

function retargetTeams(teamIds: readonly string[]): number {
  let retargetedTeams = 0
  for (const teamId of teamIds) {
    if (retargetTeam(teamId)) {
      retargetedTeams += 1
    }
  }
  return retargetedTeams
}

function retargetTeamsForSpawnedPowerUp(powerUpId: string): number {
  const tokens = tokenStore.list()
  const powerUp = tokens.find((token) => token.id === powerUpId && token.type === TokenType.PowerUp)
  if (!powerUp) {
    return 0
  }

  let retargetedTeams = 0
  for (const team of selectTeamsForPowerUpRetarget(
    powerUp,
    tokens.filter((token) => token.type === TokenType.Team),
    tokens,
  )) {
    tokenStore.setTarget(team.id, powerUp.id)
    retargetedTeams += 1
  }

  return retargetedTeams
}

function prepareAdvanceTargets(targetlessTeamIds: readonly string[]): {
  tokens: Token[]
  targetChangeCount: number
  usedPowerUpCount: number
} {
  let targetChangeCount = retargetTeams(targetlessTeamIds)
  let tokens = tokenStore.list()
  let usedPowerUpCount = 0
  const randomlyRetargetedTeamIds: string[] = []

  for (const team of tokens) {
    if (
      team.type === TokenType.Team &&
      team.powerUps.length > 0 &&
      hasNearbyTeamWithinSpeed(team, tokens) &&
      shouldUsePowerUp()
    ) {
      tokenStore.usePowerUp(team.id)
      usedPowerUpCount += 1
    }

    if (team.type === TokenType.Team && shouldReselectTarget()) {
      randomlyRetargetedTeamIds.push(team.id)
    }
  }

  for (const teamId of randomlyRetargetedTeamIds) {
    const previousTargetId = tokens.find((token) => token.id === teamId)?.targetTokenId
    const target = retargetTeam(teamId)
    if (target?.id !== previousTargetId) {
      targetChangeCount += 1
    }
  }

  tokens = tokenStore.list()
  for (const team of tokens) {
    if (team.type !== TokenType.Team || !team.targetTokenId) {
      continue
    }

    const currentTarget = tokens.find((token) => token.id === team.targetTokenId)
    if (currentTarget?.type !== TokenType.PowerUp) {
      continue
    }

    const closestPowerUp = getClosestPowerUpTarget(team, tokens)
    if (closestPowerUp && closestPowerUp.id !== currentTarget.id) {
      tokenStore.setTarget(team.id, closestPowerUp.id)
      targetChangeCount += 1
    }
  }

  return { tokens: tokenStore.list(), targetChangeCount, usedPowerUpCount }
}

async function advanceSelectedToken(): Promise<void> {
  if (isAdvancing) {
    return
  }

  let tokens = tokenStore.list()
  let selectedToken = getSelectedToken(tokens)
  let usedPowerUpCount = 0
  if (!selectedToken || selectedToken.type !== TokenType.Team) {
    return
  }

  try {
    const initialTargetId = selectedToken.targetTokenId
    const initialTarget = initialTargetId
      ? tokens.find((token) => token.id === initialTargetId)
      : undefined
    const preparation = prepareAdvanceTargets(
      !initialTarget ? [selectedToken.id] : [],
    )
    tokens = preparation.tokens
    usedPowerUpCount = preparation.usedPowerUpCount
    selectedToken = getSelectedToken(tokens)
  } catch (error) {
    showActivity(getErrorMessage(error), true)
    return
  }

  const targetTokenId = selectedToken?.targetTokenId
  const targetToken = targetTokenId
    ? tokens.find((token) => token.id === targetTokenId)
    : undefined
  if (!selectedToken || selectedToken.type !== TokenType.Team || !targetToken) {
    if (selectedToken) {
      render(false)
      const usedPowerUpMessage = usedPowerUpCount > 0
        ? ` Used ${usedPowerUpCount} Power Up${usedPowerUpCount === 1 ? '' : 's'}.`
        : ''
      showActivity(`${selectedToken.name} has no available target.${usedPowerUpMessage}`)
      announce(`${selectedToken.name} has no available target.${usedPowerUpMessage}`)
    }
    return
  }

  if (
    selectedToken.longitude === targetToken.longitude &&
    selectedToken.latitude === targetToken.latitude
  ) {
    if (targetToken.type === TokenType.PowerUp) {
      try {
        const newTarget = collectPowerUpForTeam(selectedToken.id, targetToken.id)
        render(false)
        const targetMessage = newTarget ? ` New target: ${newTarget.name}.` : ' No target available.'
        showActivity(`${selectedToken.name} collected ${targetToken.name}.${targetMessage}`)
        announce(`${selectedToken.name} collected ${targetToken.name}.${targetMessage}`)
      } catch (error) {
        showActivity(getErrorMessage(error), true)
      }
      return
    }

    showActivity(`${selectedToken.name} is already at its target.`)
    announce(`${selectedToken.name} is already at its target.`)
    return
  }

  if (getStoppedTokenIds(tokens).has(selectedToken.id)) {
    showActivity(`${selectedToken.name} is within 10 km of its target and is stopped.`)
    announce(`${selectedToken.name} is within 10 km of its target and is stopped.`)
    return
  }

  isAdvancing = true
  advanceTokenButton.disabled = true

  try {
    if (!shouldAdvance()) {
      const usedPowerUpMessage = usedPowerUpCount > 0
        ? ` Used ${usedPowerUpCount} Power Up${usedPowerUpCount === 1 ? '' : 's'}.`
        : ''
      showActivity(`${selectedToken.name} did not advance.${usedPowerUpMessage}`)
      announce(`${selectedToken.name} did not advance.${usedPowerUpMessage}`)
      return
    }

    const advanceDistance = getRandomAdvanceDistance(selectedToken.speed)

    const routeKey = getTargetRouteKey(selectedToken, targetToken)
    const route = targetRouteCache.get(routeKey) ?? (await fetchTargetRoute(selectedToken, targetToken))
    targetRouteCache.set(routeKey, route)

    const latestTokens = tokenStore.list()
    const latestToken = latestTokens.find((token) => token.id === selectedToken.id)
    const latestTarget = latestTokens.find((token) => token.id === targetToken.id)
    if (
      !latestToken ||
      !latestTarget ||
      latestToken.targetTokenId !== latestTarget.id ||
      latestToken.speed !== selectedToken.speed ||
      latestToken.longitude !== selectedToken.longitude ||
      latestToken.latitude !== selectedToken.latitude ||
      latestTarget.longitude !== targetToken.longitude ||
      latestTarget.latitude !== targetToken.latitude
    ) {
      showActivity('Advance cancelled because the token or target changed.', true)
      return
    }

    const advance = advanceAlongRoute(route, advanceDistance)
    if (
      advance.coordinates.longitude === latestToken.longitude &&
      advance.coordinates.latitude === latestToken.latitude
    ) {
      showActivity(`${latestToken.name} is already at its target.`)
      announce(`${latestToken.name} is already at its target.`)
      return
    }

    if (advance.reachedTarget && latestTarget.type === TokenType.Team) {
      const winnerId = Math.random() < 0.5 ? latestToken.id : latestTarget.id
      const loserId = winnerId === latestToken.id ? latestTarget.id : latestToken.id
      const winnerName = winnerId === latestToken.id ? latestToken.name : latestTarget.name
      const loserName = loserId === latestToken.id ? latestToken.name : latestTarget.name
      tokenStore.moveMany(
        [{ id: latestToken.id, coordinates: advance.coordinates }],
        [],
        [loserId],
        [{ teamId: winnerId, powerUpName: ELIMINATION_POWER_UP_NAME }],
      )
      const newTarget = retargetTeam(winnerId)
      render(false)
      const targetMessage = newTarget ? ` New target: ${newTarget.name}.` : ' No target available.'
      showActivity(`${winnerName} won the collision. ${loserName} was eliminated.${targetMessage}`)
      announce(`${winnerName} won the collision. ${loserName} was eliminated.${targetMessage}`)
      return
    }

    const reachedPowerUp = advance.reachedTarget && latestTarget.type === TokenType.PowerUp
    const newTarget = reachedPowerUp
      ? collectPowerUpForTeam(latestToken.id, latestTarget.id, advance.coordinates)
      : undefined
    if (!reachedPowerUp) {
      tokenStore.move(latestToken.id, advance.coordinates)
    }
    const distanceLabel = Math.round(advance.distanceTravelledKilometers)
    if (reachedPowerUp) {
      const targetMessage = newTarget ? ` New target: ${newTarget.name}.` : ' No target available.'
      showActivity(`${latestToken.name} collected ${latestTarget.name}.${targetMessage}`)
      announce(`${latestToken.name} collected ${latestTarget.name}.${targetMessage}`)
    } else if (advance.reachedTarget) {
      showActivity(`${latestToken.name} reached ${latestTarget.name}.`)
      announce(`${latestToken.name} reached ${latestTarget.name}.`)
    } else {
      showActivity(`${latestToken.name} advanced ${distanceLabel} km toward ${latestTarget.name}.`)
      announce(`${latestToken.name} advanced ${distanceLabel} km toward ${latestTarget.name}.`)
    }
  } catch (error) {
    showActivity(getErrorMessage(error), true)
  } finally {
    isAdvancing = false
    render(false)
  }
}

function populateTargetOptions(tokens: readonly Token[], selectedToken: Token | undefined): void {
  const isTeam = selectedToken?.type === TokenType.Team
  targetField.hidden = !isTeam
  selectTargetButton.disabled = !isTeam || tokens.length <= 1
  selectedTokenTargetInput.disabled = !isTeam
  selectedTokenSpeedInput.disabled = !isTeam
  selectedTokenPowerUpsInput.disabled = !isTeam
  advanceTokenButton.disabled =
    !isTeam || !selectedToken?.targetTokenId || tokens.length <= 1 || isAdvancing
  selectedTokenTargetInput.replaceChildren()

  if (!isTeam || !selectedToken) {
    return
  }

  const noTargetOption = document.createElement('option')
  noTargetOption.value = ''
  noTargetOption.textContent = 'No target'
  selectedTokenTargetInput.append(noTargetOption)

  for (const token of tokens) {
    if (token.id === selectedToken.id || token.type === TokenType.Eliminated) {
      continue
    }

    const option = document.createElement('option')
    option.value = token.id
    option.textContent = token.name
    selectedTokenTargetInput.append(option)
  }

  selectedTokenTargetInput.value = selectedToken.targetTokenId ?? ''
  selectedTokenTargetInput.disabled = tokens.length <= 1
}

function render(syncSelectedEditor = true): void {
  const tokens = tokenStore.list()
  const selectedToken = getSelectedToken(tokens)
  advanceTeamsButton.disabled = isAdvancing || !tokens.some((token) => token.type === TokenType.Team)

  if (!selectedToken) {
    selectedTokenId = null
  }

  if (selectedTokenId !== renderedSelectedTokenId) {
    setHiddenInfoExpanded(false)
    renderedSelectedTokenId = selectedTokenId
  }

  const visibleTokens = hideEliminatedTokens
    ? tokens.filter((token) => token.type !== TokenType.Eliminated)
    : tokens
  mapView.render(visibleTokens, selectedTokenId)
  selectedPanel.hidden = !selectedToken
  populateTargetOptions(tokens, selectedToken)

  if (selectedToken && syncSelectedEditor) {
    selectedTokenNameInput.value = selectedToken.name
    selectedTokenTypeInput.value = selectedToken.type
    selectedTokenNotesInput.value = selectedToken.notes
    selectedTokenSpeedInput.value = String(selectedToken.speed)
    selectedTokenPowerUpsInput.value = selectedToken.powerUps.join('\n')
  }

  clearTrajectoryButton.disabled = !selectedToken || selectedToken.trajectory.length === 0
  mapView.setTrajectoryVisible(selectedToken?.id ?? null)
  updateTargetRoute()
}

function getSelectedToken(tokens: readonly Token[]): Token | undefined {
  return tokens.find((token) => token.id === selectedTokenId)
}

function showFormMessage(element: HTMLElement, message: string): void {
  element.textContent = message
  element.hidden = false
}

function clearFormMessage(element: HTMLElement): void {
  element.textContent = ''
  element.hidden = true
}

function showActivity(message: string, isError = false): void {
  activityMessage.textContent = message
  activityMessage.hidden = !isError
  activityMessage.classList.toggle('is-error', isError)
}

function announce(message: string): void {
  liveStatus.textContent = ''
  window.setTimeout(() => {
    liveStatus.textContent = message
  }, 0)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

render()
