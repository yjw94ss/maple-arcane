'use strict';

/* =========================================================
   主游戏
   ========================================================= */
const canvasEl = document.getElementById('game');
const ctx = canvasEl.getContext('2d', { alpha: false });
const stageEl = document.getElementById('stage');
let viewScale = 1;
let vignette = null;
let renderCap = 1.5;   // 渲染倍率上限，帧率过低时自动下调
let fpsSamples = [];
let perfChecked = false;

const FIXED = 1 / 60;

const GAME = {
  state: 'start',
  time: 0,
  acc: 0,
  keys: new Set(),
  jumpBuffer: 0,
  camX: 0,
  shakeAmt: 0,
  hitstop: 0,
  flash: 0,
  flashColor: [255, 255, 255],
  player: null,
  monsters: [],
  projectiles: [],
  effects: [],
  particles: [],
  pickups: [],
  boss: null,
  bossActive: false,
  combo: { n: 0, t: 0, mult: 1 },
  kills: 0,
  damageDealt: 0,
  reactionCount: 0,
  maxCombo: 0,
  tips: {},
  regionIndex: 0,
  runTime: 0,
  ambientT: 0,
  _helpFromPlaying: false,
};

/* ---------------------------------------------------------
   自适应分辨率
   --------------------------------------------------------- */
function resizeStage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = Math.min(vw / CONFIG.W, vh / CONFIG.H);
  stageEl.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  // HUD 反向放大系数：抵消 #stage 的 scale，让 HP 条和技能槽在手机上保持真实像素大小
  // 上限 2.8 是为了别让元素放大后超出 1280x720 逻辑画布被 #stage 的 overflow 裁掉
  stageEl.style.setProperty('--inv', String(Math.min(1 / Math.max(s, 0.05), 2.8)));

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const total = clamp(s * dpr, 0.6, renderCap);
  viewScale = total;

  canvasEl.width = Math.round(CONFIG.W * total);
  canvasEl.height = Math.round(CONFIG.H * total);
  canvasEl.style.width = CONFIG.W + 'px';
  canvasEl.style.height = CONFIG.H + 'px';

  ctx.setTransform(total, 0, 0, total, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  vignette = ctx.createRadialGradient(
    CONFIG.W / 2, CONFIG.H * 0.44, CONFIG.H * 0.3,
    CONFIG.W / 2, CONFIG.H * 0.52, CONFIG.H * 0.98
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.7, 'rgba(0,0,0,0.18)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
}

/* ---------------------------------------------------------
   设备 / 屏幕方向
   --------------------------------------------------------- */
// ?touch=1 / ?touch=0 可强制切换控制方式（调试、或在无触摸检测的设备上用手柄式操作）
const TOUCH_FORCE = (() => {
  const m = /[?&]touch=(0|1)/.exec(location.search);
  return m ? m[1] === '1' : null;
})();

const TOUCH = (() => {
  if (TOUCH_FORCE !== null) return TOUCH_FORCE;
  const mq = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
  const coarse = mq('(pointer: coarse)');
  const noHover = mq('(hover: none)');
  const fine = mq('(pointer: fine)');
  const touchPts = (navigator.maxTouchPoints || 0) > 0 || ('ontouchstart' in window);
  // 手机 / 平板：粗指针且无悬停；触屏笔记本（有精确指针 + hover）仍按键鼠处理
  return (coarse && noHover) || (touchPts && noHover) || (touchPts && !fine);
})();

function applyDeviceClass() {
  const portrait = window.innerHeight > window.innerWidth;
  document.body.classList.toggle('is-touch', TOUCH);
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = TOUCH ? '❚❚ 暂停 · 点技能可按住连发' : 'ESC 暂停 · H 技能说明';
  if (!TOUCH) {
    document.body.classList.remove('is-portrait');
    return;
  }
  const wasRotatePause = GAME._rotPause;
  document.body.classList.toggle('is-portrait', portrait);
  if (portrait) {
    if (GAME.state === 'playing') {
      GAME.state = 'paused';
      GAME._rotPause = true;
    }
    GAME.keys.clear();
  } else if (wasRotatePause && GAME.state === 'paused') {
    // 转回横屏自动继续
    GAME.state = 'playing';
    GAME._rotPause = false;
    lastT = 0;
  }
}

// 手机上地址栏伸缩会疯狂触发 resize，必须防抖（否则画面跳动、点击坐标错位）
let _rsTimer = 0;
function onResize() {
  clearTimeout(_rsTimer);
  _rsTimer = setTimeout(() => {
    applyDeviceClass();
    resizeStage();
  }, 140);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => {
  applyDeviceClass();
  setTimeout(resizeStage, 120);
});

/* ---------------------------------------------------------
   辅助
   --------------------------------------------------------- */
GAME.shake = function (amt) {
  this.shakeAmt = Math.min(this.shakeAmt + amt, 26);
};

GAME.flashScreen = function (a, color) {
  this.flash = Math.max(this.flash, a);
  this.flashColor = color || [255, 255, 255];
};

GAME.burst = function (x, y, color, count, speed, life) {
  const lf = life || 0.5;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU;
    const sp = rand(0.25, 1) * speed;
    this.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 30,
      life: lf * rand(0.6, 1.4),
      maxLife: lf,
      size: rand(1.6, 4.6),
      color,
      gravity: 360,
      glow: true,
    });
  }
  if (this.particles.length > 520) this.particles.splice(0, this.particles.length - 520);
};

