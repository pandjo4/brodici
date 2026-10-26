const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.json({ ok: true }));

const rooms = new Map();
const BOARD = 10;
const SHIPS = [4, 3, 3, 3, 2];
const PLACE_SECONDS = 60;
const TURN_SECONDS = 25;
const MAX_ENERGY = 10;
const ABILITIES = { radar: 2, row: 5, column: 5 };

function roomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function cleanName(name) {
  return String(name || "Captain").trim().replace(/[<>]/g, "").slice(0, 18) || "Captain";
}
function emptyBoard() {
  return Array.from({ length: BOARD }, () => Array(BOARD).fill(0));
}
function validShipPlacement(board, cells, length) {
  if (!Array.isArray(cells) || cells.length !== length) return false;
  const unique = new Set();
  for (const p of cells) {
    if (!p || !Number.isInteger(p.r) || !Number.isInteger(p.c) ||
        p.r < 0 || p.r >= BOARD || p.c < 0 || p.c >= BOARD) return false;
    unique.add(`${p.r},${p.c}`);
    if (board[p.r][p.c]) return false;
  }
  if (unique.size !== length) return false;
  const rows = cells.map(p => p.r), cols = cells.map(p => p.c);
  const sameRow = rows.every(r => r === rows[0]);
  const sameCol = cols.every(c => c === cols[0]);
  if (!sameRow && !sameCol) return false;
  const sorted = [...cells].sort((a,b) => sameRow ? a.c-b.c : a.r-b.r);
  const axis = sameRow ? "c" : "r";
  return sorted.every((p, i) => i === 0 || p[axis] === sorted[i-1][axis] + 1);
}
function playerView(room, socketId) {
  const me = room.players[socketId];
  const opponentId = room.order.find(id => id !== socketId);
  const opp = opponentId && room.players[opponentId];
  if (!me) return null;
  return {
    code: room.code,
    phase: room.phase,
    you: { id: socketId, name: me.name, ready: me.ready, energy: me.energy, shots: me.shots, sunk: me.sunk, fleet: SHIPS, board: me.board, revealed: me.revealed, hits: Array.from(me.hits) },
    opponent: opp ? { name: opp.name, ready: opp.ready, energy: opp.energy, shots: opp.shots, sunk: opp.sunk, fleet: SHIPS, board: room.phase === "finished" ? opp.board : null, revealed: opp.revealed } : null,
    turnId: room.turnId,
    turnName: room.players[room.turnId]?.name || null,
    secondsLeft: room.secondsLeft,
    winner: room.winner ? room.players[room.winner]?.name || "Captain" : null,
    log: room.log.slice(-12),
    abilityCosts: ABILITIES,
    ships: SHIPS
  };
}
function sendState(room) {
  for (const id of room.order) {
    if (room.players[id]) io.to(id).emit("state", playerView(room, id));
  }
}
function log(room, message) {
  room.log.push({ text: message, at: Date.now() });
  if (room.log.length > 40) room.log.shift();
}
function addPlayer(room, socket, name) {
  room.players[socket.id] = {
    id: socket.id, name: cleanName(name), board: emptyBoard(), shipCells: [],
    hits: new Set(), shots: 0, sunk: 0, energy: 0, ready: false, revealed: [],
    placement: [], radarMarks: []
  };
  room.order.push(socket.id);
  socket.join(room.code);
}
function getRoom(socket) {
  const code = socket.data.roomCode;
  return code && rooms.get(code);
}
function nextTurn(room) {
  if (room.phase !== "battle") return;
  room.turnId = room.order.find(id => id !== room.turnId) || room.order[0];
  const p = room.players[room.turnId];
  if (!p) return;
  p.energy = Math.min(MAX_ENERGY, p.energy + 1);
  room.secondsLeft = TURN_SECONDS;
  room.turnStartedAt = Date.now();
  log(room, `${p.name}'s turn — +1 energy.`);
  sendState(room);
}
function finish(room, winnerId) {
  room.phase = "finished";
  room.winner = winnerId;
  room.secondsLeft = 0;
  log(room, `${room.players[winnerId]?.name || "A captain"} wins the battle!`);
  sendState(room);
}
function occupiedCells(p) {
  const result = [];
  p.board.forEach((row, r) => row.forEach((v, c) => { if (v) result.push({r,c,ship:v}); }));
  return result;
}
function checkSunk(target, shipId) {
  const cells = target.shipCells.find(s => s.id === shipId);
  return !!cells && cells.cells.every(p => target.hits.has(`${p.r},${p.c}`));
}
function applyShot(room, attackerId, r, c, source = "bomb") {
  const attacker = room.players[attackerId];
  const defenderId = room.order.find(id => id !== attackerId);
  const defender = room.players[defenderId];
  if (!attacker || !defender || r < 0 || c < 0 || r >= BOARD || c >= BOARD) return null;
  const key = `${r},${c}`;
  const prior = attacker.revealed.find(x => x.r === r && x.c === c);
  if (prior) return { duplicate: true };
  const shipId = defender.board[r][c];
  const hit = !!shipId;
  attacker.revealed.push({ r, c, hit });
  attacker.shots++;
  let sunk = false;
  if (hit) {
    defender.hits.add(key);
    if (checkSunk(defender, shipId)) {
      sunk = true;
      if (!defender.shipCells.find(s => s.id === shipId).sunk) {
        defender.shipCells.find(s => s.id === shipId).sunk = true;
        attacker.sunk++;
        log(room, `⚓ ${attacker.name} sunk an enemy ship (${defender.shipCells.find(s => s.id === shipId).length} cells)!`);
      }
    } else {
      log(room, `💥 ${attacker.name} hit a ship at ${String.fromCharCode(65+c)}${r+1}.`);
    }
  } else {
    log(room, `🌊 ${attacker.name} missed at ${String.fromCharCode(65+c)}${r+1}.`);
  }
  const allSunk = defender.shipCells.length > 0 && defender.shipCells.every(s => s.sunk);
  return { hit, sunk, allSunk, r, c, source };
}
function allFleetSunk(player) {
  return player.shipCells.length === SHIPS.length && player.shipCells.every(s => s.sunk);
}
function startBattle(room) {
  room.phase = "battle";
  room.turnId = room.order[Math.floor(Math.random() * 2)];
  room.players[room.turnId].energy = 1;
  room.secondsLeft = TURN_SECONDS;
  room.turnStartedAt = Date.now();
  log(room, "Battle started! First captain receives 1 energy.");
  sendState(room);
}
function maybeStart(room) {
  if (room.order.length === 2 && room.order.every(id => room.players[id]?.ready) && room.phase === "placing") startBattle(room);
}
function createRoom(socket, name) {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room = { code, players: {}, order: [], phase: "waiting", turnId: null, secondsLeft: PLACE_SECONDS, winner: null, log: [], timer: null, placementStarted: Date.now() };
  rooms.set(code, room);
  socket.data.roomCode = code;
  addPlayer(room, socket, name);
  log(room, `${room.players[socket.id].name} created lobby ${code}.`);
  sendState(room);
  return code;
}
function stopRoomTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}
function startRoomTimer(room) {
  stopRoomTimer(room);
  room.timer = setInterval(() => {
    if (room.phase === "placing") {
      room.secondsLeft = Math.max(0, PLACE_SECONDS - Math.floor((Date.now() - room.placementStarted) / 1000));
      if (room.secondsLeft <= 0) {
        // Auto-ready only if both have valid fleets. Otherwise cancel to avoid starting with an invalid board.
        if (room.order.length === 2 && room.order.every(id => room.players[id]?.ready)) maybeStart(room);
        else {
          log(room, "Placement timer expired. Both captains must finish placing ships.");
          room.secondsLeft = PLACE_SECONDS;
          room.placementStarted = Date.now();
        }
      }
      sendState(room);
    } else if (room.phase === "battle") {
      room.secondsLeft = Math.max(0, TURN_SECONDS - Math.floor((Date.now() - room.turnStartedAt) / 1000));
      if (room.secondsLeft <= 0) {
        log(room, `${room.players[room.turnId]?.name || "Captain"} ran out of time. Turn passed.`);
        nextTurn(room);
      } else sendState(room);
    }
  }, 250);
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}) => {
    if (getRoom(socket)) return;
    const code = createRoom(socket, name);
    const room = rooms.get(code);
    startRoomTimer(room);
    socket.emit("joined", { code, host: true });
  });
  socket.on("joinRoom", ({ code, name } = {}) => {
    if (getRoom(socket)) return;
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("errorMessage", "Lobby not found. Check the code and try again.");
    if (room.order.length >= 2 || room.phase !== "waiting") return socket.emit("errorMessage", "This lobby is already full or the battle has started.");
    socket.data.roomCode = code;
    addPlayer(room, socket, name);
    room.phase = "placing";
    room.placementStarted = Date.now();
    room.secondsLeft = PLACE_SECONDS;
    log(room, `${room.players[socket.id].name} joined the lobby.`);
    socket.emit("joined", { code, host: false });
    sendState(room);
    startRoomTimer(room);
  });
  socket.on("placeFleet", ({ ships } = {}) => {
    const room = getRoom(socket), p = room && room.players[socket.id];
    if (!room || !p || room.phase !== "placing" || p.ready) return;
    if (!Array.isArray(ships) || ships.length !== SHIPS.length) return socket.emit("errorMessage", "Place all 5 ships before confirming.");
    const board = emptyBoard(), shipCells = [];
    for (let i = 0; i < SHIPS.length; i++) {
      const cells = ships[i], length = SHIPS[i];
      if (!validShipPlacement(board, cells, length)) return socket.emit("errorMessage", `Invalid placement for the ${length}-cell ship. Ships cannot overlap and must be straight.`);
      const id = i + 1;
      cells.forEach(cell => board[cell.r][cell.c] = id);
      shipCells.push({ id, length, cells: cells.map(x => ({r:x.r,c:x.c})), sunk: false });
    }
    p.board = board;
    p.shipCells = shipCells;
    p.ready = true;
    log(room, `${p.name} has locked in their fleet.`);
    if (room.order.length === 1) room.phase = "waiting";
    if (room.order.length === 2) room.phase = "placing";
    sendState(room);
    maybeStart(room);
  });
  socket.on("fire", ({ r, c } = {}) => {
    const room = getRoom(socket);
    if (!room || room.phase !== "battle" || room.turnId !== socket.id) return;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c >= BOARD || r >= BOARD) return;
    const result = applyShot(room, socket.id, r, c);
    if (!result || result.duplicate) return socket.emit("errorMessage", "You have already targeted that cell.");
    if (result.allSunk) return finish(room, socket.id);
    nextTurn(room);
  });
  socket.on("ability", ({ type, r, c, axis } = {}) => {
    const room = getRoom(socket), p = room && room.players[socket.id];
    if (!room || room.phase !== "battle" || room.turnId !== socket.id || !p) return;
    const cost = ABILITIES[type];
    if (!cost) return socket.emit("errorMessage", "Unknown ability.");
    if (p.energy < cost) return socket.emit("errorMessage", "Not enough energy.");
    const defenderId = room.order.find(id => id !== socket.id);
    const defender = room.players[defenderId];
    if (type === "radar") {
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r > 7 || c > 7) return socket.emit("errorMessage", "Choose a top-left cell so the 3×3 scan fits on the board.");
      p.energy -= cost;
      let count = 0;
      for (let rr = r; rr < r+3; rr++) for (let cc = c; cc < c+3; cc++) if (defender.board[rr][cc]) count++;
      p.radarMarks.push({ r, c, count, cells: [] });
      log(room, `📡 ${p.name} scanned a 3×3 zone: ${count} ship cell${count===1?"":"s"} detected.`);
      socket.emit("abilityResult", { type: "radar", r, c, count });
      sendState(room);
      return;
    }
    if (type === "row" || type === "column") {
      const index = Number(type === "row" ? r : c);
      if (!Number.isInteger(index) || index < 0 || index > 9) return socket.emit("errorMessage", "Choose a valid row or column.");
      p.energy -= cost;
      const shots = [];
      for (let i = 0; i < 10; i++) {
        const rr = type === "row" ? index : i;
        const cc = type === "row" ? i : index;
        const res = applyShot(room, socket.id, rr, cc, type);
        if (res && !res.duplicate) shots.push(res);
      }
      const totalHits = shots.filter(x => x.hit).length;
      log(room, `🚀 ${p.name} launched a ${type} barrage: ${totalHits} hit${totalHits===1?"":"s"} across ${shots.length} new cells.`);
      if (allFleetSunk(defender)) return finish(room, socket.id);
      socket.emit("abilityResult", { type, index, hits: totalHits, shots });
      nextTurn(room);
    }
  });
  socket.on("rematch", () => {
    const room = getRoom(socket);
    if (!room || room.phase !== "finished") return;
    room.rematchVotes = room.rematchVotes || new Set();
    room.rematchVotes.add(socket.id);
    if (room.rematchVotes.size === 2) {
      room.phase = "placing"; room.winner = null; room.turnId = null;
      room.secondsLeft = PLACE_SECONDS; room.placementStarted = Date.now(); room.rematchVotes.clear(); room.log = [];
      for (const id of room.order) {
        const p = room.players[id];
        p.board = emptyBoard(); p.shipCells = []; p.hits = new Set(); p.shots = 0; p.sunk = 0; p.energy = 0; p.ready = false; p.revealed = []; p.radarMarks = [];
      }
      log(room, "Rematch! Deploy your fleet.");
      sendState(room);
    } else {
      socket.emit("notice", "Rematch requested. Waiting for the other captain.");
    }
  });
  socket.on("disconnect", () => {
    const room = getRoom(socket);
    if (!room) return;
    log(room, `${room.players[socket.id]?.name || "A captain"} disconnected.`);
    delete room.players[socket.id];
    room.order = room.order.filter(id => id !== socket.id);
    if (room.order.length === 0) {
      stopRoomTimer(room); rooms.delete(room.code);
    } else {
      const remaining = room.players[room.order[0]];
      if (room.phase !== "finished") {
        room.phase = "waiting";
        room.turnId = null;
        if (remaining) {
          remaining.ready = false;
          remaining.board = emptyBoard(); remaining.shipCells = []; remaining.hits = new Set(); remaining.revealed = [];
        }
      }
      sendState(room);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Depth Charge server running on ${PORT}`));
