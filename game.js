// Game prototype for 商人之路 — 大富翁类
const CFG = {
  boardSize: 24, // expand to 24 squares
  initialCash: 3000,
  maxPlayers: 4,
  roundTimeSec: 40*60, // default 40 minutes total timer
  turnTimeSec: 90, // optional per-turn timer
  passiveIncomeRate: 0.05, // business returns per turn (5% of base)
  auctionBidTimeout: 10, // seconds for per-bid countdown in auctions
}

let state = {
  players: [],
  currentPlayer: 0,
  board: [],
  started: false,
  timeLeft: CFG.roundTimeSec,
  market: {},
  transactions: [],
  replayIndex: 0,
  bank: { loans: [], interestRate: 0.06 },
  _currentAuction: null,
  _lastAuction: null,
}

const el = {
  board: document.getElementById('board'),
  playersPanel: document.getElementById('playersPanel'),
  marketPanel: document.getElementById('marketPanel'),
  log: document.getElementById('log'),
  startBtn: document.getElementById('startBtn'),
  rollBtn: document.getElementById('rollBtn'),
  timeLeft: document.getElementById('timeLeft'),
  playerCount: document.getElementById('playerCount'),
  roundMins: document.getElementById('roundMins'),
  assetsPanel: document.getElementById('assetsPanel'),
  helpBtn: document.getElementById('helpBtn'),
}

function log(msg){
  const p = document.createElement('p'); p.textContent = msg; el.log.prepend(p);
}

function createBoard(){
  // create square-like track with CFG.boardSize positions
  state.board = [];
  for(let i=0;i<CFG.boardSize;i++){
    const typeRand = Math.random();
    let type='empty';
    if(typeRand<0.35) type='property';
    else if(typeRand<0.5) type='event';
    else if(typeRand<0.65) type='stock';
    const base = 300 + Math.floor(Math.random()*1200);
    state.board.push({id:i,name:`地块 ${i+1}`,type,owner:null,price: (type==='property'? base:0), business:null})
  }
}

function renderBoard(){
  el.board.innerHTML='';
  const grid = document.createElement('div'); grid.className='board-grid';
  el.board.appendChild(grid);
  const W = el.board.clientWidth; const H = el.board.clientHeight;
  const n = state.board.length;
  // compute positions along the four sides of the square
  // adaptive cell size based on board dimensions
  const padding = 18;
  // support arbitrary board sizes divisible by 4 (perSide positions per side)
  const perSide = Math.max(1, Math.floor(n/4));
  // compute maximum cell size that fits perSide cells along a side
  const maxCellW = Math.floor((W - padding*2) / (perSide>1 ? perSide : 1));
  const maxCellH = Math.floor((H - padding*2) / (perSide>1 ? perSide : 1));
  const cellW = Math.min(140, Math.max(80, Math.min(maxCellW, maxCellH)));
  const cellH = cellW;
  const left = padding; const right = W - padding - cellW; const top = padding; const bottom = H - padding - cellH;
  const stepX = perSide>1 ? (right-left)/(perSide-1) : 0;
  const stepY = perSide>1 ? (bottom-top)/(perSide-1) : 0;
  for(let i=0;i<n;i++){
    let x=0,y=0;
    if(i<perSide){ // top row left -> right
      const t = i; x = left + stepX*t; y = top;
    } else if(i<perSide*2){ // right col top -> bottom
      const t = i - perSide; x = right; y = top + stepY*t;
    } else if(i<perSide*3){ // bottom row right -> left
      const t = i - perSide*2; x = right - stepX*t; y = bottom;
    } else { // left col bottom -> top
      const t = i - perSide*3; x = left; y = bottom - stepY*t;
    }
    const d = document.createElement('div'); d.className='board-cell'; d.style.left = `${Math.round(x)}px`; d.style.top = `${Math.round(y)}px`; d.style.width = `${cellW}px`; d.style.height = `${cellH}px`;
    // choose class by type
    const typeClass = state.board[i].type === 'property' ? 'prop' : (state.board[i].type === 'event' ? 'event' : (state.board[i].type === 'stock' ? 'stock' : 'empty'));
    d.innerHTML = `<div class="cell ${typeClass}" data-id="${i}" style="width:${cellW}px;height:${cellH}px"><div class="cell-name">${state.board[i].name}</div><div class="cell-info">${state.board[i].type}${state.board[i].price?(' ¥'+state.board[i].price):''}</div></div>`;
    grid.appendChild(d);
  }
  renderPlayersTokens();
}

function renderPlayersTokens(){
  // remove existing tokens first
  const existing = document.querySelectorAll('.player-token'); existing.forEach(e=>e.remove());
  state.players.forEach((p,idx)=>{
    const pos = p.pos || 0;
    const cell = document.querySelector(`.cell[data-id='${pos}']`);
    if(cell){
      const t = document.createElement('div'); t.className = 'player-token token-'+idx; t.textContent = idx+1;
      t.style.position='absolute';
      // compute scaled offsets depending on cell size
      const scale = Math.max(1, Math.round(cell.clientWidth/100));
      const offsetBase = Math.max(12, Math.round(cell.clientWidth/6));
      const offsets = [ [-offsetBase,-offsetBase], [offsetBase,-offsetBase], [-offsetBase,offsetBase], [offsetBase,offsetBase] ];
      const off = offsets[idx] || [ (idx-3)*offsetBase, -offsetBase ];
      t.style.left = `calc(50% + ${off[0]}px)`; t.style.top = `calc(50% + ${off[1]}px)`;
      cell.appendChild(t);
    }
  })
}

function initPlayers(count, aiEnabled, aiCount){
  state.players = [];
  const pc = count || CFG.maxPlayers || 4;
  const enableAI = !!aiEnabled;
  const aiNum = parseInt(aiCount||0,10) || 0;
  for(let i=0;i<pc;i++){
    const isAI = enableAI && (i < aiNum);
    state.players.push({id:i,name:`玩家 ${i+1}` + (isAI? ' (AI)':''),cash:CFG.initialCash,pos:0,properties:[],stocks:{},isAI:isAI})
  }
  renderPlayersPanel();
}