GAME.emit = function (p) {
  this.particles.push(p);
  if (this.particles.length > 520) this.particles.splice(0, this.particles.length - 520);
};

GAME.ring = function (x, y, r, color, dur) {
  this.effects.push(new Ring(x, y, r, color, dur));
};

GAME.addFloatText = function (x, y, text, color, opts) {
  this.effects.push(new FloatText(x, y, text, color, opts));
};

GAME.addDamageText = function (x, y, val, element, crit, small) {
  let color;
  if (element === 'player-hurt') color = '#ff7585';
  else if (crit) color = '#fff3c4';
  else {
    const c = ELEMENT_COLORS[element] || ELEMENT_COLORS.arcane;
    color = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  }
  this.effects.push(new FloatText(x, y, val, color, {
    size: crit ? 24 : small ? 12 : 17,
    dur: crit ? 1.0 : 0.82,
    vy: crit ? -90 : -66,
  }));
  if (crit) {
    this.effects.push(new FloatText(x + rand(-6, 6), y - 16, 'CRIT', '#ffe9a8', { size: 11, dur: 0.7, vy: -80 }));
  }
};

GAME.addReactionText = function (x, y, text, color) {
  this.effects.push(new FloatText(x, y, text, 'rgb(' + (color[0] | 0) + ',' + (color[1] | 0) + ',' + (color[2] | 0) + ')', {
    size: 21, dur: 1.1, vy: -70,
  }));
};

GAME.spawnProjectile = function (o) {
  this.projectiles.push(new Projectile(o));
};

GAME.damageMonster = function (m, dmg, element, opts) {
  const dealt = m.hit(dmg, element, this, opts);
  this.damageDealt += dealt || 0;
  return dealt;
};

GAME.projectileHit = function (proj, m) {
  this.damageMonster(m, proj.dmg, proj.element);
  this.burst(proj.x, proj.y, proj.color, 9, 210, 0.5);
  this.ring(proj.x, proj.y, 26, proj.color, 0.24);
};

GAME.aoe = function (x, y, radius, dmg, element, opts) {
  opts = opts || {};
  const list = this.monsters.concat(this.boss && !this.boss.dead ? [this.boss] : []);
  for (const m of list) {
    if (m.dead || m === opts.exclude) continue;
    const d = Math.hypot(m.cx - x, m.cy - y);
    if (d < radius + Math.max(m.w, m.h) * 0.5) {
      this.damageMonster(m, dmg, element, {
        noReact: opts.noReact,
        noCombo: opts.noCombo,
        noCrit: opts.noCrit,
        ignoreCombo: opts.ignoreCombo,
      });
    }
  }
};

GAME.meteorImpact = function (x, dmg) {
  const g = this;
  g.aoe(x, WORLD.groundY - 30, 200, dmg, 'fire');
  g.effects.push(new Blast(x, WORLD.groundY - 34, 300, [255, 170, 90], 0.55));
  g.effects.push(new Ring(x, WORLD.groundY - 20, 300, [255, 210, 150], 0.7));
  g.ring(x, WORLD.groundY - 20, 240, [255, 160, 90], 0.6);
  g.ring(x, WORLD.groundY - 20, 140, [255, 230, 180], 0.45);
  g.shake(22);
  g.flashScreen(0.4, [255, 170, 110]);
  g.hitstop = Math.max(g.hitstop, 0.06);
  for (let i = 0; i < 40; i++) {
    g.burst(x + rand(-90, 90), WORLD.groundY - rand(0, 40), [255, rand(120, 200), rand(50, 110)], 1, 460, 1.0);
  }
  SFX.explode();
};

