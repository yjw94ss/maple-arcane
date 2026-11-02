'use strict';

/* =========================================================
   世界生成 & 场景渲染
   ========================================================= */

let platforms = [];
let props = [];
let spawnerList = [];

/* 渐变条缓存：把大面积的渐变光栅化转成一次小尺寸渐变 + 位图拉伸 */
const _stripCache = {};
function gradientStrip(key, w, h, build) {
  const cache = _stripCache[key];
  const sig = build.sig;
  if (cache && cache.sig === sig) return cache.canvas;
  let cv = cache && cache.canvas;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
  }
  const o = cv.getContext('2d');
  o.clearRect(0, 0, w, h);
  build(o, w, h);
  _stripCache[key] = { canvas: cv, sig };
  return cv;
}

function smoothstep(x, a, b) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 三大区域混合权重 */
function regionWeights(x) {
  const blend = 380;
  const w0 = 1 - smoothstep(x, 2100 - blend / 2, 2100 + blend / 2);
  const w2 = smoothstep(x, 4200 - blend / 2, 4200 + blend / 2);
  return [w0, clamp(1 - w0 - w2, 0, 1), w2];
}

/** 当前位置的混合调色板 */
function paletteAt(x) {
  const w = regionWeights(x);
  const p = REGIONS[0].pal;
  const out = {};
  for (const k in p) {
    let c = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const src = REGIONS[i].pal[k];
      c[0] += src[0] * w[i];
      c[1] += src[1] * w[i];
      c[2] += src[2] * w[i];
    }
    out[k] = c;
  }
  out._w = w;
  return out;
}

function regionIndexAt(x) {
  if (x < 2100) return 0;
  if (x < 4200) return 1;
  return 2;
}

/* ---------------------------------------------------------
   生成
   --------------------------------------------------------- */
function generateWorld() {
  const rng = mulberry32(20261102);
  platforms = [];
  props = [];
  spawnerList = [];

  /* ---- 地面 ---- */
  let x = 0;
  while (x < WORLD.width) {
    let w = 440 + rng() * 380;
    if (x + w > WORLD.width) w = WORLD.width - x;
    platforms.push({ x, y: WORLD.groundY, w, h: 200, type: 'ground', seed: rng() * 999 });
    x += w;
    if (x >= WORLD.width) break;
    // 出生地与 boss 场地不挖坑
    const inSafe = x < 820 || x > 5440;
    const gap = inSafe ? 0 : 118 + rng() * 62;
    x += gap;
  }
  // boss 决战场：平整地面
  platforms.push({ x: 5440, y: WORLD.groundY, w: WORLD.width - 5440, h: 200, type: 'ground', seed: 7.7 });
  // 出生地
  platforms.push({ x: -200, y: WORLD.groundY, w: 520, h: 200, type: 'ground', seed: 3.3 });

  /* ---- 浮空平台 ---- */
  let px = 430;
  let prevY = 430;
  while (px < WORLD.width - 460) {
    if (px > 5400) { px += 320; continue; }
    const cands = WORLD.levels.filter((y) => Math.abs(y - prevY) <= 130);
    const py = cands.length ? cands[Math.floor(rng() * cands.length)] : prevY;
    const pw = 132 + rng() * 104;
    platforms.push({ x: px, y: py, w: pw, h: 20, type: 'plat', seed: rng() * 999 });
    prevY = py;
    px += pw + 96 + rng() * 78;
  }

  /* ---- 装饰物（等距铺设，避免堆叠） ---- */
  let px2 = 70;
  while (px2 < WORLD.width - 40) {
    const wx = px2;
    px2 += 62 + rng() * 96;
    if (wx > 5400) {
      if (rng() < 0.8) continue;
    }
    const kindRoll = rng();
    let kind;
    if (wx < 2100) kind = kindRoll < 0.45 ? 'tree' : kindRoll < 0.82 ? 'bush' : 'flower';
    else if (wx < 4200) kind = kindRoll < 0.42 ? 'crystal' : kindRoll < 0.74 ? 'rock' : kindRoll < 0.9 ? 'mushroomcap' : 'bush';
    else kind = kindRoll < 0.48 ? 'pillar' : kindRoll < 0.78 ? 'crystal' : 'rune';
    const sc = kind === 'crystal' ? 0.5 + rng() * 0.45 : kind === 'tree' ? 0.95 + rng() * 0.8 : 0.75 + rng() * 0.6;
    props.push({ x: wx, y: WORLD.groundY, kind, s: sc, seed: rng() * 100 });
  }

  /* ---- 刷怪点 ---- */
  const zones = [
    { from: 520, to: 2000, types: ['slime', 'mush'], n: 9 },
    { from: 2200, to: 4100, types: ['bat', 'wisp', 'mush'], n: 10 },
    { from: 4300, to: 5350, types: ['golem', 'bat', 'wisp'], n: 7 },
  ];
  for (const z of zones) {
    let tries = 0;
    let placed = 0;
    while (placed < z.n && tries < 300) {
      tries++;
      const sx = z.from + rng() * (z.to - z.from);
      const g = findGroundAt(sx);
      if (!g) continue;
      // 避免刷怪点过近
      let tooClose = false;
      for (const s of spawnerList) {
        if (Math.abs(s.x - sx) < 110) { tooClose = true; break; }
      }
      if (tooClose) continue;
      spawnerList.push({
        x: sx, y: g.y, type: z.types[Math.floor(rng() * z.types.length)],
        timer: 0, alive: false, monster: null,
      });
      placed++;
    }
  }
}