function renderPlayersPanel(){
  el.playersPanel.innerHTML='';
  state.players.forEach((p,i)=>{
    const net = p.cash + p.properties.reduce((acc,id)=>acc + (state.board[id]?.price||0),0) + Object.keys(p.stocks).reduce((acc,sym)=> acc + (p.stocks[sym]||0)* (state.market[sym]?.price||0),0);
    const bizIncome = p.properties.reduce((acc,id)=>{
      const c = state.board[id]; return acc + (c.business && c.business.owner===p.id ? Math.floor(c.business.base * CFG.passiveIncomeRate) : 0);
    },0);
    const div = document.createElement('div'); div.className='player';
    div.innerHTML = `<div><strong style="color:var(--accent)">${p.name}</strong><div class="small">现金: ¥${p.cash} · 净资: ¥${net} · 被动收益/回合: ¥${bizIncome}</div></div><div>回合: ${i===state.currentPlayer?'<em>进行中</em>':''}</div>`;
    el.playersPanel.appendChild(div);
  })
}

function startGame(){
  // read config
  const pc = parseInt(el.playerCount.value||'4',10);
  const mins = parseInt(el.roundMins.value||'40',10);
  CFG.maxPlayers = Math.max(2,Math.min(4,pc));
  CFG.roundTimeSec = Math.max(60,mins*60);

  // clear existing timer if any
  if(state._timerInterval) { clearInterval(state._timerInterval); state._timerInterval=null }

  createBoard();
  const aiEnabled = document.getElementById('aiEnabled')?.checked;
  const aiCount = parseInt(document.getElementById('aiCount')?.value||'0',10);
  initPlayers(pc, aiEnabled, aiCount);
  // initialize market and assign stock symbols to stock tiles
  initMarket();
  renderBoard();
  state.started=true; state.timeLeft=CFG.roundTimeSec;
  el.startBtn.disabled=true; el.rollBtn.disabled=false;
  log('游戏开始！本局目标：在限定时间内资产最大者胜出。');
  startRoundTimer();
  startTurnTimer();
}

function initMarket(){
  // create a small set of companies and map them to stock tiles on the board
  const companies = ['ALPHA','BETA','GAMMA','DELTA','OMEGA','SIGMA','TAU'];
  state.market = {};
  // initialize base prices
  companies.forEach((c)=>{ state.market[c] = { price: 60 + Math.floor(Math.random()*240), vol: Math.floor(10+Math.random()*90) }; });
  // assign symbols to stock tiles in board (cycle companies)
  let ci = 0;
  for(let i=0;i<state.board.length;i++){
    if(state.board[i].type === 'stock'){
      const sym = companies[ci % companies.length];
      state.board[i].stockSymbol = sym;
      ci++;
    }
  }
}

// per-turn timer functions
function startTurnTimer(){
  if(state._turnInterval) clearInterval(state._turnInterval);
  state._turnTimeLeft = CFG.turnTimeSec || 90;
  updateTurnDisplay();
  state._turnInterval = setInterval(()=>{
    state._turnTimeLeft--;
    updateTurnDisplay();
    if(state._turnTimeLeft<=0){
      clearInterval(state._turnInterval); state._turnInterval = null;
      log('本回合超时，自动结束回合');
      nextTurn();
    }
  },1000);
}

function stopTurnTimer(){ if(state._turnInterval){ clearInterval(state._turnInterval); state._turnInterval=null; } }