GAME.tip = function (key, msg) {
  if (this.tips[key]) return;
  this.tips[key] = true;
  this.toast(msg, 'warning');
};

GAME.registerHit = function (element, isReaction) {
  const c = this.combo;
  c.n += isReaction ? 3 : 1;
  c.t = CONFIG.comboWindow;
  c.mult = Math.min(1 + c.n * 0.045, 1.9);
  if (c.n > this.maxCombo) this.maxCombo = c.n;
};

GAME.toast = function (msg, type) {
  UI.toast(msg, type);
};

/* ---------------------------------------------------------
   事件
   --------------------------------------------------------- */
GAME.onMonsterDeath = function (m, silent) {
  this.kills++;
  if (!m.noExp) this.player.gainExp(m.def.exp, this);
  this.burst(m.cx, m.cy, m.def.color, 22, 280, 0.8);
  this.ring(m.cx, m.cy, 50, m.def.color, 0.4);
  this.addFloatText(m.cx, m.y - 30, '+' + m.def.exp + ' EXP', '#ffe9a8', { size: 11, dur: 0.9, vy: -46 });
  if (!silent) SFX.explode();

  // 掉落
  if (chance(0.34)) {
    this.pickups.push(new Pickup(m.cx, m.cy, chance(0.45) ? 'hp' : 'mp'));
  }

  if (m.spawner) {
    m.spawner.alive = false;
    m.spawner.timer = rand(7, 11);
  }
};

GAME.onBossDeath = function (b) {
  this.kills++;
  this.bossActive = false;
  this.burst(b.cx, b.cy, [200, 140, 255], 60, 520, 1.4);
  for (let i = 0; i < 5; i++) {
    this.ring(b.cx, b.cy, 120 + i * 70, [220, 170, 255], 1.0 + i * 0.15);
  }
  this.shake(26);
  this.flashScreen(0.7, [230, 200, 255]);
  this.player.gainExp(b.def.exp, this);
  SFX.explode();
  SFX.victory();
  clearTimeout(this._winTimer);
  this._winTimer = setTimeout(() => this.victory(), 1500);
};

GAME.onLevelUp = function () {
  const p = this.player;
  SFX.levelUp();
  UI.showLevelUp(p.level);
  this.ring(p.cx, p.cy, 160, [255, 220, 140], 0.9);
  this.ring(p.cx, p.cy, 110, [200, 170, 255], 0.7);
  for (let i = 0; i < 46; i++) {
    this.emit({
      x: p.cx + rand(-20, 20), y: p.cy + rand(-20, 20),
      vx: rand(-140, 140), vy: rand(-320, -90),
      life: rand(0.8, 1.5), maxLife: 1.5,
      size: rand(2, 5), color: [255, 225, 150], gravity: -60, glow: true,
    });
  }
  this.flashScreen(0.25, [255, 230, 170]);
};

GAME.onPlayerDeath = function () {
  if (this.state !== 'playing') return;
  this.state = 'dead';
  SFX.death();
  this.shake(20);
  this.flashScreen(0.6, [255, 60, 80]);
  const p = this.player;
  this.burst(p.cx, p.cy, [180, 140, 255], 40, 320, 1.2);
  this.fillStats('deadStats');
  clearTimeout(this._deadTimer);
  this._deadTimer = setTimeout(() => {
    if (this.state === 'dead') document.getElementById('deadScreen').classList.remove('hidden');
  }, 700);
};

GAME.victory = function () {
  if (this.state !== 'playing') return;
  this.state = 'victory';
  this.fillStats('winStats');
  document.getElementById('winScreen').classList.remove('hidden');
};

GAME.fillStats = function (id) {
  const p = this.player;
  const box = document.getElementById(id);
  const t = Math.floor(this.runTime);
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  box.innerHTML =
    '<div><span>等级</span><b>Lv.' + p.level + '</b></div>' +
    '<div><span>击杀</span><b>' + this.kills + '</b></div>' +
    '<div><span>总伤害</span><b>' + Math.round(this.damageDealt).toLocaleString() + '</b></div>' +
    '<div><span>元素反应</span><b>' + this.reactionCount + '</b></div>' +
    '<div><span>最高连携</span><b>' + this.maxCombo + '</b></div>' +
    '<div><span>用时</span><b>' + mm + ':' + ss + '</b></div>';
};

