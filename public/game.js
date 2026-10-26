(() => {
  const socket = io();
  const $ = id => document.getElementById(id);
  const lobbyScreen = $("lobbyScreen"), gameScreen = $("gameScreen");
  let state = null, myId = null, lobbyCode = null;
  let placedShips = [], selectedShip = 0, vertical = false, hoverCell = null;
  let abilityMode = null, radarOverlays = [], soundOn = true, musicOn = false, audioCtx = null;
  let musicTimer = null, musicNodes = [];
  function ensureAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }
  function startMusic() {
    const ctx = ensureAudio();
    if (!ctx || musicTimer) return;
    musicOn = true;
    const master = ctx.createGain(); master.gain.value = 0.045; master.connect(ctx.destination);
    musicNodes.push(master);
    // A quiet, original synthesized naval ambience; no external audio files required.
    const notes = [110, 164.81, 146.83, 196, 130.81, 174.61, 146.83, 220];
    let step = 0;
    const playNote = () => {
      if (!musicOn || !audioCtx) return;
      const now = ctx.currentTime, freq = notes[step++ % notes.length];
      const osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
      osc.type = "sine"; osc.frequency.setValueAtTime(freq, now);
      filter.type = "lowpass"; filter.frequency.value = 420;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.6);
      osc.connect(filter); filter.connect(gain); gain.connect(master);
      osc.start(now); osc.stop(now + 3.7);
    };
    playNote(); musicTimer = setInterval(playNote, 2800);
    $("musicToggle").textContent = "♫ MUSIC ON";
    $("musicToggle").classList.add("sound-on");
  }
  function stopMusic() {
    musicOn = false;
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
    musicNodes.forEach(node => { try { node.disconnect(); } catch(e) {} });
    musicNodes = [];
    $("musicToggle").textContent = "♫ MUSIC OFF";
    $("musicToggle").classList.remove("sound-on");
  }
  let toastTimer = null, rematchRequested = false;

  const shipDefs = [
    { length: 4, name: "STRIKE CRUISER", desc: "Heavy command ship" },
    { length: 3, name: "SCOUT FRIGATE", desc: "Fast reconnaissance" },
    { length: 3, name: "DEFENSE CUTTER", desc: "Close-range defense" },
    { length: 3, name: "PATROL VESSEL", desc: "Flexible support craft" }
  ];
  const colLetter = c => String.fromCharCode(65 + c);
  const coord = (r,c) => `${colLetter(c)}${r+1}`;
  const shipAt = (ships,r,c) => ships.findIndex(s => s.cells.some(p=>p.r===r&&p.c===c));
  function beep(freq=440,duration=.07,type="sine",gain=.035) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator(), vol = audioCtx.createGain();
      osc.type=type;osc.frequency.value=freq;vol.gain.value=gain;osc.connect(vol);vol.connect(audioCtx.destination);
      osc.start();vol.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);osc.stop(audioCtx.currentTime+duration);
    } catch(e) {}
  }
  function toast(message) {
    $("toast").textContent=message;$("toast").classList.remove("hidden");
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.add("hidden"),3000);
  }
  function error(message) { $("lobbyError").textContent=message; toast(message); }
  function getName() { return $("playerName").value.trim() || "Captain"; }
  function setConnected(connected) {
    $("connectionLabel").textContent=connected?"SYSTEM ONLINE":"RECONNECTING";
    document.querySelector(".top-right .live-dot").style.background=connected?"var(--cyan)":"var(--red)";
  }
  socket.on("connect",()=>{myId=socket.id;setConnected(true)});
  socket.on("disconnect",()=>setConnected(false));
  socket.on("connect_error",()=>setConnected(false));
  socket.on("errorMessage",message=>toast(message));
  socket.on("notice",message=>toast(message));
  socket.on("joined",data=>{
    lobbyCode=data.code;lobbyScreen.classList.add("hidden");gameScreen.classList.remove("hidden");
    $("gameRoomCode").textContent=data.code;$("inviteCode").textContent=data.code;
    $("lobbyError").textContent="";toast(data.host?"Lobby created. Share your code!":"Joined lobby. Prepare your fleet.");
  });
  socket.on("state",next=>{
    if(!next)return;
    const previousPhase = state?.phase;
    const previousShots = state?.you?.revealed?.length ?? 0;
    const oldYouSunk=state?.you?.sunk ?? 0;
    state=next;lobbyCode=next.code;
    if ((next.you?.sunk ?? 0) > oldYouSunk) { beep(95,.55,"sawtooth",.06); setTimeout(()=>beep(70,.7,"triangle",.05),180); }
    else if ((next.you?.revealed?.length ?? 0) > previousShots) {
      const last=(next.you.revealed||[]).at(-1); if(last?.hit) beep(330,.18,"square",.045);
    }
    if(previousPhase==="finished" && next.phase==="placing"){
      placedShips=[];selectedShip=0;vertical=false;hoverCell=null;
      radarOverlays=[];abilityMode=null;rematchRequested=false;
    }
    if(!gameScreen.classList.contains("hidden")) renderState();
  });
  socket.on("abilityResult",result=>{
    beep(620,.12,"triangle");
    if(result.type==="radar") {
      radarOverlays.push({r:result.r,c:result.c,count:result.count});
      toast(`Radar detected ${result.count} ship cell${result.count===1?"":"s"} in that 3×3 zone.`);
    } else toast(`${result.type==="row"?"Row":"Column"} barrage: ${result.hits} hits!`);
    abilityMode=null;$("abilityPrompt").classList.add("hidden");
    document.querySelectorAll(".ability-card").forEach(b=>b.classList.remove("active"));
  });

  $("createBtn").addEventListener("click",()=>{ $("lobbyError").textContent="";socket.emit("createRoom",{name:getName()}); });
  $("joinBtn").addEventListener("click",()=>{
    $("lobbyError").textContent="";
    const code=$("roomCode").value.trim().toUpperCase();
    if(code.length!==6)return error("Enter the 6-character lobby code.");
    socket.emit("joinRoom",{name:getName(),code});
  });
  $("roomCode").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6));
  $("copyCodeBtn").addEventListener("click",async()=>{
    try{await navigator.clipboard.writeText(lobbyCode);toast("Lobby code copied. Send it to your opponent.");}
    catch(e){toast(`Share this lobby code: ${lobbyCode}`);}
  });
  $("soundToggle").addEventListener("click",()=>{
    soundOn=!soundOn;$("soundToggle").classList.toggle("sound-on",soundOn);
    $("soundToggle").textContent=soundOn?"🔊 SFX ON":"🔇 SFX OFF";
    if(soundOn)beep(660,.08);
    toast(soundOn?"Sound effects enabled.":"Sound effects muted.");
  });
  $("musicToggle").addEventListener("click",()=>{
    if(musicOn) stopMusic(); else startMusic();
    toast(musicOn?"Background music enabled.":"Background music muted.");
  });
  $("soundToggle").textContent = "🔊 SFX ON"; $("soundToggle").classList.add("sound-on");
  $("rotateBtn").addEventListener("click",()=>{vertical=!vertical;renderPlacement();beep(330,.04)});
  document.addEventListener("keydown",e=>{if(e.key.toLowerCase()==="r"&&!gameScreen.classList.contains("hidden")){vertical=!vertical;renderPlacement()}});
  $("undoShipBtn").addEventListener("click",()=>{
    if(!placedShips.length)return;
    const last=placedShips.pop();selectedShip=last.defIndex;renderPlacement();beep(260,.07);
  });
  $("readyBtn").addEventListener("click",()=>{
    if(placedShips.length!==4)return;
    socket.emit("placeFleet",{ships:shipDefs.map((def,i)=>placedShips.find(s=>s.defIndex===i).cells)});
    $("readyBtn").disabled=true;$("readyBtn").textContent="FLEET LOCKED ✓";
  });
  $("cancelAbilityBtn").addEventListener("click",cancelAbility);
  document.querySelectorAll(".ability-card").forEach(btn=>btn.addEventListener("click",()=>{
    if(!state||state.phase!=="battle"||state.turnId!==myId)return toast("Wait for your turn before using an ability.");
    const type=btn.dataset.ability,cost=state.abilityCosts[type];
    if(state.you.energy<cost)return toast("Not enough energy for this ability.");
    if(abilityMode===type){cancelAbility();return;}
    abilityMode=type;
    document.querySelectorAll(".ability-card").forEach(b=>b.classList.toggle("active",b===btn));
    $("abilityPrompt").classList.remove("hidden");
    $("abilityPromptText").textContent=type==="radar"?"Choose the top-left cell of a 3×3 scan zone.":type==="row"?"Tap any cell in the row you want to bombard.":"Tap any cell in the column you want to bombard.";
    toast(type==="radar"?"Radar selected — choose a 3×3 zone.":`Select a ${type} to launch the barrage.`);
    renderEnemyBoard();
  }));
  $("rematchBtn").addEventListener("click",()=>{socket.emit("rematch");rematchRequested=true;$("rematchBtn").disabled=true;$("rematchBtn").textContent="WAITING FOR OPPONENT…";});
  $("backLobbyBtn").addEventListener("click",()=>{location.reload()});

  function cancelAbility(){abilityMode=null;$("abilityPrompt").classList.add("hidden");document.querySelectorAll(".ability-card").forEach(b=>b.classList.remove("active"));renderEnemyBoard();}
  function canPlace(defIndex,r,c){
    const def=shipDefs[defIndex];const cells=[];
    for(let i=0;i<def.length;i++){const rr=r+(vertical?i:0),cc=c+(vertical?0:i);if(rr>9||cc>9)return null;cells.push({r:rr,c:cc});}
    if(cells.some(p=>placedShips.some(s=>s.cells.some(q=>q.r===p.r&&q.c===p.c))))return null;
    return cells;
  }
  function renderPlacement(){
    const board=$("ownBoard");board.innerHTML="";
    const selected=shipDefs[selectedShip];
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const cell=document.createElement("button");cell.type="button";cell.className="cell";
      const existing=shipAt(placedShips,r,c);
      if(existing>=0){cell.classList.add("ship");cell.textContent="▪";}
      if(hoverCell&&selectedShip>=0&&placedShips.length<4&&!placedShips.some(s=>s.defIndex===selectedShip)){
        const preview=canPlace(selectedShip,hoverCell.r,hoverCell.c);
        if(preview&&preview.some(p=>p.r===r&&p.c===c))cell.classList.add("preview");
        else if(!preview&&r>=hoverCell.r&&c>=hoverCell.c&&r<hoverCell.r+(vertical?selected.length:1)&&c<hoverCell.c+(vertical?1:selected.length))cell.classList.add("invalid-preview");
      }
      cell.addEventListener("pointerenter",()=>{
        hoverCell={r,c};
        board.querySelectorAll(".cell").forEach((el,index)=>{
          el.classList.remove("preview","invalid-preview");
          if(placedShips.length>=4 || placedShips.some(s=>s.defIndex===selectedShip)) return;
          const rr=Math.floor(index/10), cc=index%10;
          const preview=canPlace(selectedShip,r,c);
          if(preview && preview.some(p=>p.r===rr&&p.c===cc)) el.classList.add("preview");
          else if(!preview && rr>=r&&cc>=c&&rr<r+(vertical?selected.length:1)&&cc<c+(vertical?1:selected.length)) el.classList.add("invalid-preview");
        });
      });
      cell.addEventListener("click",()=>{
        if(placedShips.length>=4 || placedShips.some(s=>s.defIndex===selectedShip))return;
        if(placedShips.some(s=>s.cells.some(p=>p.r===r&&p.c===c)))return;
        const cells=canPlace(selectedShip,r,c);
        if(!cells){toast("That ship does not fit there. Try another starting cell.");beep(170,.06,"square");return;}
        placedShips.push({defIndex:selectedShip,cells});
        selectedShip=shipDefs.findIndex((_,i)=>!placedShips.some(s=>s.defIndex===i));
        if(selectedShip<0)selectedShip=shipDefs.findIndex((_,i)=>!placedShips.some(s=>s.defIndex===i));\n        if(selectedShip<0)selectedShip=0;
        hoverCell=null;beep(470,.07);renderPlacement();
      });
      board.appendChild(cell);
    }
    $("shipCount").textContent=`${placedShips.length} / 4 DEPLOYED`;
    $("fleetReady").textContent=`${placedShips.length}/4`;
    $("readyBtn").disabled=placedShips.length!==4;
    $("readyBtn").innerHTML=placedShips.length===4?'LOCK IN FLEET <b>↗</b>':`DEPLOY ${4-placedShips.length} MORE SHIP${4-placedShips.length===1?"":"S"} <b>↗</b>`;
    renderShipList();
  }
  function renderShipList(){
    const list=$("shipList");list.innerHTML="";
    shipDefs.forEach((def,i)=>{
      const placed=placedShips.some(s=>s.defIndex===i);
      const btn=document.createElement("button");btn.className="ship-option"+(selectedShip===i&&!placed?" selected":"")+(placed?" placed":"");
      btn.disabled=placed;
      const mini=document.createElement("span");mini.className="ship-mini";
      for(let k=0;k<def.length;k++){const part=document.createElement("i");mini.appendChild(part)}
      const meta=document.createElement("span");meta.className="ship-meta";meta.innerHTML=`<b>${def.name}</b><small>${def.length} CELLS · ${def.desc}</small>`;
      const status=document.createElement("span");status.className="ship-status";status.textContent=placed?"✓":"＋";
      btn.append(mini,meta,status);btn.addEventListener("click",()=>{if(!placed){selectedShip=i;hoverCell=null;renderPlacement()}});list.appendChild(btn);
    });
  }
  function renderBoardAxes(board,clickHandler,mode){
    board.innerHTML="";
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const cell=document.createElement("button");cell.type="button";cell.className="cell";cell.dataset.r=r;cell.dataset.c=c;
      if(mode==="placement"){
        // board cells are rendered by renderPlacement to preserve its interaction
      }
      cell.addEventListener("click",()=>clickHandler(r,c,cell));board.appendChild(cell);
    }
  }
  function renderEnemyBoard(){
    if(!state)return;
    const board=$("enemyBoard");board.innerHTML="";
    const shots=state.you.revealed||[];
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const cell=document.createElement("button");cell.type="button";cell.className="cell";
      const shot=shots.find(s=>s.r===r&&s.c===c);
      if(shot){cell.classList.add(shot.hit?"hit":"miss","targeted");cell.textContent=shot.hit?"✕":"·";cell.disabled=true;}
      const radar=radarOverlays.find(z=>r>=z.r&&r<z.r+3&&c>=z.c&&c<z.c+3);
      if(radar&&!shot)cell.classList.add("radar");
      if(abilityMode==="radar"){
        cell.addEventListener("mouseenter",()=>{cell.title="Top-left scan coordinate";});
      }
      if(state.phase==="battle"&&state.turnId===myId&&!shot){
        cell.addEventListener("click",()=>{
          if(abilityMode==="radar"){
            if(r>7||c>7)return toast("Choose a top-left cell from rows A–H and columns 1–8 so the scan fits.");
            socket.emit("ability",{type:"radar",r,c});cancelAbility();return;
          }
          if(abilityMode==="row"){socket.emit("ability",{type:"row",r,c});cancelAbility();return;}
          if(abilityMode==="column"){socket.emit("ability",{type:"column",r,c});cancelAbility();return;}
          socket.emit("fire",{r,c});beep(210,.1,"triangle");
        });
      } else if(state.phase==="battle"&&state.turnId!==myId)cell.disabled=true;
      board.appendChild(cell);
    }
  }
  function renderOwnBattleBoard(){
    if(!state)return;
    const board=$("battleOwnBoard");board.innerHTML="";
    const myBoard=state.you.board||[];
    const incomingShots = new Map((state.opponent?.revealed||[]).map(s=>[`${s.r},${s.c}`,s]));
    for(let r=0;r<10;r++)for(let c=0;c<10;c++){
      const cell=document.createElement("div");cell.className="cell";
      const id=myBoard[r]?.[c]||0;
      const incoming = incomingShots.get(`${r},${c}`);
      if(id)cell.classList.add("ship");
      if(incoming){
        if(incoming.hit) cell.classList.add("hit");
        else cell.classList.add("miss");
        cell.textContent = incoming.hit ? "✕" : "·";
      } else if(id) cell.textContent="▪";
      board.appendChild(cell);
    }
    $("ownFleetStatus").textContent=`${Math.max(0,4-(state.you.sunk||0))} SHIPS AFLOAT`;
    const health=$("fleetHealth");health.innerHTML="";
    for(let i=0;i<4;i++){const part=document.createElement("i");part.className="health-ship"+(i<(state.you.sunk||0)?" sunk":"");health.appendChild(part)}
  }
  function renderLog(){
    const log=$("combatLog");log.innerHTML="";
    if(!state.log?.length){log.innerHTML='<p class="empty-log">Waiting for first contact...</p>';return;}
    state.log.slice().reverse().forEach(entry=>{
      const el=document.createElement("div");el.className="log-entry";
      const time=document.createElement("span");time.className="log-time";time.textContent=new Date(entry.at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
      const text=document.createElement("span");text.textContent=entry.text;
      el.append(time,text);log.appendChild(el);
    });
  }
  function renderState(){
    if(!state)return;
    $("gameRoomCode").textContent=state.code;$("inviteCode").textContent=state.code;
    const waiting=state.phase==="waiting";
    $("waitingBanner").classList.toggle("hidden",!waiting);
    $("placementPanel").classList.toggle("hidden",!(state.phase==="placing"||waiting));
    $("battlePanel").classList.toggle("hidden",state.phase!=="battle"&&state.phase!=="finished");
    $("resultOverlay").classList.toggle("hidden",state.phase!=="finished");
    if(state.phase==="waiting"){
      $("phaseTitle").textContent="WAR ROOM OPEN";$("phaseSubtitle").textContent="Your lobby is live. Invite one captain to begin.";
      $("placementPanel").classList.add("hidden");
      $("waitingBanner").querySelector("small").textContent="Share your lobby code to bring an opponent into the war room.";
    } else if(state.phase==="placing"){
      $("phaseTitle").textContent="DEPLOY YOUR FLEET";$("phaseSubtitle").textContent="Place all four ships on your ocean grid.";
      $("placementTimer").textContent=state.secondsLeft??60;
      if(state.you.ready){
        $("placementPanel").classList.add("hidden");
        $("waitingBanner").classList.remove("hidden");
        $("waitingBanner").querySelector("b").textContent="FLEET LOCKED — WAITING";
        $("waitingBanner").querySelector("small").textContent="Your fleet is hidden. Waiting for the other captain to lock in their fleet.";
      } else {
        $("placementPanel").classList.remove("hidden");
        $("waitingBanner").classList.add("hidden");
        renderPlacement();
      }
    } else {
      $("phaseTitle").textContent=state.phase==="finished"?"MISSION COMPLETE":"BATTLE IN PROGRESS";
      $("phaseSubtitle").textContent=state.phase==="finished"?"The battle report is ready.":"Find the fleet. Manage your energy. Sink every ship.";
      $("placementPanel").classList.add("hidden");$("waitingBanner").classList.add("hidden");
      $("turnTimer").textContent=state.secondsLeft??25;
      const yourTurn=state.turnId===myId;
      $("turnEyebrow").textContent=yourTurn?"YOUR TURN":"ENEMY TURN";
      $("turnTitle").textContent=state.phase==="finished"?"Battle concluded":yourTurn?"Choose a target":"Opponent is planning";
      $("turnDesc").textContent=state.phase==="finished"?"The ocean remembers.":yourTurn?"Fire a shot or activate a tactical system.":"Waiting for the enemy's move…";
      $("turnTimer").parentElement.classList.toggle("urgent",(state.secondsLeft||0)<=7);
      $("energyValue").innerHTML=`${state.you.energy} <i>/ 10</i>`;
      $("energyPips").innerHTML="";
      for(let i=0;i<10;i++){const pip=document.createElement("i");if(i<state.you.energy)pip.className="filled";$("energyPips").appendChild(pip)}
      $("enemyShotCount").textContent=`${state.you.shots} SHOTS`;
      document.querySelectorAll(".ability-card").forEach(btn=>{const cost=state.abilityCosts[btn.dataset.ability];btn.disabled=!yourTurn||state.you.energy<cost||state.phase!=="battle";});
      renderEnemyBoard();renderOwnBattleBoard();renderLog();
      if(state.phase==="finished"){
        const won=state.winner===state.you.name;
        $("resultIcon").textContent=won?"✦":"⚓";$("resultTitle").textContent=won?"VICTORY":"DEFEAT";
        $("resultTitle").style.color=won?"var(--cyan)":"var(--red)";
        $("resultText").textContent=won?`Outstanding command, ${state.you.name}. The enemy fleet has been sunk.`:`${state.winner} has sunk your fleet. Regroup and request a rematch.`;
        $("rematchBtn").disabled=rematchRequested;
        if(rematchRequested)$("rematchBtn").textContent="WAITING FOR OPPONENT…";
      }
    }
  }
})();