function updateTurnDisplay(){ const t = state._turnTimeLeft || 0; const mm = Math.floor(t/60); const ss = t%60; const elT = document.getElementById('turnLeft'); if(elT) elT.textContent = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`; }

async function rollDice(){
  const diceEl = document.getElementById('dice');
  if(diceEl){
    // pop-out then spin
    diceEl.textContent = '...';
    diceEl.classList.add('pop');
    // short pop duration
    await new Promise(r=>setTimeout(r, 160));
    diceEl.classList.add('spin');
  }
  // spin duration
  await new Promise(r=>setTimeout(r, 600));
  const v = 1+Math.floor(Math.random()*6)+Math.floor(Math.random()*6);
  if(diceEl){ diceEl.textContent = v; diceEl.classList.remove('spin'); diceEl.classList.remove('pop'); }
  log(`${state.players[state.currentPlayer].name} 掷骰子，点数 ${v}`);
  // small pause so player sees the final dice number
  await new Promise(r=>setTimeout(r, 240));
  movePlayer(state.currentPlayer,v);
}

async function movePlayer(pid,steps){
  const player = state.players[pid];
  for(let s=0;s<steps;s++){
    player.pos = (player.pos+1)%state.board.length;
    renderBoard();
    await new Promise(r=>setTimeout(r,220));
  }
  resolveLanding(pid, player.pos);
}

function resolveLanding(pid,pos){
  const cell = state.board[pos];
  log(`${state.players[pid].name} 到达 ${cell.name} (${cell.type})`);
  if(cell.type==='property'){
    if(cell.owner==null){
      // AI auto-decide to buy or start auction
      const player = state.players[pid];
      if(player.isAI){
        if(aiShouldBuy(player, cell)){
          // AI buys immediately
          if(player.cash>=cell.price){ player.cash -= cell.price; cell.owner = pid; player.properties.push(cell.id); log(`${player.name} (AI) 购买了 ${cell.name}，花费 ¥${cell.price}`); recordTransaction({type:'buy', desc:`${player.name} (AI) 购买 ${cell.name} ¥${cell.price}`, player: pid, cell: cell.id, price: cell.price}); renderPlayersPanel(); renderMarketPanel(); }
          else { log(`${player.name} (AI) 资金不足，无法购买`); startAuction(cell); }
        } else { startAuction(cell); }
      } else {
        // show purchase confirmation modal with investment option
        showConfirmPurchase(pid, cell, {allowBusiness:true});
      }
    }else if(cell.owner!==pid){
      const rent = Math.floor(cell.price*0.12);
      state.players[pid].cash -= rent; state.players[cell.owner].cash += rent;
      log(`${state.players[pid].name} 向 ${state.players[cell.owner].name} 支付租金 ¥${rent}`);
    }
  }else if(cell.type==='event'){
    triggerEvent(pid);
  }else if(cell.type==='stock'){
    // open trader modal for this stock symbol (if assigned)
    const sym = cell.stockSymbol || (`S${pos}`);
    if(!state.market[sym]) state.market[sym] = { price: 80 + Math.floor(Math.random()*140), vol: 20 };
    log(`${state.players[pid].name} 发现股票 ${sym} （当前价 ¥${state.market[sym].price}）`);
    // open trader modal to allow manual buy/sell
    showStockTrader(pid);
  }
  renderPlayersPanel(); renderMarketPanel(); checkPlayerBankrupt(pid);
  // next turn
  // nextTurn will be triggered after any modal actions; if no modal opened, advance
  if(!state._awaitingModal) nextTurn();
}

// Event card system
const EVENT_CARDS = [
  {type:'gain',amt:300,txt:'签下大订单，获得'},
  {type:'lose',amt:200,txt:'供应链延误，支付'},
  {type:'move',amt:2,txt:'货物提前发出，前进'},
  {type:'move',amt:-3,txt:'税务检查，退后'},
  {type:'market_up',amt:0,txt:'市场利好，部分股票上涨'},
  {type:'market_down',amt:0,txt:'市场震荡，部分股票下跌'},
  {type:'dividend',amt:50,txt:'公司发放股息，获得'},
  {type:'business_bonus',amt:0,txt:'你的企业获得额外利润'},
  {type:'windfall',amt:500,txt:'意外收入，获得'},
  {type:'tax',amt:150,txt:'税务征收，支付'},
  {type:'loan_offer',amt:500,txt:'银行提供贷款，可接受或拒绝'},
  {type:'bank_audit',amt:0,txt:'银行审计，若负债过高将被罚款'},
  {type:'move_random',amt:0,txt:'物流变化，随机移动'},
];

function drawEventCard(){
  return EVENT_CARDS[Math.floor(Math.random()*EVENT_CARDS.length)];
}

// modal helpers
function showModal(html){
  // pause the per-turn timer while a modal is open to avoid auto-skipping the player's turn
  stopTurnTimer();
  const root = document.getElementById('modalRoot'); root.style.display='block'; root.innerHTML = `<div class="modal"><div class="card">${html}</div></div>`;
}

function closeModal(skipNext){
  const root = document.getElementById('modalRoot'); root.style.display='none'; root.innerHTML=''; state._awaitingModal=false;
  if(!skipNext) {
    // advance the turn as before
    nextTurn();
  } else {
    // resume the per-turn timer for the current player
    startTurnTimer();
  }
}

function showConfirmPurchase(pid, cell, opts){
  state._awaitingModal = true;
  const allowBusiness = opts && opts.allowBusiness;
  const html = `<h3>购买确认</h3><p>${state.players[pid].name}，是否以 ¥${cell.price} 购买 ${cell.name}？</p>` +
    (allowBusiness? `<p>或选择投资为企业（商店/工厂）以获得每回合被动收益（基于投资额的 ${Math.round(CFG.passiveIncomeRate*100)}%）</p>` : '') +
    `<div style="display:flex;gap:8px;justify-content:flex-end"><button id="buyYes">购买地产</button>` + (allowBusiness? `<button id="buyBiz">投资企业</button>` : '') + `<button id="buyNo">放弃</button></div>`;
  showModal(html);
  document.getElementById('buyYes').addEventListener('click', ()=>{
    if(state.players[pid].cash>=cell.price){
      state.players[pid].cash -= cell.price; cell.owner = pid; state.players[pid].properties.push(cell.id);
      log(`${state.players[pid].name} 购买了 ${cell.name}，花费 ¥${cell.price}`);
    } else { log(`${state.players[pid].name} 现金不足，无法购买`); }
    renderPlayersPanel(); renderMarketPanel(); closeModal();
  });
  if(allowBusiness){
    document.getElementById('buyBiz').addEventListener('click', ()=>{
      if(state.players[pid].cash>=cell.price){
        state.players[pid].cash -= cell.price; cell.business = { owner: pid, base: cell.price, type:'shop' };
        state.players[pid].properties.push(cell.id);
        log(`${state.players[pid].name} 在 ${cell.name} 投资企业（投入 ¥${cell.price}）`);
      } else { log('现金不足，无法投资企业'); }
      renderPlayersPanel(); renderMarketPanel(); closeModal();
    });
  }
  document.getElementById('buyNo').addEventListener('click', ()=>{ log(`${state.players[pid].name} 放弃购买 ${cell.name}`); closeModal(true); startAuction(cell); });
}

function showStockTrader(pid){
  state._awaitingModal = true;
  // build market rows with buy/sell inputs
  let rows = '';
  for(const k in state.market){
    const p = state.market[k].price;
    const owned = state.players[pid].stocks[k] || 0;
    rows += `<div style="display:flex;align-items:center;gap:8px;margin:6px 0"><div style="flex:1">${k} — ¥${p} (持有 ${owned})</div><input id="in_${k}" type="number" min="0" value="0" style="width:80px"/><button data-buy="${k}">买入</button><button data-sell="${k}">卖出</button></div>`;
  }
  if(rows==='') rows = '<div class="small">当前无在售股票格，继续游戏以触发股票机会。</div>';
  const html = `<h3>股票交易 — ${state.players[pid].name}</h3><div>${rows}</div><div style="text-align:right;margin-top:8px"><button id="closeTrade">关闭</button></div>`;
  showModal(html);
  document.getElementById('closeTrade').addEventListener('click', ()=>{ closeModal(true); });
  // attach buy/sell handlers
  document.querySelectorAll('[data-buy]').forEach(btn=>btn.addEventListener('click', (ev)=>{
    const sym = ev.target.getAttribute('data-buy'); const inp = document.getElementById('in_'+sym); const q = Math.max(0, parseInt(inp.value||'0',10));
    const price = state.market[sym].price; const cost = price*q;
    if(q<=0){ log('请输入购买数量'); return }
    if(state.players[pid].cash>=cost){ state.players[pid].cash -= cost; state.players[pid].stocks[sym] = (state.players[pid].stocks[sym]||0)+q; log(`${state.players[pid].name} 购买 ${q} 股 ${sym}，花费 ¥${cost}`); renderPlayersPanel(); renderMarketPanel(); }
    else { log('现金不足'); }
  }));
  document.querySelectorAll('[data-sell]').forEach(btn=>btn.addEventListener('click', (ev)=>{
    const sym = ev.target.getAttribute('data-sell'); const inp = document.getElementById('in_'+sym); const q = Math.max(0, parseInt(inp.value||'0',10));
    const owned = state.players[pid].stocks[sym]||0; const price = state.market[sym].price;
    if(q<=0){ log('请输入卖出数量'); return }
    if(q>owned){ log('持股不足'); return }
    state.players[pid].stocks[sym] = owned - q; state.players[pid].cash += price*q; log(`${state.players[pid].name} 卖出 ${q} 股 ${sym}，获得 ¥${price*q}`); renderPlayersPanel(); renderMarketPanel();
  }));
}

function triggerEvent(pid){
  const e = drawEventCard();
  // show event modal for player to see details; modal will apply effect when confirmed
  showEventModal(e, pid);
  return; // showEventModal will apply and continue
  if(e.type==='move_random'){ const step = (Math.random()>0.5?1:-1) * (1+Math.floor(Math.random()*3)); movePlayer(pid, step); }
  if(e.type==='market_up'){ const keys=Object.keys(state.market); if(keys.length>0){ const k=keys[Math.floor(Math.random()*keys.length)]; const delta=10+Math.floor(Math.random()*60); state.market[k].price+=delta; log(`市场消息：${k} 上涨 ¥${delta}`);} }
  if(e.type==='market_down'){ const keys=Object.keys(state.market); if(keys.length>0){ const k=keys[Math.floor(Math.random()*keys.length)]; const delta=10+Math.floor(Math.random()*60); state.market[k].price = Math.max(5, state.market[k].price - delta); log(`市场消息：${k} 下跌 ¥${delta}`);} }
  if(e.type==='windfall'){ state.players[pid].cash += e.amt; log(`${state.players[pid].name} 幸运事件：${e.txt} ¥${e.amt}`); }
  if(e.type==='tax'){ state.players[pid].cash -= e.amt; log(`${state.players[pid].name} 被征税：¥${e.amt}`); }
  if(e.type==='loan_offer'){
    const offer = Math.min(2000, 500 + Math.floor(Math.random()*1500));
    showLoanOfferModal(pid, offer);
  }
  if(e.type==='bank_audit'){
    const p = state.players[pid]; const debt = (p.loan||0);
    if(debt>p.cash*1.5){ const fine = Math.floor(debt*0.15); p.cash -= fine; log(`${p.name} 在银行审计中被罚款 ¥${fine}`); }
  }
  if(e.type==='dividend'){ // all players receive small dividend based on holdings
    state.players.forEach(p=>{
      let tot=0; for(const s in p.stocks) tot += (p.stocks[s]||0) * (state.market[s]?.price||0);
      const pay = Math.floor(tot*0.02); if(pay>0){ p.cash += pay; log(`${p.name} 因股息获得 ¥${pay}`); }
    });
  }
  if(e.type==='business_bonus'){
    // pick a random owner business and pay bonus
    state.board.forEach(cell=>{
      if(cell.business && cell.business.owner!=null){ const owner = state.players[cell.business.owner]; const bonus = Math.floor(cell.business.base*0.08); owner.cash += bonus; log(`${owner.name} 的 ${cell.name} 获得企业奖金 ¥${bonus}`); }
    });
  }
  renderPlayersPanel(); renderMarketPanel();
}

function showEventModal(e, pid){
  state._awaitingModal = true;
  const p = state.players[pid];
  let body = `<p>事件：${e.txt} ${e.amt?(' ¥'+e.amt):''}</p>`;
  if(e.type==='loan_offer') body += `<p>银行愿意提供贷款 ¥${Math.min(2000,500+Math.floor(Math.random()*1500))}</p>`;
  body += `<div style="text-align:right;margin-top:8px"><button id="eventOk">确定</button></div>`;
  showModal(`<h3>事件卡</h3>${body}`);
  document.getElementById('eventOk').addEventListener('click', ()=>{
    // apply effect
    applyEventEffect(e, pid);
    closeModal();
  });
}

function applyEventEffect(e, pid){
  const p = state.players[pid];
  if(e.type==='gain'){ p.cash += e.amt; log(`${p.name} ${e.txt} ¥${e.amt}`); }
  else if(e.type==='lose'){ p.cash -= e.amt; log(`${p.name} ${e.txt} ¥${e.amt}`); }
  else if(e.type==='move'){ movePlayer(pid, Math.max(1, e.amt)); }
  else if(e.type==='move_random'){ const step = (Math.random()>0.5?1:-1) * (1+Math.floor(Math.random()*3)); movePlayer(pid, step); }
  else if(e.type==='market_up'){ const keys=Object.keys(state.market); if(keys.length>0){ const k=keys[Math.floor(Math.random()*keys.length)]; const delta=10+Math.floor(Math.random()*60); state.market[k].price+=delta; log(`市场消息：${k} 上涨 ¥${delta}`);} }
  else if(e.type==='market_down'){ const keys=Object.keys(state.market); if(keys.length>0){ const k=keys[Math.floor(Math.random()*keys.length)]; const delta=10+Math.floor(Math.random()*60); state.market[k].price = Math.max(5, state.market[k].price - delta); log(`市场消息：${k} 下跌 ¥${delta}`);} }
  else if(e.type==='windfall'){ p.cash += e.amt; log(`${p.name} 幸运事件：${e.txt} ¥${e.amt}`); }
  else if(e.type==='tax'){ p.cash -= e.amt; log(`${p.name} 被征税：¥${e.amt}`); }
  else if(e.type==='loan_offer'){
    const offer = Math.min(2000, 500 + Math.floor(Math.random()*1500));
    // show accept/decline
    state._awaitingModal = true;
    const html = `<h3>银行贷款提议</h3><p>银行提供给 ${p.name} 一笔贷款：¥${offer}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button id="loanYes">接受</button><button id="loanNo">拒绝</button></div>`;
    showModal(html);
  document.getElementById('loanYes').addEventListener('click', ()=>{ requestLoan(pid, offer); closeModal(true); });
  document.getElementById('loanNo').addEventListener('click', ()=>{ log(`${p.name} 拒绝了贷款`); closeModal(true); });
    return;
  }
  else if(e.type==='bank_audit'){ const debt = (p.loan||0); if(debt>p.cash*1.5){ const fine = Math.floor(debt*0.15); p.cash -= fine; log(`${p.name} 在银行审计中被罚款 ¥${fine}`); } }
  else if(e.type==='dividend'){ state.players.forEach(pl=>{ let tot=0; for(const s in pl.stocks) tot += (pl.stocks[s]||0) * (state.market[s]?.price||0); const pay = Math.floor(tot*0.02); if(pay>0){ pl.cash += pay; log(`${pl.name} 因股息获得 ¥${pay}`); } }); }
  else if(e.type==='business_bonus'){ state.board.forEach(cell=>{ if(cell.business && cell.business.owner!=null){ const owner = state.players[cell.business.owner]; const bonus = Math.floor(cell.business.base*0.08); owner.cash += bonus; log(`${owner.name} 的 ${cell.name} 获得企业奖金 ¥${bonus}`); } }); }
  renderPlayersPanel(); renderMarketPanel();
}

function renderMarketPanel(){
  el.marketPanel.innerHTML = `<h3>股票市场</h3>`;
  for(const k in state.market){
    const it = state.market[k];
    const row = document.createElement('div'); row.className='stockRow';
    const volStr = it.vol ? '(vol:' + it.vol + ')' : '';
    row.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1">${k} - ¥${it.price} ${volStr}</div><div class="spark" data-sym="${k}"></div></div>`;
    el.marketPanel.appendChild(row);
  }
  const tradeBtn = document.createElement('div'); tradeBtn.style.marginTop='8px'; tradeBtn.innerHTML = `<button id="openTrade">交易(打开)</button>`;
  el.marketPanel.appendChild(tradeBtn);
  const viewAuctionBtn = document.createElement('div'); viewAuctionBtn.style.marginTop='6px'; viewAuctionBtn.innerHTML = `<button id="viewLastAuction">查看上次拍卖</button>`;
  el.marketPanel.appendChild(viewAuctionBtn);
  document.getElementById('openTrade').addEventListener('click', ()=>{ showStockTrader(state.currentPlayer); });
  document.getElementById('viewLastAuction').addEventListener('click', ()=>{ showAuctionSummary(); });
  renderAssetsPanel();
  renderSparklines();
}

