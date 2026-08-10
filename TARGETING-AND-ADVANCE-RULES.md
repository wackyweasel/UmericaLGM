# Targeting and Advance Rules

This is the authoritative behavior reference for Team targeting and advancement in LGM Canuda.

**Maintenance rule:** Any change to target selection, Power Up behavior, movement, stopping, collision resolution, or either Advance action must update this file in the same change. Keep the README link to this document intact.

## Target Model

- Only `Team` tokens can have a target.
- `Player`, `Power Up`, and `Eliminated` tokens cannot have targets.
- A Team cannot target itself.
- A Team can target any other non-eliminated token: another Team, a Player, or a Power Up.
- Eliminated tokens are excluded from manual target choices and automatic target selection.
- If no eligible target exists, the Team remains targetless.

## Weighted Target Selection

When a Team selects a random target, eligible tokens are ranked by great-circle distance from the Team, from closest to farthest.

The weighted selection probabilities are geometric:

- Closest token: 50%
- Second closest: 25%
- Third closest: 12.5%
- Each later position receives half the probability of the previous position.
- Any remaining probability falls back to the closest token.

This same weighted selection is used for automatic target assignment, random target reselection, and the next target after collecting a Power Up or winning a collision. Collision winners themselves are selected uniformly at random from the Teams in the collision group.

When a Team has at least three Power Ups in its inventory, random target selection is restricted to other non-eliminated Teams. The eligible Teams are ranked by distance and use the same weighted probabilities. If no other Team exists, the random selection produces no target. This restriction applies to automatic and random reselection, collection retargeting, and collision-winner retargeting; it does not change explicit manual target choices.

## Automatic Target Changes

Target preparation happens before movement planning for both **Advance** and **Advance Teams**.

### Targetless Teams

- **Advance Teams** automatically selects targets for every targetless Team before planning movement.
- **Advance** automatically selects a target for the selected Team when it has no valid target.
- A targetless Team that is selected by the 10% reselection check can also receive a random target.

### Random Reselection

- On every Advance operation, every Team independently has a 10% chance to select a new weighted-random target.
- This check applies to both the selected-token Advance action and Advance Teams.
- The Team may select the same target again.
- The target-selection checks happen even if a Team later fails the 50% movement check.

### Power Up Use

- On every Advance operation, a Team with at least one inventory Power Up has an independent 10% chance of using one only when at least one other active Team is within that Team's configured speed in great-circle distance.
- Using a Power Up has no movement or targeting effect; it simply removes the first Power Up from that Team's list.
- The check applies to every Team during both the selected-token Advance action and Advance Teams.
- Eliminated tokens do not count as nearby Teams.
- A qualifying Team can use a Power Up even when it later fails the 50% movement check or has no available target.

### Power Up Target Priority

- If a Team currently targets a Power Up, the target is checked on every Advance operation.
- The Team must target the closest available Power Up. If another Power Up is closer than the current Power Up target, the Team switches to the closer one.
- This correction runs after the 10% random reselection phase.
- A random reselection can move a Team to a non-Power-Up target; in that case it no longer has a Power Up target to correct.

## Power Up Spawning

When the Power Up button spawns a new Power Up:

1. The spawn location is selected from Canadian cities using the existing distance-aware city placement rule.
2. Each Team is checked independently.
3. Eliminated tokens do not count as eligible nearby tokens.
4. If the new Power Up is among that Team's three closest eligible other tokens, the Team has a 50% chance of switching its target to the new Power Up.
5. Teams outside the top three keep their current target.

The three closest tokens are ranked by great-circle distance. The new Power Up does not need to be the closest of the three; being first, second, or third is enough for the 50% switch check.

## Advance Sequence

### 1. Prepare Targets

The app assigns required targetless Teams, applies the independent 10% reselection checks, and enforces closest-Power-Up targeting.

### 2. Identify Movable Teams

A Team does not request a route or move when:

- It has no valid target.
- Its target cannot be found.
- Its speed is zero.
- It is already at its target coordinates.
- It is already stopped within the target's 10 km stop range.

### 3. Movement Chance

Each otherwise eligible Team has a fixed 50% chance to move on that Advance operation:

- Random value below `0.5`: the Team moves.
- Random value of `0.5` or greater: the Team stays in place.

The selected-token Advance applies this check to the selected Team. Advance Teams applies it independently to every eligible Team.

### 4. Movement Distance

After the 50% movement check succeeds, the Team's configured speed is multiplied by a random factor from `0.1` through `1.0`.

- Default Team speed: 250 km.
- Requested distance: `speed * (0.1 + random * 0.9)`.
- A Team never overshoots its target along the route.

### 5. Route Planning

- Target routes use OSRM driving routes.
- Routes are cached using the source and target token IDs and coordinates.
- Advance Teams requests available routes concurrently.
- If a route is unavailable, that Team does not move for that operation.
- If token or target data changes while routes are being fetched, the operation is cancelled rather than committing stale plans.

### 6. Simultaneous Movement

Advance Teams plans all moving Teams from one shared token snapshot. A moving target's new position does not affect another Team's plan during the same operation.

The selected-token Advance plans and commits only the selected Team, except for the target and collision state changes required by the rules below.

## Stopping and Collisions

### 10 km Stop Rule

- A Team targeting a non-Power-Up token stops when it is within 10 km of that target.
- The target is also treated as stopped for the relevant movement calculation.
- Opposing Teams are stopped when their planned paths come within 10 km of one another, preventing them from passing through each other.
- Power Up targets are exempt from this stop rule so Teams can reach and collect them.

### Advance Teams Collisions

For simultaneous movement:

1. The planner records Team pairs whose movement paths come within 10 km.
2. Connected collision groups are resolved as one component.
3. One Team is selected uniformly at random as the winner for each component.
4. Every other Team in that component becomes an `Eliminated` token.
5. Collision losers are committed at their collision-stop positions, preserving their movement trajectory and Power Up inventory.
6. The winning Team gains one `Elimination Power Up` for each Team it eliminates in that collision component.
7. The winning Team receives a new weighted-random target.
8. Targets pointing to eliminated or collected tokens are cleared.

Eliminated tokens remain stored and visible unless **Hide Eliminated** is enabled. They cannot move, be dragged, targeted, or selected as automatic targets.

### Selected-Team Collisions

When the selected Team reaches a Team target during the selected-token Advance action:

1. One of the two Teams is chosen at random as the winner.
2. The losing Team becomes `Eliminated`.
3. The loser is retained with its collision position and trajectory data.
4. The winning Team gains one `Elimination Power Up`.
5. The winning Team receives a new weighted-random target.

## Power Up Collection

When a Team reaches a Power Up target:

- The Team's movement and collection are committed atomically.
- The Power Up token is removed from the active token list.
- The Power Up name is added to the Team's inventory.
- The Team's target is cleared and a new weighted-random target is selected automatically.
- In a simultaneous Advance Teams operation, each Power Up is collected by the first collection recorded for that step; other Teams that also reach the same removed Power Up have their cleared target reselected without receiving a duplicate inventory entry.

When a Team eliminates another Team, the winner receives an `Elimination Power Up` inventory entry. A collision component with multiple losers grants one entry for each eliminated Team.

If the selected Team is already at a Power Up target before moving, the selected-token Advance action collects it immediately and applies the same inventory and retargeting rules.

## Trajectories and Persistence

- Every committed movement records the previous position in the Team's trajectory.
- Collision losers retain their trajectory because they are changed to `Eliminated` rather than deleted.
- Power Up collection removes the Power Up token itself; the collecting Team's trajectory and inventory remain persisted.
- Target changes, movement, collection, collision outcomes, and token types are saved in local storage.