/** 找到覆盖某 x 的地面 */
function findGroundAt(x) {
  let best = null;
  for (const p of platforms) {
    if (p.type !== 'ground') continue;
    if (x >= p.x + 22 && x <= p.x + p.w - 22) {
      if (!best || p.y < best.y) best = p;
    }
  }
  return best;
}

/** 安全落点：找最近的有地面处 */
function nearestSafeX(x) {
  if (findGroundAt(x)) return x;
  for (let d = 20; d < 900; d += 20) {
    if (findGroundAt(x - d)) return x - d;
    if (findGroundAt(x + d)) return x + d;
  }
  return 300;
}

/* ---------------------------------------------------------
   背景绘制
   --------------------------------------------------------- */
const CLOUDS = (() => {
  const rng = mulberry32(99);
  const arr = [];
  for (let i = 0; i < 11; i++) {
    arr.push({
      x: rng() * 2100,
      y: 40 + rng() * 210,
      s: 0.6 + rng() * 1.5,
      a: 0.12 + rng() * 0.22,
      sp: 4 + rng() * 10,
    });
  }
  return arr;
})();

const STARS = (() => {
  const rng = mulberry32(4242);
  const arr = [];
  for (let i = 0; i < 150; i++) {
    arr.push({
      x: rng() * 1600,
      y: rng() * 430,
      r: 0.5 + rng() * 1.4,
      p: rng() * TAU,
      sp: 0.6 + rng() * 2,
    });
  }
  return arr;
})();

/**
 * 软边椭圆光斑：径向渐变会跟着 transform 一起被拉成椭圆，
 * 所以渐变在椭圆边界处正好衰减到 0，不会出现被路径切出来的硬边。
 */