/* ---------------------------------------------------------
   开始 / 重置
   --------------------------------------------------------- */
function startGame() {
  clearTimeout(GAME._winTimer);
  clearTimeout(GAME._deadTimer);
  document.getElementById('deadScreen').classList.add('hidden');
  generateWorld();
  const g = GAME;

  g.state = 'playing';
  g.time = 0;
  g.acc = 0;
  g.camX = 0;
  g.shakeAmt = 0;
  g.hitstop = 0;
  g.flash = 0;
  g.monsters = [];
  g.projectiles = [];
  g.effects = [];
  g.particles = [];
  g.pickups = [];
  g.boss = null;
  g.bossActive = false;
  g.combo = { n: 0, t: 0, mult: 1 };
  g.kills = 0;
  g.damageDealt = 0;
  g.reactionCount = 0;
  g.maxCombo = 0;
  g.runTime = 0;
  g.regionIndex = 0;
  g.player = new Player(220, WORLD.groundY);
  g.keys.clear();
  g.jumpBuffer = 0;

  for (const sp of spawnerList) {
    sp.alive = false;
    sp.monster = null;
    sp.timer = rand(0, 1.2);
  }

  UI.reset();
  UI.init();
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('deadScreen').classList.add('hidden');
  document.getElementById('winScreen').classList.add('hidden');
  document.getElementById('pauseScreen').classList.add('hidden');
  document.getElementById('helpScreen').classList.add('hidden');

  const hint = document.getElementById('hint');
  hint.classList.remove('gone');
  setTimeout(() => hint.classList.add('gone'), 6000);

  UI.showRegion(REGIONS[0].name);
  UI.toast('用 A / D 移动，空格跳跃，1–9 释放技能', 'good');
}

/* ---------------------------------------------------------
   单步逻辑
   --------------------------------------------------------- */
GAME.step = function (dt) {
  this.runTime += dt;
  const p = this.player;

  /* 连携衰减 */
  if (this.combo.t > 0) {
    this.combo.t -= dt;
    if (this.combo.t <= 0) {
      this.combo.n = 0;
      this.combo.mult = 1;
    }
  }

  /* 玩家 */
  p.update(dt, this);

  /* 按住技能自动连发 */
  for (const s of SKILLS) {
    if (this.keys.has(s.keyCode)) {
      const cd = p.cds[s.id];
      if (cd <= 0 && p.mp >= s.mp) p.tryCast(s, this);
    }
  }

  if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

  /* 刷怪 */
  let aliveCount = 0;
  for (const m of this.monsters) if (!m.dead) aliveCount++;
  for (const sp of spawnerList) {
    if (sp.alive) continue;
    sp.timer -= dt;
    if (sp.timer <= 0 && aliveCount < 26 && Math.abs(sp.x - p.cx) < 1500) {
      const m = new Monster(sp.type, sp.x, sp.y, sp);
      sp.monster = m;
      sp.alive = true;
      this.monsters.push(m);
      this.burst(m.cx, m.cy, m.def.color, 8, 120, 0.5);
      aliveCount++;
    }
  }

  /* 怪物 */
  const list = this.monsters.slice();
  for (const m of list) {
    // 死亡中的怪物也要 update：否则 deadT 不前进，尸体永远留在原地（清理条件永远不会满足）
    m.update(dt, this);
    if (!m.dead && rectsOverlap(p, m)) {
      p.takeDamage(m.def.dmg, this);
    }
  }

  /* Boss */
  if (!this.bossActive && !this.boss && p.cx > WORLD.bossGateX + 120) {
    this.bossActive = true;
    this.boss = new Boss(WORLD.bossSpawnX, WORLD.groundY);
    this.shake(18);
    this.flashScreen(0.35, [200, 120, 255]);
    SFX.explode();
    UI.toast('暗影魔君 苏醒了……', 'warn');
  }
  if (this.boss) {
    this.boss.update(dt, this);
    if (!this.boss.dead && rectsOverlap(p, this.boss)) {
      p.takeDamage(this.boss.def.dmg * 0.8, this);
    }
  }

  /* 清理死亡怪物 */
  for (let i = this.monsters.length - 1; i >= 0; i--) {
    const m = this.monsters[i];
    if (m.dead && m.deadT > 1.1) this.monsters.splice(i, 1);
  }

  /* 弹道 */
  for (let i = this.projectiles.length - 1; i >= 0; i--) {
    const pr = this.projectiles[i];
    pr.update(dt, this);
    if (pr.dead) this.projectiles.splice(i, 1);
  }

  /* 拾取 */
  for (let i = this.pickups.length - 1; i >= 0; i--) {
    const pk = this.pickups[i];
    pk.update(dt, this);
    if (pk.dead) this.pickups.splice(i, 1);
  }

  /* 特效 */
  for (let i = this.effects.length - 1; i >= 0; i--) {
    const ef = this.effects[i];
    ef.update(dt, this);
    if (ef.dead) this.effects.splice(i, 1);
  }

  /* 粒子 */
  for (let i = this.particles.length - 1; i >= 0; i--) {
    const pt = this.particles[i];
    pt.life -= dt;
    if (pt.life <= 0) { this.particles.splice(i, 1); continue; }
    pt.vy += pt.gravity * dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.99;
  }

  /* 环境粒子 */
  this.spawnAmbient(dt);

  /* 相机 */
  const targetX = clamp(p.cx - CONFIG.W * 0.42 + p.facing * 46, 0, WORLD.width - CONFIG.W);
  this.camX += (targetX - this.camX) * Math.min(1, dt * 7.5);

  /* 区域检测 */
  const ri = regionIndexAt(p.cx);
  if (ri !== this.regionIndex) {
    this.regionIndex = ri;
    this.applyRegionTint(ri);
    UI.showRegion(REGIONS[ri].name);
    if (ri === 1) this.toast('洞窟深处传来低语……', 'warn');
    if (ri === 2) this.toast('星陨神殿 · 前方有强大气息', 'warn');
  }
};