function showAuctionSummary(){
  if(!state._lastAuction){ showModal('<h3>拍卖记录</h3><p>暂无上次拍卖记录。</p><div style="text-align:right;margin-top:8px"><button id="closeAuctionSummary">关闭</button></div>'); document.getElementById('closeAuctionSummary').addEventListener('click', ()=>closeModal(true)); return; }
  const a = state._lastAuction;
  let body = `<h3>上次拍卖：${state.board[a.cellId]?.name || '未知'}</h3>`;
  body += `<div>起价：¥${a.startPrice} · 获胜者：${a.winner? (a.winner.name + ' ¥' + a.winner.price) : '无人'}</div>`;
  body += `<div style="margin-top:8px"><strong>拍卖历史</strong></div><div style="max-height:200px;overflow:auto;border:1px solid #ccc;background:#fff;padding:6px;margin-top:6px">`;
  (a.history||[]).forEach(it=>{ body += `<div>${it.player} — ${it.action}</div>`; });
  body += `</div><div style="text-align:right;margin-top:8px"><button id="closeAuctionSummary">关闭</button></div>`;
  showModal(body);
  document.getElementById('closeAuctionSummary').addEventListener('click', ()=>closeModal(true));
}

function renderSparklines(){
  document.querySelectorAll('.spark').forEach(elm=>{
    const sym = elm.getAttribute('data-sym'); const s = state.market[sym];
    const hist = (s && s.history) ? s.history : [s ? s.price : 0];
    const w = 80; const h = 28; const min = Math.min.apply(null,hist); const max = Math.max.apply(null,hist);
    const range = Math.max(1, max-min);
    const points = hist.map((v,i)=>{ const x = Math.round(i*(w/(Math.max(1,hist.length-1)))); const y = Math.round(h - ((v-min)/range)*h); return `${x},${y}`; }).join(' ');
    elm.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  });
}

