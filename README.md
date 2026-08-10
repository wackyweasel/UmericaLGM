# LGM Canuda

LGM Canuda is a local-first world map for placing named tokens. The map supports normal pan, zoom, rotation, and world navigation. Tokens can be created with fixed type colors, dragged, renamed, and deleted. Each move records the token's previous position as part of its editable trajectory.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Commands

```bash
npm run dev       # Start the development server
npm run test      # Run the token-store tests
npm run build     # Type-check and create a production bundle
npm run preview   # Preview the production bundle
```

## Data storage

Tokens, including their fixed type colors, and the last map view (center and zoom) are stored in the browser's `localStorage` under separate versioned keys. They stay on the current browser and origin; they are not synced between devices or users. Clearing site data removes the saved data. Invalid cached data is ignored so it cannot prevent the app from starting.

After setting up tokens, use the **x** button in the top-right of the token controls panel to hide the interface and expand the map to the full viewport. The **Controls** button in the map corner restores token management. The adjacent data menu can export tokens as versioned JSON, import pasted token data, or erase all saved app data after confirmation.

Select a token to display its past movement as a dashed line. Historical positions appear as small editable points: click a point to delete it, drag it to reposition it, or click the line to insert a new vertex. Trajectory points are included in token exports and imports.

See [Targeting and Advance Rules](TARGETING-AND-ADVANCE-RULES.md) for the complete, maintained reference for target selection, Power Up retargeting, movement, stops, collisions, and collection.

Targeting follows three automatic rules. When a Team currently targets a Power Up, every advance corrects that target to the closest available Power Up. When a new Power Up is spawned, each Team with it among its three closest eligible tokens has a 50% chance of switching to it. On every advance, each Team has an independent 10% chance of selecting a new weighted-random target. Once a Team has at least three Power Ups, its random target selection is restricted to other active Teams. A Team with at least one Power Up has an independent 10% chance of using one only when another active Team is within its configured speed radius; using it removes it from the inventory. When a Team eliminates another Team, the winner gains an `Elimination Power Up` in its inventory.

Tokens have a `Team`, `Player`, `Power Up`, or `Eliminated` type that can be changed in the token editor. Team tokens are red, Player tokens are blue, Power Up tokens are yellow, and Eliminated tokens are gray. Colors are fixed by type and cannot be edited. The global **Hide Eliminated** toggle hides Eliminated markers and their map trajectories without deleting the tokens or changing their stored data. The selected token editor also includes **Hidden Info**, which expands to a notes textbox saved with that token. Team tokens can additionally select any non-eliminated token as their `Target`; Player and Eliminated tokens do not show that field. Team tokens have editable **Speed (km)** settings, a **Power ups** inventory, and an **Advance** action. Speed defaults to 250 km; after the advance check succeeds, speed is multiplied by a random factor from 0.1 to 1 for that movement. Every advance has a fixed 50% chance of moving and a 50% chance of staying put. A Team stops at its target if the resulting distance would overshoot it. Power Up inventory entries are editable one per line in Hidden Info. When a Team reaches a Power Up target, the Power Up token is removed, its name is added to the Team inventory, and a new weighted-random target is selected automatically. An **Advance** action first selects a weighted-random target for a Team that has none; **Advance Teams** does this for all targetless Teams before resolving their movements simultaneously from the same token snapshot, so moving targets do not affect one another mid-step. A Team and its target stop moving when they are within 10 km, including when opposing movement paths would cross; when two Teams collide, one is randomly chosen as the winner, the other becomes an `Eliminated` token at its collision-stop position, and the winner receives a new weighted-random target. Eliminated tokens remain visible with their trajectory and inventory, cannot be targeted, and cannot move. When a targeted Team has Hidden Info expanded, LGM Canuda requests an OpenStreetMap-backed OSRM driving route and displays the road-following path as a dotted line. All token types retain and display their trajectory when selected.

## Canadian city table

The fixed table in `src/canadian-cities.ts` contains 761 Canadian GeoNames records from the `cities1000.zip` snapshot downloaded on 2026-08-10. It keeps populated-place records (`feature class = P`) whose recorded population is at least 10,000, including GeoNames urban-section records (`PPLX`). Each row includes the GeoNames ID, name, feature code, coordinates, and population. The table is not fetched at runtime.

The Ottawa row is available for coordinate verification (`45.41117, -75.69812`), but the app does not create a test token automatically. Erasing local data therefore leaves the token store empty after reload.

Use **Deploy team** to create one `Team` token at a city selected using the same distance-aware placement logic as Power Ups. The token is named from its city and existing tokens are kept.

GeoNames data is licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). The table is a snapshot and should be refreshed deliberately when population data needs updating.

## Map provider

The app uses [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/) with the public [OpenFreeMap](https://openfreemap.org/) Liberty style. This avoids API keys and billing for this small local tool. OpenFreeMap uses OpenStreetMap data and requires the attribution shown on the map. Its public instance does not provide an SLA, so a production deployment with availability requirements should use a supported tile provider or a self-hosted map stack.

Google Maps Platform was considered, but its JavaScript maps require a billing-enabled Google Cloud project even when usage fits within the monthly free allowance.