GAME.applyRegionTint = function (ri) {
  const el = document.getElementById('tint');
  if (!el) return;
  el.style.backgroundColor = ri === 1 ? 'rgba(34,54,110,0.16)'
    : ri === 2 ? 'rgba(64,26,96,0.2)'
    : 'rgba(255,214,150,0.04)';
};

GAME.spawnAmbient = function (dt) {
  this.ambientT -= dt;
  if (this.ambientT > 0) return;
  this.ambientT = 0.055;

  const camX = this.camX;
  const ri = regionIndexAt(camX + CONFIG.W / 2);
  const x = camX + rand(-80, CONFIG.W + 80);
  const y = rand(-20, 420);

  if (ri === 0) {
    this.emit({
      x, y,
      vx: rand(-40, -10) - 20, vy: rand(6, 24),
      life: rand(4, 7), maxLife: 7,
      size: rand(1.6, 3.2),
      color: chance(0.5) ? [255, 210, 140] : [180, 230, 160],
      gravity: 4, glow: false, sway: rand(0.4, 1.2), phase: rand(0, TAU),
    });
  } else if (ri === 1) {
    this.emit({
      x, y: rand(300, 560),
      vx: rand(-10, 10), vy: rand(-26, -8),
      life: rand(3, 6), maxLife: 6,
      size: rand(1.4, 2.8),
      color: [120, 220, 255],
      gravity: -4, glow: true, sway: rand(0.3, 0.9), phase: rand(0, TAU),
    });
  } else {
    this.emit({
      x, y,
      vx: rand(-8, 8), vy: rand(-14, 10),
      life: rand(3, 7), maxLife: 7,
      size: rand(1.2, 3),
      color: chance(0.35) ? [255, 220, 160] : [190, 160, 255],
      gravity: 0, glow: true, sway: rand(0.2, 0.8), phase: rand(0, TAU),
    });
  }
};

/* ---------------------------------------------------------
   渲染
   --------------------------------------------------------- */