// --- Transactions helpers ---
function recordTransaction(tx){ state.transactions.unshift({time:Date.now(), ...tx}); renderTransactions(); }

function renderTransactions(){ const elTx = document.getElementById('txList'); if(!elTx) return; elTx.innerHTML=''; state.transactions.forEach(t=>{ const p = document.createElement('div'); p.className='tx'; p.textContent = `[${new Date(t.time).toLocaleTimeString()}] ${t.desc}`; elTx.appendChild(p); }); }

function exportTransactions(){ const data = JSON.stringify(state.transactions.slice().reverse(), null, 2); const blob = new Blob([data], {type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'transactions.json'; a.click(); URL.revokeObjectURL(url); }

function replayTransactions(){ if(state.transactions.length===0) return; const arr = state.transactions.slice().reverse(); let i=0; const step=()=>{ if(i>=arr.length) return; log(`重播: ${arr[i].desc}`); i++; setTimeout(step, 600); }; step(); }

// --- AI helper functions ---
function aiShouldBuy(player, cell){
  if(!player || !cell) return false;
  if(player.cash < cell.price) return false;
  // compute simple net worth
  const net = player.cash + (player.properties||[]).reduce((acc,id)=>acc + (state.board[id]?.price||0),0) + Object.keys(player.stocks||{}).reduce((acc,sym)=> acc + (player.stocks[sym]||0)* (state.market[sym]?.price||0),0);
  // expected passive yield (very rough): rent % of price
  const expectedYield = cell.price * 0.12;
  // buy if cheap relative to yield, or if net worth healthy
  if(cell.price <= 600) return true;
  if(net > cell.price * 1.2 && player.cash > cell.price * 0.6) return true;
  // avoid buying if high loan burden
  if((player.loan||0) > player.cash * 1.2) return false;
  return Math.random() < 0.25;
}

function aiMaxBid(player, cell){
  const base = cell.price || 300;
  // keep a reserve of cash (20% of current cash or a minimum)
  const reserve = Math.max(200, Math.floor(player.cash * 0.2));
  const cap = Math.max(0, player.cash - reserve);
  if(base < 500) return Math.min(cap, base + 600);
  return cap;
}

function aiMakeBid(player, cell, currentHighest){
  const max = aiMaxBid(player, cell);
  if(max <= (currentHighest||0)) return null;
  // progressive strategy: raise by a fraction of difference, smaller raises when close to cap
  const gap = Math.max(1, Math.floor((max - (currentHighest||0)) / 6));
  const raise = Math.max(5, Math.floor(gap * (1 + Math.random()*2)));
  const next = (currentHighest||0) + raise;
  if(next <= max) return next;
  return null;
}

function aiLoanDecision(player, offer){
  if(!player) return false;
  // snapshot
  const net = player.cash + (player.properties||[]).reduce((acc,id)=>acc + (state.board[id]?.price||0),0);
  const currentLoan = player.loan || 0;
  // estimate remaining rounds (turns per player)
  const avgTurnSec = (CFG.turnTimeSec || 90);
  const remainingRounds = Math.max(1, Math.floor(state.timeLeft / (avgTurnSec * Math.max(1, state.players.length))));

  // simulate compound interest over remainingRounds for the new offer
  const r = state.bank.interestRate || 0.06; // per-round rate approximation
  // compound the offered amount over remainingRounds
  const compounded = Math.ceil( offer * Math.pow(1 + r, remainingRounds) );
  const totalFutureObligation = compounded + currentLoan; // rough view

  // estimate expected income streams over remainingRounds
  let expectedIncome = 0;
  // 1) passive business income from owned businesses
  (player.properties||[]).forEach(id=>{ const c = state.board[id]; if(c && c.business && c.business.owner===player.id){ expectedIncome += Math.floor(c.business.base * CFG.passiveIncomeRate) * remainingRounds; } });
  // 2) expected rent income: assume each property yields a small chance to collect rent per round (rough)
  const rentPerProp = 0.08; // 8% of price as rough per-collection; assume 0.6 chance per round
  expectedIncome += player.properties.reduce((acc,id)=>{ const c = state.board[id]; if(!c) return acc; const est = Math.floor((c.price||0) * rentPerProp * 0.6 * remainingRounds); return acc + est; }, 0);
  // 3) stock dividends/sales: estimate small dividend per stock holding
  for(const s in player.stocks){ const qty = player.stocks[s]||0; const price = (state.market[s]?.price||0); expectedIncome += Math.floor(price * 0.01 * qty * remainingRounds); }

  // risk adjustments: existing loan burden reduces appetite
  if(currentLoan > player.cash * 0.9) return false;

  // decision heuristics:
  // If the player's cash is dangerously low but expected income plus net can cover the compounded obligation comfortably, accept.
  if(player.cash < Math.max(200, offer * 0.3)){
    if( (player.cash + expectedIncome + net) > totalFutureObligation * 1.2 ) return true;
  }

  // If offer is small vs net and expected income covers interest, be somewhat permissive
  if( offer < net * 0.2 && expectedIncome > (compounded - offer) * 0.3 ) return Math.random() < 0.45;

  // otherwise be conservative
  return false;
}

// --- Bank / Loan functions ---
function requestLoan(pid, amt){
  const p = state.players[pid]; if(!p) return false;
  const maxLoan = Math.max(0, Math.floor(p.cash*2) + 1000);
  const loanAmt = Math.min(amt, maxLoan);
  p.loan = (p.loan||0) + loanAmt;
  p.cash += loanAmt;
  state.bank.loans.push({player:pid, amt:loanAmt, rate: state.bank.interestRate, dueRounds: 10});
  log(`${p.name} 从银行贷款 ¥${loanAmt}（利率 ${(state.bank.interestRate*100).toFixed(1)}%）`);
  recordTransaction({type:'loan', desc:`${p.name} 贷款 ¥${loanAmt}`, player: pid, amt: loanAmt});
  renderPlayersPanel(); renderAssetsPanel();
  return true;
}

function repayLoan(pid, amt){
  const p = state.players[pid]; if(!p || !p.loan) return false;
  const pay = Math.min(amt, p.loan, p.cash);
  p.loan -= pay; p.cash -= pay;
  if(p.loan<=0) p.loan = 0;
  log(`${p.name} 偿还贷款 ¥${pay}`);
  recordTransaction({type:'loan_repay', desc:`${p.name} 偿还贷款 ¥${pay}`, player: pid, amt: pay});
  renderPlayersPanel(); renderAssetsPanel();
  return true;
}

function accrueLoanInterest(){
  state.players.forEach(p=>{
    if(p.loan && p.loan>0){ const interest = Math.ceil(p.loan * state.bank.interestRate); p.loan += interest; log(`${p.name} 的贷款利息增加 ¥${interest}`); recordTransaction({type:'loan_interest', desc:`${p.name} 贷款利息 ¥${interest}`, player: p.id, amt: interest}); }
  });
}

function showLoanOfferModal(pid, offer){
  state._awaitingModal = true;
  const html = `<h3>银行贷款提议</h3><p>银行提供给 ${state.players[pid].name} 一笔贷款：¥${offer}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button id="loanAccept">接受</button><button id="loanDecline">拒绝</button></div>`;
  showModal(html);
  document.getElementById('loanAccept').addEventListener('click', ()=>{ requestLoan(pid, offer); closeModal(true); });
  document.getElementById('loanDecline').addEventListener('click', ()=>{ log(`${state.players[pid].name} 拒绝了银行贷款`); closeModal(true); });
}

// Unified loan modal for side-panel actions (borrow or repay)
function showLoanModal(pid, mode){
  const p = state.players[pid]; if(!p) return;
  state._awaitingModal = true;
  const currentLoan = p.loan || 0;
  const html = `<h3>贷款 - ${p.name}</h3>
    <div>当前现金: ¥${p.cash}</div>
    <div>当前贷款: ¥${currentLoan}</div>
    <div style="margin-top:8px">请输入金额：</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px"><input id="loanAmtInput" type="number" value="500" style="width:120px"/></div>
    <div style="text-align:right;margin-top:8px"><button id="loanSubmit">确定</button><button id="loanCancel">取消</button></div>`;
  showModal(html);
  document.getElementById('loanCancel').addEventListener('click', ()=>{ closeModal(true); });
  document.getElementById('loanSubmit').addEventListener('click', ()=>{
    const amt = Math.max(0, parseInt(document.getElementById('loanAmtInput').value||'0',10));
    if(amt<=0){ log('请输入有效金额'); return; }
    if(mode==='borrow'){
      requestLoan(pid, amt);
    } else {
      repayLoan(pid, amt);
    }
    closeModal(true);
  });
}


// Simple auction demo: when a player declines purchase, all players may bid randomly.
// Turn-based auction modal: each player gets a chance to bid or pass. AI players auto-bid using aiMakeBid.
function startAuction(cell){
  if(!cell) return;
  if(cell.owner!=null){ log('拍卖取消：地块已被购买'); return; }
  state._awaitingModal = true;
  const startPrice = Math.max(5, Math.floor((cell.price||10)/2));
  let highest = {pid:null, bid:startPrice-1};
  const passed = new Set();
  const order = state.players.map(p=>p.id);
  let idx = 0;

  function nextBid(){
    // if only one active bidder left, finish
    if(order.length - passed.size <= 1){ finishAuction(); return; }
    // find next bidder who hasn't passed
    let attempts = 0;
    while(passed.has(order[idx]) && attempts < order.length){ idx = (idx+1)%order.length; attempts++; }
    const pid = order[idx];
    const player = state.players.find(p=>p.id===pid);
    if(!player){ idx = (idx+1)%order.length; setTimeout(nextBid, 50); return; }
    // initialize current auction tracking if missing
    if(!state._currentAuction){ state._currentAuction = { cellId: cell.id, startPrice: startPrice, highest: highest, history: [] }; }
    // AI auto-decision
    if(player.isAI){
      const bid = aiMakeBid(player, cell, highest.bid);
      if(bid && bid > highest.bid && bid <= player.cash){ highest = {pid:pid, bid}; log(`${player.name} 出价 ¥${bid}`); recordTransaction({type:'auction_bid', desc:`${player.name} 出价 ¥${bid}`, player: pid, cell: cell.id, price: bid}); }
      else { passed.add(pid); log(`${player.name} 放弃竞价`); }
      // record AI action in auction history
      state._currentAuction.history.push({player: player.name, action: bid?`bid ${bid}`:'pass', pid});
      idx = (idx+1)%order.length; setTimeout(nextBid, 350); return;
    }

    // human player: show modal to bid or pass
    // build enhanced modal with history and a progress bar countdown
    const historyHtml = `<div id="auctionHistory" style="max-height:120px;overflow:auto;border:1px solid #ccc;background:#fff;padding:6px;margin-bottom:8px"></div>`;
    const html = `<h3>拍卖 — ${cell.name}</h3>
      <div>当前最高: ${highest.bid>0?('¥'+highest.bid):'无'}</div>
      ${historyHtml}
      <div style="margin-top:8px">${state.players[pid].name}，请输入出价（或点击 放弃）</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><input id="auctionInput" type="number" min="${Math.max(startPrice, highest.bid+1)}" value="${Math.max(startPrice, highest.bid+1)}" style="width:120px"/><button id="auctionBid">出价</button><button id="auctionPass">放弃</button></div>
      <div style="margin-top:8px"><div style="background:#eee;border:1px solid #ccc;height:12px;width:100%"><div id="auctionProgress" style="height:12px;background:linear-gradient(90deg,#06b6d4,#0ea5a4);width:100%"></div></div></div>`;
    showModal(html);
  // populate history container with any previous bids from current auction
  const histEl = document.getElementById('auctionHistory'); if(histEl){ const h = (state._currentAuction && state._currentAuction.history) ? state._currentAuction.history : (state._auctionHistory||[]); histEl.innerHTML = h.map(item=>`<div>${item.player} — ${item.action}</div>`).join(''); }
    // start per-bid progress bar using configurable timeout
    const timeoutSec = Math.max(2, Math.floor(CFG.auctionBidTimeout || 10));
    let elapsed = 0; const stepMs = 200; const totalSteps = Math.ceil((timeoutSec*1000)/stepMs);
    const progressEl = document.getElementById('auctionProgress');
    const progressId = setInterval(()=>{
      elapsed += 1;
      if(progressEl) progressEl.style.width = `${Math.max(0, 100 - Math.round((elapsed/totalSteps)*100))}%`;
      if(elapsed >= totalSteps){ clearInterval(progressId); // auto pass
        log(`${state.players[pid].name} 超时，自动放弃`); passed.add(pid);
        if(state._currentAuction) state._currentAuction.history.push({player: state.players[pid].name, action: 'timeout-pass', pid});
        closeModal(true); idx = (idx+1)%order.length; setTimeout(nextBid, 200);
      }
    }, stepMs);
    document.getElementById('auctionBid').addEventListener('click', ()=>{
      clearInterval(progressId);
      const v = parseInt(document.getElementById('auctionInput').value||'0',10);
      if(isNaN(v) || v<=highest.bid){ log('出价无效'); return; }
      if(v>state.players[pid].cash){ log('现金不足，无法出此价'); return; }
      highest = {pid:pid,bid:v}; log(`${state.players[pid].name} 出价 ¥${v}`); recordTransaction({type:'auction_bid', desc:`${state.players[pid].name} 出价 ¥${v}`, player: pid, cell: cell.id, price: v});
      if(state._currentAuction) state._currentAuction.history.push({player: state.players[pid].name, action:`bid ${v}`, pid});
      closeModal(true); idx = (idx+1)%order.length; setTimeout(nextBid, 200);
    });
    document.getElementById('auctionPass').addEventListener('click', ()=>{ clearInterval(progressId); log(`${state.players[pid].name} 放弃竞价`); passed.add(pid); if(state._currentAuction) state._currentAuction.history.push({player: state.players[pid].name, action:'pass', pid}); closeModal(true); idx = (idx+1)%order.length; setTimeout(nextBid, 200); });
  }

  function finishAuction(){
    closeModal(); state._awaitingModal = false;
    if(!highest.pid || highest.bid < startPrice){ log('拍卖流拍：无人出价或出价不足'); return; }
    const winner = state.players.find(p=>p.id===highest.pid);
    if(!winner){ log('拍卖出错：未找到获胜者'); return; }
    winner.cash -= highest.bid; if(!winner.properties.includes(cell.id)) winner.properties.push(cell.id); cell.owner = winner.id; cell.price = highest.bid;
    log(`${winner.name} 以 ¥${highest.bid} 赢得拍卖，获得 ${cell.name}`);
    recordTransaction({type:'auction_win', desc:`${winner.name} 在拍卖中以 ¥${highest.bid} 获得 ${cell.name}`, player: winner.id, cell: cell.id, price: highest.bid});
    // finalize auction record
    if(state._currentAuction){ state._currentAuction.highest = highest; state._currentAuction.winner = { id: winner.id, name: winner.name, price: highest.bid }; state._lastAuction = state._currentAuction; state._currentAuction = null; }
    renderPlayersPanel(); renderMarketPanel(); renderTransactions();
  }

  log(`拍卖开始：${cell.name} （起价 ¥${startPrice}）`);
  setTimeout(nextBid, 350);
}


function renderAssetsPanel(){
  const p = state.players[state.currentPlayer];
  if(!p) { el.assetsPanel.innerHTML=''; return }
  var html = '<h4>资产 - ' + p.name + '</h4><div class="small">现金: ¥' + p.cash + '</div>';
  html += `<div class="small">贷款: ¥${p.loan||0} <button id="btnRequestLoan">申请贷款</button> <button id="btnRepayLoan">偿还贷款</button></div>`;
  html += '<div class="small">地产:</div><ul>';
  p.properties.forEach(function(id){ var c = state.board[id]; html += '<li>' + c.name + (c.business?(' (企业)'): '') + (c.owner!=null?(' - 所有者: ' + state.players[c.owner].name):'') + (c.price?(' ¥' + c.price):'') + '</li>'; });
  html += '</ul>';
  html += '<div class="small">股票持仓:</div><ul>';
  for(const s in p.stocks){ html += '<li>' + s + ' x' + p.stocks[s] + ' @ ¥' + (state.market[s] ? state.market[s].price : 0) + '</li>'; }
  html += '</ul>';
  el.assetsPanel.innerHTML = html;
  // wire loan buttons to modal-based flow
  const req = document.getElementById('btnRequestLoan'); if(req) req.addEventListener('click', ()=>{ showLoanModal(state.currentPlayer, 'borrow'); });
  const rep = document.getElementById('btnRepayLoan'); if(rep) rep.addEventListener('click', ()=>{ showLoanModal(state.currentPlayer, 'repay'); });
}

function nextTurn(){
  const prev = state.currentPlayer;
  state.currentPlayer = (state.currentPlayer+1)%state.players.length;
  // if we wrapped to player 0, a full round completed
  if(state.currentPlayer===0 && prev!==0){
    distributePassiveIncome();
    // accrue loan interest each full round
    accrueLoanInterest();
    // market updates once per full round
    updateMarketForRound();
  }
  // restart per-turn timer for the new player
  startTurnTimer();
  renderPlayersPanel();
}

function distributePassiveIncome(){
  state.players.forEach(p=>{
    let inc = 0; p.properties.forEach(id=>{ const c = state.board[id]; if(c.business && c.business.owner===p.id){ inc += Math.floor(c.business.base * CFG.passiveIncomeRate); }});
    if(inc>0){ p.cash += inc; log(`${p.name} 获得企业被动收益 ¥${inc}`); }
  });
  renderPlayersPanel();
}

function checkPlayerBankrupt(pid){
  const p = state.players[pid];
  if(p.cash< -1000){
    log(`${p.name} 破产，被淘汰`);
    // simple elimination
    state.players.splice(pid,1);
    if(state.currentPlayer>=state.players.length) state.currentPlayer=0;
  }
}

function startRoundTimer(){
  updateTimerDisplay();
  state._timerInterval = setInterval(()=>{
    state.timeLeft--; if(state.timeLeft<=0){clearInterval(state._timerInterval); endGame();}
    updateTimerDisplay();
    // per-second tasks: only update display
    renderMarketPanel();
  },1000);
}

// update market prices once per full round (after every player had a turn)
function updateMarketForRound(){
  for(const k in state.market){
    const s = state.market[k];
    // random percent change between -8% and +8%
    const pct = (Math.random()*16 - 8)/100;
    const delta = Math.max(1, Math.floor(s.price * pct));
    s.price = Math.max(5, s.price + delta);
    // push history and cap length
    s.history = s.history || [];
    s.history.push(s.price);
    if(s.history.length>40) s.history.shift();
  }
  log('市场：本轮结算，股票价格更新');
  renderMarketPanel();
}

function updateTimerDisplay(){
  const m = Math.floor(state.timeLeft/60); const s=state.timeLeft%60; el.timeLeft.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function endGame(){
  // compute net worth and show settlement modal
  const ranks = state.players.map(p=>({id:p.id,name:p.name,net:p.cash+ p.properties.reduce((acc,id)=>acc + (state.board[id]?.price||0),0) + Object.keys(p.stocks).reduce((acc,sym)=> acc + (p.stocks[sym]||0)* (state.market[sym]?.price||0),0)}));
  ranks.sort((a,b)=>b.net-a.net);
  let body = `<h3>游戏结束 — 结算</h3><div>冠军：${ranks[0].name} · 资产 ¥${ranks[0].net}</div><div style="margin-top:8px"><ol>`;
  ranks.forEach(r=>{ body += `<li>${r.name} — 资产 ¥${r.net}</li>`; });
  body += `</ol></div><div style="margin-top:8px;text-align:right"><button id="exportResults">导出交易记录</button> <button id="closeSettlement">关闭</button></div>`;
  showModal(body);
  document.getElementById('exportResults').addEventListener('click', ()=>{ exportTransactions(); });
  document.getElementById('closeSettlement').addEventListener('click', ()=>{ closeModal(true); el.rollBtn.disabled=true; el.startBtn.disabled=false; });
}

el.startBtn.addEventListener('click', startGame);
el.rollBtn.addEventListener('click', async ()=>{ if(el.rollBtn.disabled) return; el.rollBtn.disabled=true; try{ await rollDice(); }finally{ el.rollBtn.disabled=false; } });
el.helpBtn.addEventListener('click', ()=>{
  const d = document.createElement('div'); d.className='modal';
  d.innerHTML = `<div class="card"><h3>游戏帮助</h3><p>1) 选择玩家人数和局时后点击开始。 2) 每位玩家轮流掷骰子并自动移动。3) 遇到地块会尝试购买，遇到事件会触发随机效果，遇到股票格可购股。4) 时间到结算净资产（现金+地皮+股票）。</p><div style="text-align:right"><button id=closeHelp>关闭</button></div></div>`;
  document.body.appendChild(d);
  document.getElementById('closeHelp').addEventListener('click', ()=>d.remove());
});

// initial render
createBoard(); renderBoard();
renderPlayersPanel(); renderMarketPanel();
log('欢迎！点击 开始游戏 启动。');

// wire export/replay buttons if present
document.addEventListener('DOMContentLoaded', ()=>{
  const e = document.getElementById('exportTx'); if(e) e.addEventListener('click', exportTransactions);
  const r = document.getElementById('replayTx'); if(r) r.addEventListener('click', replayTransactions);
});