function softBlob(ctx, px, py, rx, ry, color, a) {
  if (a <= 0.004) return;
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(rx / ry, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.45, rgba(color, a * 0.8));
  g.addColorStop(0.75, rgba(color, a * 0.32));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, ry, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBackground(ctx, camX, time) {
  const pal = paletteAt(camX + CONFIG.W / 2);
  const w = pal._w;

  /* 天空 */
  const sky = ctx.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, rgba(pal.skyTop));
  sky.addColorStop(0.62, rgba(lerpColor(pal.skyTop, pal.skyBot, 0.72)));
  sky.addColorStop(1, rgba(pal.skyBot));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);

  /* 星海（神殿） */
  if (w[2] > 0.02) {
    ctx.save();
    ctx.globalAlpha = w[2] * 0.9;
    for (const s of STARS) {
      const sx = ((s.x - camX * 0.06) % 1600 + 1600) % 1600;
      if (sx > CONFIG.W) continue;
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(time * s.sp + s.p));
      ctx.fillStyle = 'rgba(255,255,255,' + (tw * 0.85) + ')';
      ctx.beginPath();
      ctx.arc(sx, s.y, s.r * (0.8 + tw * 0.4), 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // 巨大月亮
    const mx = 980 - camX * 0.03;
    ctx.save();
    ctx.globalAlpha = w[2];
    glow(ctx, mx, 150, 210, [180, 150, 255], 0.18);
    ctx.fillStyle = 'rgba(236,228,255,0.92)';
    ctx.beginPath();
    ctx.arc(mx, 150, 58, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(190,170,240,0.30)';
    // 注意：连续 arc() 之间 canvas 会自动连一条直线，必须每个环形山单独成路径
    const craters = [[-16, -12, 12], [20, 18, 8], [6, -28, 6], [-24, 22, 5]];
    for (const [dx, dy, r] of craters) {
      ctx.beginPath();
      ctx.arc(mx + dx, 150 + dy, r, 0, TAU);
      ctx.fill();
    }
    // 月面边缘的暗部，让球体有体积感
    const mg2 = ctx.createRadialGradient(mx - 20, 130, 6, mx, 150, 60);
    mg2.addColorStop(0, 'rgba(255,255,255,0.10)');
    mg2.addColorStop(0.62, 'rgba(150,130,210,0)');
    mg2.addColorStop(1, 'rgba(120,100,185,0.34)');
    ctx.fillStyle = mg2;
    ctx.beginPath();
    ctx.arc(mx, 150, 58, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* 太阳（草原） */
  if (w[0] > 0.02) {
    const sx = 250 - camX * 0.02;
    ctx.save();
    ctx.globalAlpha = w[0];
    glow(ctx, sx, 130, 260, [255, 236, 180], 0.22);
    const g = ctx.createRadialGradient(sx, 130, 0, sx, 130, 70);
    g.addColorStop(0, 'rgba(255,255,244,0.95)');
    g.addColorStop(0.5, 'rgba(255,242,196,0.55)');
    g.addColorStop(1, 'rgba(255,236,175,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, 130, 70, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* 云 */
  ctx.save();
  const cloudAlpha = 0.55 + w[0] * 0.45;
  for (const c of CLOUDS) {
    const cx = ((c.x - camX * 0.16 - time * c.sp) % 2100 + 2100) % 2100 - 300;
    if (cx < -360 || cx > CONFIG.W + 200) continue;
    const cy = c.y + Math.sin(time * 0.4 + c.x) * 5;
    const s = c.s;
    // 两个云团用随椭圆一起拉伸的径向渐变，边缘才会真正淡到透明（否则椭圆边界会切出一条硬边）
    const ca = Math.min(0.46, c.a * cloudAlpha * 1.5);
    softBlob(ctx, cx, cy, 150 * s, 52 * s, pal.fog, ca);
    softBlob(ctx, cx + 60 * s, cy - 16 * s, 92 * s, 40 * s, pal.fog, ca);
  }
  ctx.restore();

  /* 远山 3 层 */
  drawMountainLayer(ctx, camX, 0.09, shade(pal.far, 1.02), 500, 200, 1.3, 0.45, 380);
  drawMountainLayer(ctx, camX, 0.18, shade(pal.far, 0.72), 528, 160, 4.1, 0.66, 340);
  drawMountainLayer(ctx, camX, 0.30, shade(pal.mid, 0.97), 550, 118, 8.7, 0.92, 300);

  /* 地平线雾霾：柔化山体与地面之间的硬切 */
  ctx.save();
  const haze = ctx.createLinearGradient(0, 400, 0, 580);
  haze.addColorStop(0, rgba(pal.fog, 0));
  haze.addColorStop(0.55, rgba(pal.fog, 0.22));
  haze.addColorStop(0.82, rgba(pal.fog, 0.3));
  haze.addColorStop(1, rgba(pal.fog, 0.1));
  ctx.fillStyle = haze;
  ctx.fillRect(0, 400, CONFIG.W, 180);
  ctx.restore();

  /* 远景树线 ×2 */
  drawTreeLine(ctx, camX, 0.46, shade(pal.mid, 0.86), 566, 0.55, 2.7);
  drawTreeLine(ctx, camX, 0.62, shade(pal.mid, 0.68), 578, 0.75, 6.1);

  /* 洞窟顶部的垂石 */
  if (w[1] > 0.02) {
    ctx.save();
    ctx.globalAlpha = w[1];
    ctx.fillStyle = rgba(shade(pal.mid, 0.72));
    const off = camX * 0.3;
    const step = 130;
    const start = Math.floor(off / step) - 1;
    for (let i = start; i < start + 14; i++) {
      const sx = i * step - off;
      const h = 50 + hash1(i * 3.1) * 130;
      const wd = 26 + hash1(i * 7.7) * 30;
      ctx.beginPath();
      ctx.moveTo(sx, -10);
      ctx.lineTo(sx + wd, -10);
      ctx.lineTo(sx + wd * 0.5, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

}

function drawMountainLayer(ctx, camX, parallax, color, baseY, height, seed, alpha, stepW) {
  const off = camX * parallax;
  const step = stepW || 250;
  const start = Math.floor(off / step) - 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  const mg = ctx.createLinearGradient(0, baseY - height * 1.2, 0, baseY + 40);
  mg.addColorStop(0, rgba(shade(color, 1.08)));
  mg.addColorStop(0.55, rgba(color));
  mg.addColorStop(1, rgba(shade(color, 0.82)));
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.moveTo(-200, baseY + 200);
  for (let i = start; i < start + 8; i++) {
    const x0 = i * step - off;
    const h = height * (0.5 + hash1(i * seed) * 0.7);
    const tilt = (hash1(i * seed + 7.7) - 0.5) * step * 0.28;
    ctx.lineTo(x0, baseY);
    // 圆润的山脊，避免生硬的三角剪影
    ctx.quadraticCurveTo(x0 + step * 0.26, baseY - h * 0.82, x0 + step * 0.5 + tilt, baseY - h);
    ctx.quadraticCurveTo(x0 + step * 0.74, baseY - h * 0.78, x0 + step, baseY);
  }
  ctx.lineTo(CONFIG.W + 200, baseY + 200);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 远景树线：一排起伏的树冠剪影，用于增强纵深 */
function drawTreeLine(ctx, camX, parallax, color, baseY, alpha, seed) {
  const off = camX * parallax;
  const step = 40;
  const start = Math.floor(off / step) - 2;
  const count = Math.ceil(CONFIG.W / step) + 5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(color);
  ctx.beginPath();
  ctx.moveTo(-100, baseY + 200);
  ctx.lineTo(-100, baseY);
  for (let i = start; i < start + count; i++) {
    const x = i * step - off;
    const h = 22 + hash1(i * seed) * 44;
    ctx.quadraticCurveTo(x + step * 0.5, baseY - h, x + step, baseY);
  }
  ctx.lineTo(CONFIG.W + 200, baseY + 200);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ---------------------------------------------------------
   平台 / 地面
   --------------------------------------------------------- */
function drawPlatforms(ctx, camX, time) {
  const pal = paletteAt(camX + CONFIG.W / 2);
  const left = camX - 200;
  const right = camX + CONFIG.W + 200;

  // 先画装饰物（在平台之后面）
  drawProps(ctx, camX, time, pal);

  for (const p of platforms) {
    if (p.x > right || p.x + p.w < left) continue;

    if (p.type === 'ground') {
      drawGroundSegment(ctx, p, pal, time);
    } else {
      drawFloatPlatform(ctx, p, pal, time);
    }
  }
}

function drawGroundSegment(ctx, p, pal, time) {
  const topY = p.y;
  const bottomY = CONFIG.H + 40;
  const adjL = groundContinues(p.x - 2, p.y);
  const adjR = groundContinues(p.x + p.w + 2, p.y);
  const gx0 = p.x - (adjL ? 3 : 0);
  const gx1 = p.x + p.w + (adjR ? 3 : 0);

  // 泥土主体
  const g = ctx.createLinearGradient(0, topY, 0, topY + 190);
  g.addColorStop(0, rgba(shade(pal.dirt, 1.05)));
  g.addColorStop(0.4, rgba(pal.dirt));
  g.addColorStop(1, rgba(pal.dirtDeep, 0.95));
  ctx.fillStyle = g;
  ctx.fillRect(gx0, topY + 8, gx1 - gx0, bottomY - topY);

  // 草皮（与相邻地块无缝衔接）
  const rl = adjL ? 0 : 9;
  const rt = adjR ? 0 : 9;
  const gg = ctx.createLinearGradient(0, topY - 4, 0, topY + 20);
  gg.addColorStop(0, rgba(shade(pal.grass, 1.16)));
  gg.addColorStop(0.55, rgba(pal.grass));
  gg.addColorStop(1, rgba(pal.grassDark));
  ctx.fillStyle = gg;
  ctx.beginPath();
  ctx.moveTo(gx0, topY + 22);
  ctx.lineTo(gx0, topY - 4 + rl);
  ctx.quadraticCurveTo(gx0, topY - 4, gx0 + rl, topY - 4);
  ctx.lineTo(gx1 - rt, topY - 4);
  ctx.quadraticCurveTo(gx1, topY - 4, gx1, topY - 4 + rt);
  ctx.lineTo(gx1, topY + 22);
  ctx.closePath();
  ctx.fill();

  // 草皮高光
  ctx.fillStyle = rgba(shade(pal.grass, 1.34), 0.5);
  rr(ctx, p.x + 4, topY - 3, p.w - 8, 5, 3);
  ctx.fill();

  // 草叶
  const n = Math.floor(p.w / 46);
  for (let i = 0; i < n; i++) {
    const hx = p.x + 18 + (i * (p.w - 36)) / Math.max(1, n);
    const hh = 8 + hash1(p.seed + i * 2.7) * 14;
    const sway = Math.sin(time * 1.6 + hx * 0.02) * 3;
    ctx.strokeStyle = rgba(shade(pal.grass, 1.1 + hash1(i + p.seed) * 0.3), 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx, topY - 1);
    ctx.quadraticCurveTo(hx + sway * 0.5, topY - hh * 0.6, hx + sway, topY - hh);
    ctx.stroke();
  }

  // 泥土颗粒
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let i = 0; i < Math.ceil(n * 0.6); i++) {
    const dx = p.x + hash1(p.seed + i * 11.3) * p.w;
    const dy = topY + 42 + hash1(p.seed + i * 5.9) * 130;
    const r = 1.5 + hash1(i * 1.7) * 3.5;
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, TAU);
    ctx.fill();
  }

  // 边缘暗角（仅在没有相邻地面的断口处绘制，避免出现接缝）
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  if (!groundContinues(p.x - 1, p.y)) ctx.fillRect(p.x, topY + 8, 4, 160);
  if (!groundContinues(p.x + p.w + 1, p.y)) ctx.fillRect(p.x + p.w - 4, topY + 8, 4, 160);
}

function groundContinues(x, y) {
  for (const p of platforms) {
    if (p.type !== 'ground') continue;
    if (Math.abs(p.y - y) > 2) continue;
    if (x >= p.x && x <= p.x + p.w) return true;
  }
  return false;
}

function drawFloatPlatform(ctx, p, pal, time) {
  // 底部阴影
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  rr(ctx, p.x + 4, p.y + 8, p.w - 8, 22, 10);
  ctx.fill();

  const g = ctx.createLinearGradient(0, p.y, 0, p.y + 30);
  g.addColorStop(0, rgba(shade(pal.dirt, 1.12)));
  g.addColorStop(1, rgba(pal.dirtDeep));
  ctx.fillStyle = g;
  rr(ctx, p.x, p.y, p.w, 26, 11);
  ctx.fill();

  const gg = ctx.createLinearGradient(0, p.y - 3, 0, p.y + 12);
  gg.addColorStop(0, rgba(shade(pal.grass, 1.2)));
  gg.addColorStop(1, rgba(pal.grassDark));
  ctx.fillStyle = gg;
  rr(ctx, p.x, p.y - 3, p.w, 14, 7);
  ctx.fill();

  ctx.fillStyle = rgba(shade(pal.grass, 1.35), 0.5);
  rr(ctx, p.x + 5, p.y - 2, p.w - 10, 4, 2);
  ctx.fill();

  // 垂下的藤蔓
  const vineCount = Math.floor(p.w / 60);
  for (let i = 0; i < vineCount; i++) {
    const vx = p.x + 22 + i * 58;
    const len = 20 + hash1(p.seed + i * 3.3) * 40;
    const sway = Math.sin(time * 1.3 + vx * 0.03) * 5;
    ctx.strokeStyle = rgba(shade(pal.grassDark, 0.85), 0.75);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vx, p.y + 20);
    ctx.quadraticCurveTo(vx + sway * 0.4, p.y + 20 + len * 0.6, vx + sway, p.y + 20 + len);
    ctx.stroke();
    ctx.fillStyle = rgba(shade(pal.grass, 0.9), 0.8);
    ctx.beginPath();
    ctx.ellipse(vx + sway, p.y + 22 + len, 4, 6, 0.4, 0, TAU);
    ctx.fill();
  }
}

/* ---------------------------------------------------------
   装饰物
   --------------------------------------------------------- */
function drawProps(ctx, camX, time, pal) {
  const left = camX - 260;
  const right = camX + CONFIG.W + 260;
  for (const pr of props) {
    if (pr.x < left || pr.x > right) continue;
    const w = regionWeights(pr.x);
    const s = pr.s;
    ctx.save();
    ctx.translate(pr.x, pr.y);

    if (pr.kind === 'tree') {
      const sway = Math.sin(time * 0.9 + pr.seed) * 1.6;
      ctx.globalAlpha = 0.92;
      // 树干
      ctx.fillStyle = rgba(lerpColor([86, 60, 44], [52, 40, 52], w[1]));
      ctx.beginPath();
      ctx.moveTo(-6 * s, 2);
      ctx.lineTo(-3 * s + sway, -70 * s);
      ctx.lineTo(3 * s + sway, -70 * s);
      ctx.lineTo(6 * s, 2);
      ctx.closePath();
      ctx.fill();
      // 树冠三层
      const c1 = lerpColor(lerpColor([70, 148, 100], [40, 108, 132], w[1]), [96, 62, 148], w[2]);
      for (let i = 0; i < 3; i++) {
        const rr2 = (44 - i * 9) * s;
        const cy = -78 * s - i * 26 * s;
        ctx.fillStyle = rgba(shade(c1, 1 - i * 0.08));
        ctx.beginPath();
        ctx.ellipse(sway * (1 + i * 0.4), cy, rr2, rr2 * 0.72, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = rgba(shade(c1, 1.3), 0.35);
      ctx.beginPath();
      ctx.ellipse(sway - 12 * s, -104 * s, 18 * s, 12 * s, -0.3, 0, TAU);
      ctx.fill();
    } else if (pr.kind === 'bush') {
      const c = lerpColor([86, 168, 96], [40, 116, 128], w[1]);
      ctx.fillStyle = rgba(c);
      ctx.beginPath();
      ctx.ellipse(0, -8 * s, 26 * s, 16 * s, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(shade(c, 1.25), 0.5);
      ctx.beginPath();
      ctx.ellipse(-6 * s, -14 * s, 12 * s, 7 * s, 0, 0, TAU);
      ctx.fill();
    } else if (pr.kind === 'flower') {
      const cols = [[255, 226, 130], [255, 168, 200], [200, 190, 255]];
      const c = cols[Math.floor(hash1(pr.seed) * 3) % 3];
      for (let i = 0; i < 3; i++) {
        const fx = (i - 1) * 12 * s;
        const fy = -12 * s - hash1(pr.seed + i) * 8;
        ctx.strokeStyle = 'rgba(90,150,90,0.8)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(fx, 0);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        ctx.fillStyle = rgba(c, 0.9);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(a) * 3, fy + Math.sin(a) * 3, 2.2 * s, 0, TAU);
          ctx.fill();
        }
      }
    } else if (pr.kind === 'crystal') {
      const hue = w[2] > 0.5 ? [196, 158, 255] : [110, 226, 255];
      const pulse = 0.6 + 0.4 * Math.sin(time * 2 + pr.seed);
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 0, -26 * s, 44 * s, hue, 0.18 * pulse);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(hue, 0.85);
      ctx.beginPath();
      ctx.moveTo(0, -48 * s);
      ctx.lineTo(10 * s, -18 * s);
      ctx.lineTo(3 * s, 2);
      ctx.lineTo(-8 * s, -3 * s);
      ctx.lineTo(-10 * s, -22 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba([255, 255, 255], 0.32);
      ctx.beginPath();
      ctx.moveTo(0, -48 * s);
      ctx.lineTo(3 * s, -18 * s);
      ctx.lineTo(-8 * s, -3 * s);
      ctx.closePath();
      ctx.fill();
    } else if (pr.kind === 'rock') {
      ctx.fillStyle = rgba(lerpColor([104, 100, 118], [64, 56, 92], w[1]));
      ctx.beginPath();
      ctx.moveTo(-20 * s, 0);
      ctx.lineTo(-14 * s, -18 * s);
      ctx.lineTo(2 * s, -26 * s);
      ctx.lineTo(18 * s, -12 * s);
      ctx.lineTo(20 * s, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(-14 * s, -18 * s);
      ctx.lineTo(2 * s, -26 * s);
      ctx.lineTo(4 * s, -16 * s);
      ctx.closePath();
      ctx.fill();
    } else if (pr.kind === 'mushroomcap') {
      const pulse = 0.7 + 0.3 * Math.sin(time * 1.8 + pr.seed);
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, 0, -16 * s, 44 * s, [140, 240, 255], 0.16 * pulse);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(180,236,255,0.28)';
      ctx.beginPath();
      ctx.ellipse(0, -16 * s, 18 * s, 12 * s, 0, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(150,220,255,0.7)';
      ctx.fillRect(-3 * s, -16 * s, 6 * s, 16 * s);
    } else if (pr.kind === 'pillar') {
      const h = 110 * s;
      const g = ctx.createLinearGradient(-18, 0, 18, 0);
      g.addColorStop(0, 'rgba(46,34,66,0.95)');
      g.addColorStop(0.45, 'rgba(96,74,130,0.95)');
      g.addColorStop(1, 'rgba(38,28,56,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(-16 * s, -h, 32 * s, h);
      // 柱头
      ctx.fillStyle = 'rgba(120,96,160,0.95)';
      ctx.fillRect(-22 * s, -h - 12 * s, 44 * s, 14 * s);
      ctx.fillRect(-20 * s, -6, 40 * s, 8);
      // 发光刻纹
      const pulse = 0.5 + 0.5 * Math.sin(time * 1.6 + pr.seed * 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(190,150,255,' + (0.35 + pulse * 0.4) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -h + 16);
      ctx.lineTo(0, -h * 0.35);
      ctx.stroke();
      glow(ctx, 0, -h * 0.6, 46 * s, [190, 150, 255], 0.14 * pulse);
      ctx.globalCompositeOperation = 'source-over';
    } else if (pr.kind === 'rune') {
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + pr.seed);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(200,160,255,' + (0.2 + pulse * 0.35) + ')';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0, -60 - Math.sin(time + pr.seed) * 6, 22 * s, 8 * s, 0, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -60 - Math.sin(time + pr.seed) * 6, 6 * s, 0, TAU);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();
  }
}

/* ---------------------------------------------------------
   前景（画在角色之上）
   --------------------------------------------------------- */
function drawForeground(ctx, camX, time) {
  const pal = paletteAt(camX + CONFIG.W / 2);
  const w = pal._w;
  ctx.save();
  ctx.globalAlpha = 0.5;
  // 底部草丛剪影
  const off = camX * 1.15;
  ctx.fillStyle = rgba(shade(pal.grassDark, 0.5), 0.75);
  const step = 90;
  const start = Math.floor(off / step) - 1;
  for (let i = start; i < start + 18; i++) {
    const bx = i * step - off;
    const hh = 22 + hash1(i * 5.3) * 34;
    const sway = Math.sin(time * 1.1 + i) * 4;
    ctx.beginPath();
    ctx.moveTo(bx, CONFIG.H);
    ctx.quadraticCurveTo(bx + 18 + sway, CONFIG.H - hh * 0.7, bx + 34 + sway, CONFIG.H - hh);
    ctx.lineTo(bx + 46, CONFIG.H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