GAME.render = function () {
  const g = this;
  ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);

  if (!g.player) {
    ctx.fillStyle = '#07050d';
    ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
    return;
  }

  drawBackground(ctx, g.camX, g.time);

  const shakeX = (Math.random() - 0.5) * g.shakeAmt;
  const shakeY = (Math.random() - 0.5) * g.shakeAmt;

  ctx.save();
  ctx.translate(-g.camX + shakeX, shakeY);

  drawPlatforms(ctx, g.camX, g.time);

  // 拾取物
  for (const pk of g.pickups) pk.draw(ctx, g.time);

  // 怪物
  for (const m of g.monsters) m.draw(ctx, g.time);

  // Boss
  if (g.boss) g.boss.draw(ctx, g.time);

  // 玩家
  g.player.draw(ctx, g.time);

  // 弹道
  for (const pr of g.projectiles) pr.draw(ctx, g.time);

  // 特效
  for (const ef of g.effects) ef.draw(ctx, g.time);

  // 粒子（普通）
  for (const pt of g.particles) {
    if (pt.glow) continue;
    const a = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.globalAlpha = a * 0.75;
    ctx.fillStyle = rgba(pt.color, 1);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 粒子（发光）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const pt of g.particles) {
    if (!pt.glow) continue;
    const a = clamp(pt.life / pt.maxLife, 0, 1);
    ctx.fillStyle = rgba(pt.color, a * 0.85);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size * (0.4 + a * 0.6), 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();

  drawForeground(ctx, g.camX, g.time);

  // 受击闪屏
  if (g.flash > 0.001) {
    ctx.fillStyle = rgba(g.flashColor, g.flash * 0.5);
    ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
  }

  // 低血量脉冲
  const hpP = g.player.hp / g.player.maxHp;
  if (hpP < 0.3 && g.state === 'playing') {
    const pulse = 0.12 + 0.1 * Math.sin(g.time * 6);
    ctx.fillStyle = 'rgba(180,20,40,' + pulse * (1 - hpP / 0.3) + ')';
    ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
  }
};

/* ---------------------------------------------------------
   主循环
   --------------------------------------------------------- */
let lastT = 0;

function loop(ts) {
  requestAnimationFrame(loop);
  const now = ts / 1000;
  if (!lastT) lastT = now;
  let dt = now - lastT;
  lastT = now;
  if (dt > 0.1) dt = 0.1;

  GAME.time += dt;

  // 触摸控件只在真正能操作的时候出现（开始/暂停/死亡/通关界面都不该有）
  if (document.body.classList.contains('is-touch')) {
    document.body.classList.toggle('in-game', GAME.state === 'playing');
  }

  // 帧率自适应：持续偏低时降低渲染分辨率，保证操作手感
  if (!perfChecked && GAME.state === 'playing') {
    fpsSamples.push(dt);
    if (fpsSamples.length >= 90) {
      const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      perfChecked = true;
      if (avg > 1 / 42) {
        renderCap = 1.0;
        resizeStage();
      }
    }
  }

  // 衰减
  GAME.shakeAmt *= Math.pow(0.0025, dt);
  if (GAME.shakeAmt < 0.05) GAME.shakeAmt = 0;
  GAME.flash *= Math.pow(0.0008, dt);

  if (GAME.state === 'playing') {
    if (GAME.hitstop > 0) {
      GAME.hitstop -= dt;
    } else {
      GAME.acc += dt;
      let steps = 0;
      while (GAME.acc >= FIXED && steps < 5) {
        GAME.step(FIXED);
        GAME.acc -= FIXED;
        steps++;
      }
      if (GAME.acc > 0.25) GAME.acc = 0;
    }
    UI.update(GAME);
  }

  GAME.render();
}

/* ---------------------------------------------------------
   输入
   --------------------------------------------------------- */
const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];

window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.indexOf(e.code) >= 0) e.preventDefault();

  if (GAME.state === 'start') {
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
      SFX.init();
      SFX.resume();
      startGame();
    }
    return;
  }

  // 帮助面板
  const help = document.getElementById('helpScreen');
  if (!help.classList.contains('hidden')) {
    if (e.code === 'KeyH' || e.code === 'Escape' || e.code === 'Enter') {
      help.classList.add('hidden');
      GAME.state = GAME._helpFromPlaying ? 'playing' : GAME.state;
    }
    return;
  }

  if (e.code === 'Escape' || e.code === 'KeyP') {
    togglePause();
    return;
  }
  if (e.code === 'KeyH') {
    GAME._helpFromPlaying = GAME.state === 'playing';
    if (GAME._helpFromPlaying) GAME.state = 'paused';
    help.classList.remove('hidden');
    return;
  }

  if (GAME.state !== 'playing') return;

  if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') {
    GAME.jumpBuffer = 0.13;
  }

  GAME.keys.add(e.code);

  const skill = SKILLS.find((s) => s.keyCode === e.code ||
    (e.code.indexOf('Numpad') === 0 && s.keyCode === 'Digit' + e.code.slice(6)));
  if (skill && GAME.player && !e.repeat) {
    GAME.player.tryCast(skill, GAME);
  } else if (skill && GAME.player && e.repeat) {
    GAME.player.tryCast(skill, GAME);
  }
});

