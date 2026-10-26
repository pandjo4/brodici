# DEPTH CHARGE — Battleship Multiplayer

A two-player, real-time Battleship game with private lobby codes, 10×10 boards, energy and tactical abilities.

## Deploy (GitHub + Render)
1. Create a new GitHub repository.
2. Upload the contents of this ZIP (the `package.json`, `server.js`, `render.yaml`, and `public` folder must be at the repository root).
3. In Render, choose **New + → Blueprint** and select the repository. Render reads `render.yaml`.
   - Alternatively create a **Web Service** from the repository, runtime **Node**, build command `npm install`, start command `npm start`.
4. Wait for deploy. Open the Render URL. Both players use the same URL, but each opens it in their own browser/device.
5. Player 1 clicks **Create lobby** and shares the 6-character code. Player 2 enters the code and clicks **Join lobby**.

## Rules
- Board: 10×10.
- Fleet: one 4-cell ship and three 3-cell ships.
- Placement: 60-second timer; ships must be straight and cannot overlap.
- Turns: 25 seconds per turn. One normal shot per turn.
- Energy: first player starts with 1 energy; every new turn grants +1 energy (maximum 10).
- Radar pulse: 2 energy; choose a 3×3 area, reveals the number of ship cells in it, not their exact locations.
- Row barrage: 5 energy; fires at all 10 cells in a row, only newly-targeted cells count.
- Column barrage: 5 energy; fires at all 10 cells in a column, only newly-targeted cells count.
- Win by sinking all four enemy ships.

## Local testing
Requires Node.js 18+.
```bash
npm install
npm start
```
Open http://localhost:3000 in two tabs. Socket.IO keeps both tabs in sync.

## Notes
- This version keeps active rooms in server memory. If the Render free service sleeps or restarts, active matches are lost. This is fine for casual games; persistent rooms would need a database.


## Background music

Create `public/audio/` and place your own music file there named `background.mp3`. The in-game **MUSIC ON/OFF** button plays it on a loop. Browsers require a user click before audio can start, so click the music button after opening the game. If you use another filename or format, update the `/audio/background.mp3` path in `public/game.js`.

Fleet composition: 4, 3, 3, 3, and 2 cells (five ships total).
