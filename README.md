# DEPTH CHARGE — fixed Render deployment

## Important fix
The original `public/game.js` contained the literal characters `\n` in the middle of a JavaScript statement. This is a syntax error that prevents the entire client game script from loading. As a result, the connection label stayed on `CONNECTING` and the lobby buttons did not work. That syntax error has been fixed.

## Deploy to Render
1. Extract this ZIP.
2. Upload the **contents of this folder** to the root of your GitHub repository. `package.json`, `server.js`, `render.yaml`, and `public/` must be directly in the repository root, not inside an extra nested folder.
3. In Render, make sure the service is connected to that repository and uses:
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/health`
4. Trigger **Manual Deploy → Deploy latest commit**.
5. Open the Render URL and confirm `/health` displays `{"ok":true}`.
6. Player 1 creates a lobby and shares the six-character code; Player 2 opens the same Render URL and joins with that code.

## Local test
Requires Node.js 18 or newer:
```bash
npm install
npm start
```
Then open `http://localhost:3000` in two browser tabs.

## Notes
Rooms are held in server memory, so active matches are lost if Render restarts or sleeps. The free service may take a little while to wake up after inactivity.