window.addEventListener('keyup', (e) => {
  GAME.keys.delete(e.code);
});

window.addEventListener('blur', () => {
  GAME.keys.clear();
});

function togglePause() {
  const el = document.getElementById('pauseScreen');
  if (GAME.state === 'playing') {
    GAME.state = 'paused';
    el.classList.remove('hidden');
  } else if (GAME.state === 'paused') {
    GAME.state = 'playing';
    el.classList.add('hidden');
    lastT = 0;
  }
  GAME.keys.clear();   // 暂停/继续都要清掉按压状态，否则松手事件丢了会一直移动
}

/* ---------------------------------------------------------
   触摸操作
   --------------------------------------------------------- */
function bindTouch() {
  if (!TOUCH) return;
  const $ = (id) => document.getElementById(id);

  // 按住类按钮：直接把 keyCode 塞进 GAME.keys，复用键盘那套输入逻辑
  const hold = (el, code) => {
    if (!el) return;
    const on = (e) => {
      e.preventDefault();
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } }
      el.classList.add('on');
      GAME.keys.add(code);
    };
    const off = () => {
      el.classList.remove('on');
      GAME.keys.delete(code);
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  hold($('tcLeft'), 'KeyA');
  hold($('tcRight'), 'KeyD');

  // 跳跃：走 jumpBuffer，和键盘的空格一致
  const jump = $('tcJump');
  if (jump) {
    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      jump.classList.add('on');
      if (GAME.state === 'playing') GAME.jumpBuffer = 0.13;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => {
      jump.addEventListener(t, () => jump.classList.remove('on'));
    });
    jump.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const menu = $('tcMenu');
  if (menu) {
    menu.addEventListener('click', (e) => {
      e.preventDefault();
      if (GAME.state === 'playing' || GAME.state === 'paused') togglePause();
    });
  }

  // 拦截双指缩放 / 下拉刷新 / iOS 手势缩放
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}

/* ---------------------------------------------------------
   绑定
   --------------------------------------------------------- */
function bindUI() {
  document.getElementById('startBtn').addEventListener('click', () => {
    SFX.init();
    SFX.resume();
    startGame();
  });

  document.getElementById('resumeBtn').addEventListener('click', () => {
    document.getElementById('pauseScreen').classList.add('hidden');
    if (GAME.state === 'paused') GAME.state = 'playing';
    lastT = 0;
    SFX.resume();
  });

  document.getElementById('pauseHelpBtn').addEventListener('click', () => {
    GAME._helpFromPlaying = false;
    document.getElementById('helpScreen').classList.remove('hidden');
  });

  document.getElementById('closeHelpBtn').addEventListener('click', () => {
    document.getElementById('helpScreen').classList.add('hidden');
  });

  document.getElementById('restartBtn').addEventListener('click', () => {
    document.getElementById('pauseScreen').classList.add('hidden');
    startGame();
  });

  document.getElementById('retryBtn').addEventListener('click', () => {
    startGame();
  });

  document.getElementById('againBtn').addEventListener('click', () => {
    startGame();
  });

  // 星星背景
  const sf = document.getElementById('starfield');
  if (sf) {
    let html = '';
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 100;
      const y = Math.random() * 100;
      const d = (Math.random() * 5 + 2).toFixed(2);
      const dl = (Math.random() * 5).toFixed(2);
      const s = (Math.random() * 1.6 + 0.6).toFixed(1);
      html += '<i style="left:' + x + '%;top:' + y + '%;width:' + s + 'px;height:' + s + 'px;animation-duration:' + d + 's;animation-delay:' + dl + 's"></i>';
    }
    sf.innerHTML = html;
  }
}

/* ---------------------------------------------------------
   启动
   --------------------------------------------------------- */
function boot() {
  applyDeviceClass();   // 必须早于 UI.init：技能槽要按设备建到不同容器
  resizeStage();
  UI.init();
  bindUI();
  bindTouch();
  generateWorld();
  requestAnimationFrame(loop);
}

boot();

// 暴露给调试
window.GAME = GAME;
