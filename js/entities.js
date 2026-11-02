'use strict';

/* =========================================================
   实体：玩家 / 怪物 / Boss / 弹道 / 拾取物 / 特效
   ========================================================= */

const CAST_DUR = 0.32;

function approach(cur, target, maxDelta) {
  if (cur < target) return Math.min(cur + maxDelta, target);
  if (cur > target) return Math.max(cur - maxDelta, target);
  return target;
}

/* ---------------------------------------------------------
   通用物理
   --------------------------------------------------------- */
function applyPhysics(e, dt) {
  // 水平
  e.x += e.vx * dt;
  for (const p of platforms) {
    if (p.type !== 'ground') continue;
    if (rectsOverlap(e, p)) {
      if (e.vx > 0) e.x = p.x - e.w;
      else if (e.vx < 0) e.x = p.x + p.w;
      e.vx = 0;
    }
  }

  // 垂直
  const prevBottom = e.y + e.h;
  e.vy = Math.min(e.vy + CONFIG.gravity * dt, CONFIG.maxFall);
  e.y += e.vy * dt;
  e.onGround = false;

  for (const p of platforms) {
    if (!rectsOverlap(e, p)) continue;
    if (e.vy >= 0 && prevBottom <= p.y + 8) {
      e.y = p.y - e.h;
      e.vy = 0;
      e.onGround = true;
      e.groundPlat = p;
    } else if (e.vy < 0 && p.type === 'ground') {
      e.y = p.y + p.h;
      e.vy = 0;
    }
  }
}

/* =========================================================
   玩家
   ========================================================= */
class Player {
  constructor(x, groundY) {
    this.w = 26;
    this.h = 58;
    this.x = x;
    this.y = groundY - this.h;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.onGround = true;
    this.groundPlat = null;
    this.coyote = 0;

    this.level = 1;
    this.exp = 0;
    this.expNext = expNeeded(1);
    this.maxHp = 240;
    this.hp = 240;
    this.maxMp = 180;
    this.mp = 180;
    this.magic = 32;

    this.buffs = { guard: 0, meditate: 0 };
    this.cds = {};
    for (const s of SKILLS) this.cds[s.id] = 0;

    this.animT = 0;
    this.walkPhase = 0;
    this.castT = 0;
    this.castSkill = null;
    this.invuln = 0;
    this.hurtT = 0;
    this.blinkT = 0;
    this.tpFlash = 0;
    this.safeX = x;
    this.safeTimer = 0;
    this.totalDamage = 0;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  magicPower(power) {
    const med = this.buffs.meditate > 0 ? 1.45 : 1;
    return power * (10 + this.magic * 1.7) * med;
  }

  update(dt, g) {
    this.animT += dt;
    this.blinkT += dt;

    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.tpFlash > 0) this.tpFlash -= dt;
    if (this.castT > 0) this.castT -= dt;

    for (const k in this.cds) {
      if (this.cds[k] > 0) this.cds[k] = Math.max(0, this.cds[k] - dt);
    }
    if (this.buffs.guard > 0) this.buffs.guard -= dt;
    if (this.buffs.meditate > 0) this.buffs.meditate -= dt;

    // 输入
    let input = 0;
    if (g.keys.has('KeyA') || g.keys.has('ArrowLeft')) input -= 1;
    if (g.keys.has('KeyD') || g.keys.has('ArrowRight')) input += 1;

    const frozen = this.hurtT > 0.16;
    const targetVx = frozen ? this.vx * 0.6 : input * CONFIG.moveSpeed;
    const accel = (this.onGround ? CONFIG.accel : CONFIG.airAccel) * dt;
    this.vx = approach(this.vx, targetVx, accel);
    if (input !== 0 && !frozen) this.facing = input;

    // 跳跃（含土狼时间）
    if (this.onGround) this.coyote = 0.09;
    else this.coyote = Math.max(0, this.coyote - dt);
    if (g.jumpBuffer > 0) {
      if (this.coyote > 0) {
        this.vy = CONFIG.jumpV;
        this.coyote = 0;
        this.onGround = false;
        g.jumpBuffer = 0;
        SFX.jump();
        g.burst(this.cx, this.y + this.h, [180, 200, 255], 6, 90);
      }
    }

    const wasGround = this.onGround;
    const fallSpeed = this.vy;
    applyPhysics(this, dt);

    if (!wasGround && this.onGround && fallSpeed > 420) {
      for (let i = 0; i < 7; i++) {
        g.emit({
          x: this.cx + rand(-12, 12), y: this.y + this.h - 2,
          vx: rand(-90, 90), vy: rand(-70, -10),
          life: rand(0.28, 0.5), maxLife: 0.5,
          size: rand(1.6, 3.4), color: [235, 230, 215], gravity: 260, glow: false,
        });
      }
    }

    if (this.onGround) {
      this.walkPhase += Math.abs(this.vx) * dt * 0.075;
      // 记录最近的安全落点（立即记录，避免频繁跳跃时记录长期滞后）
      this.safeX = this.cx;
    }

    // 回复
    const regenMp = (2.2 + this.maxMp * 0.028) * dt;
    this.mp = Math.min(this.maxMp, this.mp + regenMp);
    if (this.hurtT <= 0) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.006 * dt);
    }

    // 掉出地图：回到最近的安全点并回退一点，避免立刻再次坠落
    if (this.y > CONFIG.H + 120) {
      this.x = clamp(this.safeX - this.w / 2 - this.facing * 46, 10, WORLD.width - this.w - 10);
      this.y = WORLD.groundY - this.h - 80;
      this.vy = 0;
      this.vx = 0;
      this.takeDamage(18, g, true);
      this.invuln = Math.max(this.invuln, 1.0);
      g.shake(14);
      g.flashScreen(0.2, [255, 90, 110]);
    }
  }

  tryCast(skill, g) {
    if (this.cds[skill.id] > 0) return false;
    if (this.mp < skill.mp) {
      if (!g._lowMpToast || g.time - g._lowMpToast > 1.2) {
        g._lowMpToast = g.time;
        UI.toast('法力不足', 'warn');
      }
      return false;
    }
    this.mp -= skill.mp;
    this.cds[skill.id] = skill.cd;
    this.castT = CAST_DUR;
    this.castSkill = skill;
    const fn = SKILL_EXEC[skill.id];
    if (fn) fn(this, g, skill);
    return true;
  }

  takeDamage(amount, g, ignoreInvuln) {
    if (this.hp <= 0) return;
    if (!ignoreInvuln && this.invuln > 0) return;

    let dmg = amount;
    if (this.buffs.guard > 0 && this.mp > 0) {
      const absorbed = dmg * 0.6;
      const useMp = Math.min(this.mp, absorbed * 1.15);
      this.mp -= useMp;
      dmg -= useMp / 1.15;
      g.burst(this.cx, this.cy, [140, 210, 255], 10, 160);
    }
    dmg = Math.max(1, dmg);
    this.hp -= dmg;
    this.invuln = CONFIG.invulnTime;
    this.hurtT = 0.34;
    this.totalDamage += dmg;

    if (!ignoreInvuln) {
      this.vx = -this.facing * 190;
      this.vy = -240;
    }
    g.shake(11);
    g.flashScreen(0.35, [255, 60, 80]);
    g.haptic(35);   // 受伤：最有存在感的一次震动
    g.addDamageText(this.cx, this.y + 6, Math.round(dmg), 'player-hurt', false);
    SFX.hurt();

    if (this.hp <= 0) {
      this.hp = 0;
      g.onPlayerDeath();
    }
  }

  gainExp(v, g) {
    this.exp += v;
    let leveled = false;
    while (this.exp >= this.expNext) {
      this.exp -= this.expNext;
      this.level++;
      this.expNext = expNeeded(this.level);
      this.maxHp += 26;
      this.maxMp += 22;
      this.magic += 7;
      this.hp = this.maxHp;
      this.mp = this.maxMp;
      leveled = true;
    }
    if (leveled) g.onLevelUp();
  }

  /* -------------------- 绘制 -------------------- */
  draw(ctx, time) {
    const cx = this.x + this.w / 2;
    const feetY = this.y + this.h;
    const t = this.animT;
    const moving = Math.abs(this.vx) > 14 && this.onGround;

    // 影子（投射到脚下地面）
    const gp = findGroundAt(cx);
    const shadowY = gp && gp.y > feetY - 4 ? gp.y + 3 : feetY + 3;
    const airH = Math.max(0, shadowY - feetY - 3);
    ctx.save();
    ctx.globalAlpha = 0.28 * clamp(1 - airH / 220, 0.18, 1);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, shadowY, 20 * clamp(1 - airH / 420, 0.55, 1), 6 * clamp(1 - airH / 420, 0.55, 1), 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 受击闪烁
    if (this.invuln > 0 && Math.floor(time * 22) % 2 === 0) ctx.globalAlpha = 0.5;

    // 增益光晕
    if (this.buffs.meditate > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const p = 0.5 + 0.5 * Math.sin(time * 4);
      glow(ctx, cx, this.cy - 6, 54, [190, 140, 255], 0.13 * p);
      ctx.restore();
    }
    if (this.buffs.guard > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(140,210,255,' + (0.28 + 0.18 * Math.sin(time * 3)) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, this.cy - 4, 30, 38, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, feetY);
    ctx.scale(this.facing, 1);

    const walk = this.walkPhase;
    const bob = this.onGround ? Math.sin(t * 3.2) * 1.4 : 0;
    ctx.translate(0, bob);

    const castP = this.castT > 0 ? 1 - this.castT / CAST_DUR : 0;
    const castK = Math.sin(castP * Math.PI);

    // ---- 披风 ----
    const flap = Math.sin(t * 4.6) * 3 + (this.onGround ? 0 : 6);
    const capeG = ctx.createLinearGradient(-20, -40, 0, 0);
    capeG.addColorStop(0, '#553293');
    capeG.addColorStop(1, '#241345');
    ctx.fillStyle = capeG;
    ctx.beginPath();
    ctx.moveTo(-5, -36);
    ctx.quadraticCurveTo(-24 - flap, -26, -22 - flap * 0.6, -2 + flap * 0.3);
    ctx.quadraticCurveTo(-12, -8, -3, -6);
    ctx.closePath();
    ctx.fill();

    // ---- 腿 ----
    const swing = moving ? Math.sin(walk) * 5 : 0;
    ctx.fillStyle = '#2a1a44';
    rr(ctx, -9 + swing * 0.6, -14, 9, 13, 4);
    ctx.fill();
    rr(ctx, 1 - swing * 0.6, -14, 9, 13, 4);
    ctx.fill();
    ctx.fillStyle = '#43305f';
    rr(ctx, -9 + swing * 0.6, -14, 9, 4, 2);
    ctx.fill();
    rr(ctx, 1 - swing * 0.6, -14, 9, 4, 2);
    ctx.fill();

    // ---- 法袍 ----
    const robeG = ctx.createLinearGradient(0, -40, 0, -2);
    robeG.addColorStop(0, '#8a63e0');
    robeG.addColorStop(0.5, '#5e3ab0');
    robeG.addColorStop(1, '#33206b');
    ctx.fillStyle = robeG;
    ctx.beginPath();
    ctx.moveTo(-8, -37);
    ctx.quadraticCurveTo(-11, -22, -13.5, -4);
    ctx.quadraticCurveTo(0, 1, 13.5, -4);
    ctx.quadraticCurveTo(11, -22, 8, -37);
    ctx.closePath();
    ctx.fill();
    // 左侧轮廓光（与左上光源一致）
    ctx.strokeStyle = 'rgba(206,182,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-8, -37);
    ctx.quadraticCurveTo(-11, -22, -13.5, -4);
    ctx.stroke();

    // 袍面高光
    ctx.fillStyle = 'rgba(190,160,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(-6, -36);
    ctx.quadraticCurveTo(-8, -20, -10, -6);
    ctx.quadraticCurveTo(-4, -4, -2, -6);
    ctx.quadraticCurveTo(-2, -22, -1, -36);
    ctx.closePath();
    ctx.fill();

    // 金色腰带
    ctx.fillStyle = '#e9bc5e';
    ctx.fillRect(-9, -25, 18, 3.4);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(-9, -25, 18, 1.2);
    // 胸前宝石
    ctx.fillStyle = '#7fe0ff';
    ctx.beginPath();
    ctx.arc(3, -30, 2.4, 0, TAU);
    ctx.fill();

    // ---- 头部 ----
    const headY = -45;
    ctx.fillStyle = '#f9dec3';
    ctx.beginPath();
    ctx.arc(2, headY, 8, 0, TAU);
    ctx.fill();
    // 腮红
    ctx.fillStyle = 'rgba(240,150,140,0.32)';
    ctx.beginPath();
    ctx.ellipse(6.5, headY + 3, 2.6, 1.7, 0, 0, TAU);
    ctx.fill();
    // 眼睛
    const blink = (this.blinkT % 4.2) > 4.05;
    ctx.fillStyle = '#241733';
    if (!blink) {
      ctx.beginPath();
      ctx.ellipse(0.8, headY + 0.5, 1.25, 1.85, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(5.2, headY + 0.5, 1.25, 1.85, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(1.2, headY - 0.3, 0.55, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(5.6, headY - 0.3, 0.55, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillRect(-0.3, headY + 0.3, 6.6, 1.1);
    }

    // ---- 巫师帽 ----
    const hatTilt = Math.sin(t * 2.6) * 0.02 + (moving ? 0.04 : 0) + castK * 0.05;
    ctx.save();
    ctx.translate(2, headY - 7);
    ctx.rotate(hatTilt);
    // 帽檐
    const brimG = ctx.createLinearGradient(-18, 0, 18, 0);
    brimG.addColorStop(0, '#2c1852');
    brimG.addColorStop(0.5, '#4a2b85');
    brimG.addColorStop(1, '#241341');
    ctx.fillStyle = brimG;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 4.6, 0, 0, TAU);
    ctx.fill();
    // 帽体
    const coneG = ctx.createLinearGradient(-10, -8, 12, -22);
    coneG.addColorStop(0, '#5b3aa4');
    coneG.addColorStop(0.55, '#432a7d');
    coneG.addColorStop(1, '#2a1850');
    ctx.fillStyle = coneG;
    ctx.beginPath();
    ctx.moveTo(-12, -1.5);
    ctx.quadraticCurveTo(-9, -16, 4, -24);
    ctx.quadraticCurveTo(9, -27, 11, -23);
    ctx.quadraticCurveTo(4, -14, 12, -1.5);
    ctx.closePath();
    ctx.fill();
    // 帽带
    ctx.fillStyle = '#e9bc5e';
    ctx.beginPath();
    ctx.moveTo(-11.6, -3);
    ctx.quadraticCurveTo(0, -7.5, 11.6, -3);
    ctx.lineTo(11.4, -6);
    ctx.quadraticCurveTo(0, -10.5, -11.4, -6);
    ctx.closePath();
    ctx.fill();
    // 星星
    const starP = 0.6 + 0.4 * Math.sin(t * 3);
    ctx.fillStyle = 'rgba(255,235,170,' + starP + ')';
    ctx.beginPath();
    ctx.arc(2, -17, 1.8, 0, TAU);
    ctx.fill();
    ctx.restore();

    // ---- 法杖 + 施法 ----
    const staffAngle = -0.05 - castK * 0.44;
    ctx.save();
    ctx.translate(14, -24);
    ctx.rotate(staffAngle);
    // 杖身
    const woodG = ctx.createLinearGradient(-2, 0, 3, 0);
    woodG.addColorStop(0, '#4a3122');
    woodG.addColorStop(0.45, '#8a5c39');
    woodG.addColorStop(1, '#33200f');
    ctx.strokeStyle = woodG;
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-1, 26);
    ctx.quadraticCurveTo(-1.6, 6, 0, -22);
    ctx.stroke();
    // 金色杖头托爪
    ctx.strokeStyle = '#e6c274';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(-3.4, -20);
    ctx.quadraticCurveTo(-5.6, -27, -3.2, -30);
    ctx.moveTo(3.4, -20);
    ctx.quadraticCurveTo(5.6, -27, 3.2, -30);
    ctx.stroke();
    // 宝石
    const orbR = 4.6 + castK * 2.8 + Math.sin(t * 4) * 0.4;
    const orbC = [178, 139, 255];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, -30, 15 + castK * 18, orbC, 0.55 + castK * 0.4);
    ctx.restore();
    const orbG = ctx.createRadialGradient(-1, -31, 0, 0, -30, orbR);
    orbG.addColorStop(0, '#ffffff');
    orbG.addColorStop(0.4, '#dcc8ff');
    orbG.addColorStop(1, '#7c4ff0');
    ctx.fillStyle = orbG;
    ctx.beginPath();
    ctx.arc(0, -30, orbR, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 前臂 + 手
    ctx.strokeStyle = '#5e3ab0';
    ctx.lineWidth = 4.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(5, -35);
    ctx.quadraticCurveTo(11, -31, 13.5, -25);
    ctx.stroke();
    ctx.fillStyle = '#f9dec3';
    ctx.beginPath();
    ctx.arc(13.5, -24.5, 2.6, 0, TAU);
    ctx.fill();

    // ---- 施法法阵 ----
    if (castP > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const a = Math.sin(castP * Math.PI);
      ctx.strokeStyle = 'rgba(200,170,255,' + (a * 0.7) + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0, -2, 26 + castP * 10, 8 + castP * 3, 0, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const ang = castP * 6 + (i / 3) * TAU;
        const rx = 22 + castP * 8;
        ctx.fillStyle = 'rgba(220,200,255,' + (a * 0.9) + ')';
        ctx.beginPath();
        ctx.arc(Math.cos(ang) * rx, -2 + Math.sin(ang) * 6, 1.8, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

/* =========================================================
   怪物
   ========================================================= */
class Monster {
  constructor(type, x, groundY, spawner) {
    const d = MONSTERS[type];
    this.type = type;
    this.def = d;
    this.w = d.w;
    this.h = d.h;
    this.x = x - this.w / 2;
    this.y = groundY - this.h;
    this.vx = 0;
    this.vy = 0;
    this.onGround = true;
    this.homeX = x;
    this.facing = chance(0.5) ? 1 : -1;
    this.dirSign = this.facing;
    this.maxHp = d.hp;
    this.hp = d.hp;
    this.dead = false;
    this.deadT = 0;
    this.animT = rand(0, 10);
    this.bobPhase = rand(0, TAU);
    this.hurtFlash = 0;
    this.aggro = false;
    this.hopTimer = rand(0.4, 1.2);
    this.shootTimer = rand(1.2, 2.4);
    this.flyBaseY = this.y;
    this.spawner = spawner || null;
    this.isBoss = false;
    this.status = { burn: 0, freeze: 0, shock: 0, burnTick: 0, burnDmg: 0 };
    this.hitStun = 0;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update(dt, g) {
    this.animT += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;

    /* 已死亡的怪物只推进死亡计时与坠落，不再结算燃烧/感电等状态 */
    if (this.dead) {
      this.deadT += dt;
      this.vy += CONFIG.gravity * dt;
      this.y += this.vy * dt;
      this.x += this.vx * dt;
      this.vx *= 0.94;
      return;
    }

    /* 状态 */
    const s = this.status;
    if (s.burn > 0) {
      s.burn -= dt;
      s.burnTick -= dt;
      if (s.burnTick <= 0) {
        s.burnTick = 0.42;
        this.hp -= s.burnDmg;
        g.addDamageText(this.cx + rand(-10, 10), this.y + rand(4, 16), Math.round(s.burnDmg), 'fire', false, true);
        g.burst(this.cx + rand(-8, 8), this.cy, [255, 150, 60], 2, 50, 0.4);
        if (chance(0.3)) SFX.hit();
        if (this.hp <= 0) { this.die(g); return; }
      }
    }
    if (s.freeze > 0) s.freeze -= dt;
    if (s.shock > 0) {
      s.shock -= dt;
      if (chance(dt * 8)) g.burst(this.cx + rand(-12, 12), this.cy + rand(-12, 12), [255, 230, 120], 1, 40, 0.25);
    }
    if (this.hitStun > 0) this.hitStun -= dt;

    const frozen = s.freeze > 0;
    const slow = frozen ? 0.12 : 1;

    const p = g.player;
    const dx = p.cx - this.cx;
    const adx = Math.abs(dx);
    const ai = this.def.ai;

    if (ai === 'walk' || ai === 'hop') {
      this.aggro = adx < 460 && Math.abs(p.cy - this.cy) < 220;
      let dir;
      if (this.aggro) {
        dir = Math.sign(dx) || 1;
      } else {
        if (this.x + this.w / 2 < this.homeX - 76) this.dirSign = 1;
        if (this.x + this.w / 2 > this.homeX + 76) this.dirSign = -1;
        dir = this.dirSign;
      }

      if (ai === 'walk') {
        const spd = this.def.speed * slow;
        this.vx = dir * spd;
        this.facing = dir;
      } else {
        // 跳跃型：蓄力—起跳
        this.hopTimer -= dt;
        if (this.onGround) {
          this.vx *= 0.86;
          if (this.hopTimer <= 0) {
            this.hopTimer = rand(0.75, 1.35) * (this.aggro ? 0.75 : 1.2);
            this.vy = -560 * (this.aggro ? 1 : 0.7);
            this.vx = dir * 150 * slow;
            this.facing = dir;
          }
        }
      }
      applyPhysics(this, dt);
    } else if (ai === 'fly') {
      this.aggro = adx < 560;
      const spd = this.def.speed * slow;
      let tx, ty;
      if (this.aggro) {
        tx = p.cx - this.facing * 30;
        ty = p.cy - 40;
      } else {
        tx = this.homeX;
        ty = this.flyBaseY;
      }
      this.vx = approach(this.vx, clamp((tx - this.cx) * 1.6, -spd, spd), 520 * dt);
      this.x += this.vx * dt;
      this.bobPhase += dt * 2.4;
      const targetY = ty + Math.sin(this.bobPhase) * 22;
      this.y = approach(this.y, targetY, 150 * dt * 60 * 0.1 + 90 * dt * 4);
      this.facing = this.vx > 0 ? 1 : this.vx < 0 ? -1 : this.facing;

      if (this.def.ranged && this.aggro) {
        this.shootTimer -= dt * slow;
        if (this.shootTimer <= 0) {
          this.shootTimer = rand(1.8, 2.8);
          const ang = Math.atan2(p.cy - this.cy, p.cx - this.cx);
          g.spawnProjectile({
            x: this.cx, y: this.cy,
            vx: Math.cos(ang) * 240, vy: Math.sin(ang) * 240,
            r: 7, dmg: this.def.dmg, element: 'none',
            color: this.def.color, owner: 'enemy', life: 3, kind: 'orb',
          });
          SFX.castBolt();
        }
      }
    }

    // 掉出世界（不结算经验，避免利用地形刷级）
    if (this.y > CONFIG.H + 200) {
      this.hp = 0;
      this.die(g, true, true);
    }
  }

  hit(dmg, element, g, opts) {
    opts = opts || {};
    if (this.dead) return 0;
    const s = this.status;

    let mult = 1;
    let reaction = null;

    if (element && !opts.noReact && element !== 'arcane' && element !== 'holy') {
      if (element === 'ice' && s.burn > 0) { reaction = 'steam'; mult = 2.0; s.burn = 0; }
      else if (element === 'ice' && s.shock > 0) { reaction = 'shatter'; mult = 2.2; s.shock = 0; }
      else if (element === 'lightning' && s.freeze > 0) { reaction = 'shatter'; mult = 2.5; s.freeze = 0; }
      else if (element === 'lightning' && s.burn > 0) { reaction = 'blaze'; mult = 1.9; }
      else if (element === 'fire' && s.freeze > 0) { reaction = 'steam'; mult = 2.0; s.freeze = 0; }
      else if (element === 'fire' && s.shock > 0) { reaction = 'blaze'; mult = 1.9; s.shock = 0; }
    }

    const crit = !opts.noCrit && chance(0.15);
    let total = dmg * mult * (opts.ignoreCombo ? 1 : g.combo.mult);
    total *= crit ? 1.85 : 1;
    total *= rand(0.93, 1.07);
    total *= 1 - (this.def.armor || 0);
    total = Math.max(1, Math.round(total));

    this.hp -= total;
    this.hurtFlash = 0.13;

    if (!opts.noCombo) g.registerHit(element, !!reaction);

    g.addDamageText(
      this.cx + rand(-8, 8), this.y + rand(2, 14),
      total, element || 'arcane', crit
    );
    g.burst(this.cx + rand(-10, 10), this.cy + rand(-14, 6), ELEMENT_COLORS[element] || ELEMENT_COLORS.arcane, crit ? 10 : 5, 190, 0.5);
    if (crit) { SFX.crit(); g.haptic(16); } else if (chance(0.6)) SFX.hit();

    /* 元素附着 */
    if (element === 'fire') {
      s.burn = 3;
      s.burnDmg = Math.max(s.burnDmg * 0.5, dmg * 0.16);
      s.burnTick = 0.4;
      g.tip('burn', '灼烧中 → 用「冰霜箭」命中可触发 蒸汽爆裂');
    } else if (element === 'ice') {
      s.freeze = 2.2;
      g.tip('freeze', '冻结中 → 用「雷电术」命中可触发 霜雷爆');
    } else if (element === 'lightning') {
      s.shock = 1.6;
      g.tip('shock', '感电中 → 用「火焰」命中可触发 燎原');
    }

    /* 元素反应 */
    if (reaction) {
      const R = REACTIONS[reaction];
      g.addReactionText(this.cx, this.y - 44, R.name, R.color);
      g.aoe(this.cx, this.cy, R.radius, total * R.power, element, {
        noReact: true, noCombo: true, exclude: this, noCrit: true,
      });
      g.burst(this.cx, this.cy, R.color, 26, 320, 0.8);
      g.effects.push(new Blast(this.cx, this.cy, R.radius * 1.5, R.color, 0.45));
      g.ring(this.cx, this.cy, R.radius * 0.9, R.color);
      g.shake(reaction === 'shatter' ? 9 : 6);
      g.hitstop = Math.max(g.hitstop, 0.045);
      SFX.reaction();
      g.player.mp = Math.min(g.player.maxMp, g.player.mp + 10);
      g.reactionCount = (g.reactionCount || 0) + 1;
    }

    this.vx += (this.cx < g.player.cx ? -1 : 1) * (opts.knock || 26);

    if (this.hp <= 0) this.die(g);
    return total;
  }

  die(g, silent, noExp) {
    if (this.dead) return;
    this.dead = true;
    this.noExp = !!noExp;
    this.deadT = 0;
    this.vy = -260;
    this.vx = (chance(0.5) ? -1 : 1) * 60;
    g.onMonsterDeath(this, silent);
  }

  /* -------------------- 绘制 -------------------- */
  draw(ctx, time) {
    const b = this.def.color;
    // 死亡淡出共用系数：连影子一起淡掉，否则尸体会先消失、地上还留一坨影子
    const deathA = this.dead ? clamp(1 - this.deadT / 0.9, 0, 1) : 1;
    if (deathA <= 0.02) return;
    ctx.save();

    // 影子
    if (this.def.ai !== 'fly') {
      ctx.globalAlpha = 0.24 * deathA;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(this.cx, this.y + this.h + 3, this.w * 0.42, 5, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (this.dead) {
      ctx.globalAlpha = deathA;
      ctx.translate(this.cx, this.cy);
      ctx.rotate(this.deadT * 3);
      ctx.translate(-this.cx, -this.cy);
    }

    if (this.type === 'slime') this.drawSlime(ctx, time, b);
    else if (this.type === 'mush') this.drawMush(ctx, time, b);
    else if (this.type === 'bat') this.drawBat(ctx, time, b);
    else if (this.type === 'golem') this.drawGolem(ctx, time, b);
    else if (this.type === 'wisp') this.drawWisp(ctx, time, b);

    // 冻结覆盖
    if (this.status.freeze > 0) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = 'rgba(140,225,255,0.55)';
      rr(ctx, this.x - 2, this.y - 2, this.w + 4, this.h + 4, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(220,250,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // 受击白闪（柔和径向，避免出现白方块）
    if (this.hurtFlash > 0 && !this.dead) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const k = clamp(this.hurtFlash / 0.13, 0, 1);
      const ccx = this.cx, ccy = this.cy;
      const fg = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, this.w * 0.95);
      fg.addColorStop(0, 'rgba(255,255,255,' + (k * 0.55) + ')');
      fg.addColorStop(0.55, 'rgba(255,255,255,' + (k * 0.2) + ')');
      fg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(ccx, ccy, this.w * 0.95, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    // 血条
    if (!this.dead && this.hp < this.maxHp && this.maxHp > 0) {
      const bw = Math.max(34, this.w * 0.9);
      const bx = this.cx - bw / 2;
      const by = this.y - 11;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      rr(ctx, bx - 1, by - 1, bw + 2, 6, 3);
      ctx.fill();
      const hpP = clamp(this.hp / this.maxHp, 0, 1);
      const hg = ctx.createLinearGradient(0, by, 0, by + 4);
      hg.addColorStop(0, '#ff8080');
      hg.addColorStop(1, '#c02035');
      ctx.fillStyle = hg;
      rr(ctx, bx, by, bw * hpP, 4, 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawSlime(ctx, time, c) {
    const squash = 1 + Math.sin(time * 5 + this.bobPhase) * 0.1;
    const bw = (this.w / 2) * squash;
    const bh = this.h * (1 / squash);
    const cy = this.y + this.h;

    ctx.save();
    ctx.translate(this.cx, cy);

    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, -bh * 0.5, bw * 1.5, c, 0.12);
    ctx.globalCompositeOperation = 'source-over';

    const g = ctx.createRadialGradient(-bw * 0.25, -bh * 0.78, 2, 0, -bh * 0.5, bw * 1.25);
    g.addColorStop(0, rgba(shade(c, 1.5)));
    g.addColorStop(0.45, rgba(c));
    g.addColorStop(1, rgba(shade(c, 0.6)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -bh * 0.52, bw, bh * 0.54, 0, 0, TAU);
    ctx.fill();

    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(-bw * 0.32, -bh * 0.78, bw * 0.2, bh * 0.12, -0.4, 0, TAU);
    ctx.fill();

    // 眼睛
    const ex = this.facing * 2;
    ctx.fillStyle = '#10241a';
    ctx.beginPath();
    ctx.ellipse(-6 + ex, -bh * 0.6, 2.6, 3.6, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(7 + ex, -bh * 0.6, 2.6, 3.6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(-6.4 + ex, -bh * 0.64, 0.9, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(6.6 + ex, -bh * 0.64, 0.9, 0, TAU);
    ctx.fill();

    // 嘴
    ctx.strokeStyle = 'rgba(20,50,30,0.7)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(1 + ex, -bh * 0.44, 4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  drawMush(ctx, time, c) {
    const bounce = this.onGround ? Math.abs(Math.sin(time * 3 + this.bobPhase)) * 2 : 0;
    const cy = this.y + this.h;
    ctx.save();
    ctx.translate(this.cx, cy - bounce);

    // 菌柄
    const stemG = ctx.createLinearGradient(-10, -30, 12, 0);
    stemG.addColorStop(0, '#f4e2c8');
    stemG.addColorStop(1, '#d3b493');
    ctx.fillStyle = stemG;
    rr(ctx, -12, -30, 24, 30, 9);
    ctx.fill();

    // 眼睛
    ctx.fillStyle = '#3a2a20';
    const ex = this.facing * 2;
    ctx.beginPath();
    ctx.ellipse(-4.5 + ex, -19, 2.1, 3, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(5 + ex, -19, 2.1, 3, 0, 0, TAU);
    ctx.fill();
    // 嘴
    ctx.strokeStyle = 'rgba(80,50,40,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0.5 + ex, -13, 3.4, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();

    // 菌盖
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, -34, 40, c, 0.1);
    ctx.globalCompositeOperation = 'source-over';
    const capG = ctx.createRadialGradient(-6, -44, 2, 0, -34, 30);
    capG.addColorStop(0, rgba(shade(c, 1.35)));
    capG.addColorStop(0.6, rgba(c));
    capG.addColorStop(1, rgba(shade(c, 0.62)));
    ctx.fillStyle = capG;
    ctx.beginPath();
    ctx.ellipse(0, -30, 22, 17, 0, Math.PI, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -30, 22, 4.5, 0, 0, Math.PI);
    ctx.fill();

    // 斑点
    ctx.fillStyle = 'rgba(255,240,225,0.8)';
    ctx.beginPath();
    ctx.ellipse(-8, -38, 3.4, 2.6, 0.3, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(7, -40, 2.6, 2.1, -0.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(1, -34, 1.8, 1.4, 0, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  drawBat(ctx, time, c) {
    const flap = Math.sin(time * 14 + this.bobPhase);
    ctx.save();
    ctx.translate(this.cx, this.cy);

    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, 40, c, 0.14);
    ctx.globalCompositeOperation = 'source-over';

    // 翅膀
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.rotate(flap * 0.5 * side * 0.6);
      const wg = ctx.createLinearGradient(0, 0, 30, 8);
      wg.addColorStop(0, rgba(shade(c, 0.9)));
      wg.addColorStop(1, rgba(shade(c, 0.42), 0.9));
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.moveTo(4, -2);
      ctx.quadraticCurveTo(20, -14 + flap * 4, 30, 2 + flap * 3);
      ctx.quadraticCurveTo(20, 2, 26, 12 + flap * 2);
      ctx.quadraticCurveTo(14, 8, 6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 身体
    const bg = ctx.createRadialGradient(-3, -4, 1, 0, 0, 14);
    bg.addColorStop(0, rgba(shade(c, 1.3)));
    bg.addColorStop(1, rgba(shade(c, 0.55)));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 11, 0, 0, TAU);
    ctx.fill();

    // 耳朵
    ctx.fillStyle = rgba(shade(c, 0.8));
    ctx.beginPath();
    ctx.moveTo(-6, -8);
    ctx.lineTo(-9, -17);
    ctx.lineTo(-2, -11);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, -8);
    ctx.lineTo(9, -17);
    ctx.lineTo(2, -11);
    ctx.closePath();
    ctx.fill();

    // 眼睛
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,240,120,0.95)';
    for (const ex of [-3.5, 3.5]) {
      ctx.beginPath();
      ctx.arc(ex, -1, 1.9, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();
  }

  drawGolem(ctx, time, c) {
    const sway = Math.sin(time * 1.8 + this.bobPhase) * 0.045;
    const cy = this.y + this.h;
    ctx.save();
    ctx.translate(this.cx, cy);

    const dark = shade(c, 0.48);
    const mid = c;
    const light = shade(c, 1.16);
    const pulse = 0.45 + 0.55 * Math.sin(time * 2.4 + this.bobPhase);

    // 腿
    ctx.fillStyle = rgba(dark);
    rr(ctx, -23, -26, 19, 26, 7);
    ctx.fill();
    rr(ctx, 4, -26, 19, 26, 7);
    ctx.fill();

    ctx.save();
    ctx.rotate(sway);

    // 手臂（身后）
    ctx.fillStyle = rgba(shade(c, 0.52));
    rr(ctx, -44, -56, 17, 34, 8);
    ctx.fill();
    rr(ctx, 27, -56, 17, 34, 8);
    ctx.fill();
    // 拳头
    ctx.fillStyle = rgba(shade(c, 0.66));
    rr(ctx, -46, -24, 20, 16, 7);
    ctx.fill();
    rr(ctx, 26, -24, 20, 16, 7);
    ctx.fill();

    // 身体
    const bg = ctx.createLinearGradient(-28, -62, 26, -18);
    bg.addColorStop(0, rgba(light));
    bg.addColorStop(0.5, rgba(mid));
    bg.addColorStop(1, rgba(dark));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-23, -20);
    ctx.lineTo(-28, -47);
    ctx.lineTo(-16, -62);
    ctx.lineTo(16, -62);
    ctx.lineTo(28, -47);
    ctx.lineTo(23, -20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // 侧面暗部
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.moveTo(-23, -20);
    ctx.lineTo(-28, -47);
    ctx.lineTo(-12, -50);
    ctx.lineTo(-9, -20);
    ctx.closePath();
    ctx.fill();

    // 石块分割线
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-2, -58);
    ctx.lineTo(-5, -40);
    ctx.lineTo(3, -30);
    ctx.stroke();

    // 头
    const headG = ctx.createLinearGradient(-14, -78, 14, -56);
    headG.addColorStop(0, rgba(shade(c, 1.26)));
    headG.addColorStop(1, rgba(shade(c, 0.8)));
    ctx.fillStyle = headG;
    rr(ctx, -14, -77, 28, 23, 9);
    ctx.fill();
    // 头与身体的暗部分界
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    rr(ctx, -14, -58, 28, 4, 2);
    ctx.fill();

    // 裂纹 + 眼睛
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(130,230,255,' + (0.3 + pulse * 0.45) + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, -56);
    ctx.lineTo(-2, -46);
    ctx.lineTo(-7, -38);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(10, -54);
    ctx.lineTo(6, -42);
    ctx.stroke();

    ctx.fillStyle = 'rgba(150,240,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(-5.5, -67, 2.9, 3.4, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(5.5, -67, 2.9, 3.4, 0, 0, TAU);
    ctx.fill();
    glow(ctx, 0, -67, 22, [130, 230, 255], 0.1 + pulse * 0.1);
    ctx.globalCompositeOperation = 'source-over';

    ctx.restore();
    ctx.restore();
  }

  drawWisp(ctx, time, c) {
    ctx.save();
    ctx.translate(this.cx, this.cy);
    const pulse = 0.55 + 0.45 * Math.sin(time * 4 + this.bobPhase);

    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, 46 * (0.9 + pulse * 0.2), c, 0.3);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, rgba(shade(c, 1.25), 0.9));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, TAU);
    ctx.fill();

    // 拖尾
    ctx.strokeStyle = rgba(c, 0.5);
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const a = time * 2 + (i / 3) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
      ctx.quadraticCurveTo(Math.cos(a + 0.6) * 20, Math.sin(a + 0.6) * 20,
        Math.cos(a + 0.9) * 26, Math.sin(a + 0.9) * 26);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // 眼睛
    ctx.fillStyle = 'rgba(20,40,70,0.85)';
    for (const ex of [-3.4, 3.4]) {
      ctx.beginPath();
      ctx.arc(ex, -1, 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* =========================================================
   Boss：暗影魔君
   ========================================================= */
class Boss {
  constructor(x, groundY) {
    const d = BOSS_DEF;
    this.type = 'boss';
    this.def = d;
    this.w = d.w;
    this.h = d.h;
    this.x = x - this.w / 2;
    this.y = groundY - this.h - 40;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.facing = -1;
    this.maxHp = d.hp;
    this.hp = d.hp;
    this.dead = false;
    this.deadT = 0;
    this.animT = 0;
    this.hurtFlash = 0;
    this.isBoss = true;
    this.homeX = x;
    this.baseY = this.y;
    this.atkTimer = 2.2;
    this.castAnim = 0;
    this.action = null;
    this.actionT = 0;
    this.enraged = false;
    this.phase = 1;
    this.status = { burn: 0, freeze: 0, shock: 0, burnTick: 0, burnDmg: 0 };
    this.shards = [];
    for (let i = 0; i < 5; i++) this.shards.push({ a: (i / 5) * TAU, r: 92 + i * 6, sp: 0.6 + i * 0.1 });
    this.spawner = null;
    this.introT = 1.6;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update(dt, g) {
    this.animT += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.castAnim > 0) this.castAnim -= dt;

    const s = this.status;
    if (s.burn > 0) {
      s.burn -= dt;
      s.burnTick -= dt;
      if (s.burnTick <= 0) {
        s.burnTick = 0.42;
        this.hp -= s.burnDmg;
        g.addDamageText(this.cx + rand(-20, 20), this.y + rand(20, 60), Math.round(s.burnDmg), 'fire', false, true);
        if (this.hp <= 0) { this.die(g); return; }
      }
    }
    if (s.freeze > 0) s.freeze -= dt;
    if (s.shock > 0) s.shock -= dt;

    if (this.dead) {
      this.deadT += dt;
      this.y += 26 * dt;
      this.x += Math.sin(this.deadT * 6) * 30 * dt;
      return;
    }

    if (!this.enraged && this.hp < this.maxHp * 0.42) {
      this.enraged = true;
      g.toast('暗影魔君进入狂暴状态！', 'warn');
      g.shake(16);
      g.flashScreen(0.3, [190, 60, 220]);
      SFX.explode();
    }

    const p = g.player;
    const dx = p.cx - this.cx;
    this.facing = dx > 0 ? 1 : -1;

    if (this.introT > 0) {
      this.introT -= dt;
      this.y = this.baseY + Math.sin(this.animT * 3) * 6;
      return;
    }

    // 悬浮移动
    const slow = s.freeze > 0 ? 0.25 : 1;
    const speed = (this.enraged ? 135 : 88) * slow;
    const want = p.cx - this.facing * 190;
    this.vx = approach(this.vx, clamp((want - this.cx) * 1.2, -speed, speed), 300 * dt);
    this.x = clamp(this.x + this.vx * dt, 5460, WORLD.width - this.w - 40);
    this.y = this.baseY + Math.sin(this.animT * 1.8) * 12;

    // 行动
    this.atkTimer -= dt * slow;
    if (this.action) {
      this.actionT -= dt;
      if (this.actionT <= 0) this.resolveAction(g, p);
    } else if (this.atkTimer <= 0) {
      this.chooseAction(g, p);
    }
  }

  chooseAction(g, p) {
    this.atkTimer = this.enraged ? 1.5 : 2.3;
    const r = Math.random();
    if (r < 0.42) {
      this.action = 'volley';
      this.actionT = 0.55;
      this.castAnim = 0.7;
    } else if (r < 0.76) {
      this.action = 'slam';
      this.actionT = 0.7;
    } else {
      this.action = 'summon';
      this.actionT = 0.6;
      this.castAnim = 0.8;
    }
  }

  resolveAction(g, p) {
    const act = this.action;
    this.action = null;

    if (act === 'volley') {
      const n = this.enraged ? 5 : 3;
      const base = Math.atan2(p.cy - this.cy, p.cx - this.cx);
      for (let i = 0; i < n; i++) {
        const ang = base + (i - (n - 1) / 2) * 0.19;
        g.spawnProjectile({
          x: this.cx + Math.cos(ang) * 40, y: this.cy + Math.sin(ang) * 40,
          vx: Math.cos(ang) * 330, vy: Math.sin(ang) * 330,
          r: 11, dmg: 26, element: 'shadow',
          color: [190, 90, 220], owner: 'enemy', life: 3.2, kind: 'shadow',
        });
      }
      SFX.castFire();
      g.burst(this.cx, this.cy, [190, 90, 220], 14, 220, 0.6);
    } else if (act === 'slam') {
      g.shake(20);
      SFX.explode();
      for (const dir of [-1, 1]) {
        g.spawnProjectile({
          x: this.cx, y: WORLD.groundY - 22,
          vx: dir * 420, vy: 0,
          r: 22, dmg: 28, element: 'none',
          color: [255, 120, 90], owner: 'enemy', life: 2.2, kind: 'wave',
        });
      }
      for (let i = 0; i < 18; i++) {
        g.burst(this.cx + rand(-60, 60), WORLD.groundY, [255, 150, 90], 2, 300, 0.7);
      }
    } else if (act === 'summon') {
      for (let i = 0; i < 2; i++) {
        const nx = this.cx + rand(-140, 140);
        const m = new Monster('bat', clamp(nx, 5480, WORLD.width - 100), this.y + this.h - 60, null);
        m.maxHp = 90;
        m.hp = 90;
        g.monsters.push(m);
        g.burst(m.cx, m.cy, [190, 90, 220], 12, 180, 0.6);
      }
      SFX.buff();
    }
  }

  hit(dmg, element, g, opts) {
    opts = opts || {};
    if (this.dead) return 0;
    const s = this.status;
    let mult = 1, reaction = null;

    if (element && !opts.noReact && element !== 'arcane' && element !== 'holy') {
      if (element === 'ice' && s.burn > 0) { reaction = 'steam'; mult = 2.0; s.burn = 0; }
      else if (element === 'ice' && s.shock > 0) { reaction = 'shatter'; mult = 2.2; s.shock = 0; }
      else if (element === 'lightning' && s.freeze > 0) { reaction = 'shatter'; mult = 2.5; s.freeze = 0; }
      else if (element === 'lightning' && s.burn > 0) { reaction = 'blaze'; mult = 1.9; }
      else if (element === 'fire' && s.freeze > 0) { reaction = 'steam'; mult = 2.0; s.freeze = 0; }
      else if (element === 'fire' && s.shock > 0) { reaction = 'blaze'; mult = 1.9; s.shock = 0; }
    }

    const crit = !opts.noCrit && chance(0.15);
    let total = dmg * mult * (opts.ignoreCombo ? 1 : g.combo.mult);
    total *= crit ? 1.85 : 1;
    total *= rand(0.93, 1.07);
    total *= 1 - (this.def.armor || 0);
    total = Math.max(1, Math.round(total));

    this.hp -= total;
    this.hurtFlash = 0.12;
    if (!opts.noCombo) g.registerHit(element, !!reaction);

    g.addDamageText(this.cx + rand(-30, 30), this.y + rand(30, 70), total, element || 'arcane', crit);
    g.burst(this.cx + rand(-30, 30), this.cy + rand(-30, 30), ELEMENT_COLORS[element] || ELEMENT_COLORS.arcane, crit ? 12 : 6, 220, 0.6);
    if (crit) { SFX.crit(); g.haptic(16); }

    if (element === 'fire') { s.burn = 3; s.burnDmg = Math.max(s.burnDmg * 0.5, dmg * 0.16); s.burnTick = 0.4; }
    else if (element === 'ice') s.freeze = 1.4;
    else if (element === 'lightning') s.shock = 1.6;

    if (reaction) {
      const R = REACTIONS[reaction];
      g.addReactionText(this.cx, this.y + 40, R.name, R.color);
      g.aoe(this.cx, this.cy, R.radius * 1.2, total * R.power, element, {
        noReact: true, noCombo: true, exclude: this, noCrit: true,
      });
      g.burst(this.cx, this.cy, R.color, 28, 340, 0.9);
      g.effects.push(new Blast(this.cx, this.cy, R.radius * 1.8, R.color, 0.5));
      g.ring(this.cx, this.cy, R.radius, R.color);
      g.shake(10);
      g.hitstop = Math.max(g.hitstop, 0.05);
      g.haptic([12, 22, 34]);   // 元素反应：三段短震，有节奏感
      SFX.reaction();
      g.player.mp = Math.min(g.player.maxMp, g.player.mp + 12);
      g.reactionCount = (g.reactionCount || 0) + 1;
    }

    if (this.hp <= 0) this.die(g);
    return total;
  }

  die(g) {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.action = null;
    g.onBossDeath(this);
  }

  draw(ctx, time) {
    const cx = this.cx;
    const topY = this.y;
    ctx.save();

    // 影子
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, WORLD.groundY + 4, 70, 12, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (this.dead) ctx.globalAlpha = clamp(1 - this.deadT / 2, 0, 1);

    const bob = Math.sin(this.animT * 1.8) * 4;
    const rage = this.enraged ? 1 : 0;

    // 光环
    ctx.globalCompositeOperation = 'lighter';
    const auraC = this.enraged ? [255, 90, 90] : [170, 90, 255];
    glow(ctx, cx, this.cy + bob, 165, auraC, 0.24 + rage * 0.1);
    if (this.action) {
      glow(ctx, cx, this.cy + bob, 200, [255, 120, 160], 0.2 + 0.2 * Math.sin(time * 20));
    }
    ctx.globalCompositeOperation = 'source-over';

    // 环绕碎片
    for (const sh of this.shards) {
      const a = sh.a + time * sh.sp;
      const sx = cx + Math.cos(a) * sh.r;
      const sy = this.cy + bob + Math.sin(a) * sh.r * 0.42;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a * 2);
      ctx.fillStyle = rgba(this.enraged ? [255, 120, 120] : [190, 140, 255], 0.85);
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5, 0);
      ctx.lineTo(0, 8);
      ctx.lineTo(-5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 双臂（自斗篷两侧伸出；斗篷半宽 58，手臂必须伸到 58 以外才看得见）
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + side * 40, topY + 78 + bob);
      const sway = Math.sin(time * 1.6 + (side > 0 ? 0 : 1.2)) * 0.1;
      ctx.rotate(side * (0.3 + sway));
      ctx.lineCap = 'round';

      // 上臂 → 前臂：一条渐细的骨感肢体
      ctx.strokeStyle = this.enraged ? '#9c2646' : '#50278b';
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * 22, 4, side * 34, 26);
      ctx.stroke();
      // 受光侧高光
      ctx.strokeStyle = this.enraged ? 'rgba(255,150,150,0.5)' : 'rgba(206,170,255,0.45)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(side * 2, -5);
      ctx.quadraticCurveTo(side * 22, -1, side * 32, 20);
      ctx.stroke();

      // 三根利爪
      ctx.strokeStyle = this.enraged ? 'rgba(255,205,205,0.95)' : 'rgba(232,212,255,0.95)';
      ctx.lineWidth = 3.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(side * (32 + i * 2), 24 + i * 2);
        ctx.quadraticCurveTo(side * (46 + i * 5), 30 + i * 4, side * (48 + i * 7), 46 + i * 5);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 斗篷/身体
    const bodyG = ctx.createLinearGradient(cx, topY, cx, topY + this.h);
    bodyG.addColorStop(0, this.enraged ? '#7a1740' : '#48227a');
    bodyG.addColorStop(0.55, this.enraged ? '#420c24' : '#261045');
    bodyG.addColorStop(1, '#08040f');
    ctx.fillStyle = bodyG;
    ctx.beginPath();
    ctx.moveTo(cx, topY + 22 + bob);
    ctx.quadraticCurveTo(cx - 40, topY + 40 + bob, cx - 58, topY + this.h - 10);
    ctx.quadraticCurveTo(cx - 40, topY + this.h - 4 + Math.sin(time * 3) * 4, cx, topY + this.h - 14);
    ctx.quadraticCurveTo(cx + 40, topY + this.h - 4 - Math.sin(time * 3) * 4, cx + 58, topY + this.h - 10);
    ctx.quadraticCurveTo(cx + 40, topY + 40 + bob, cx, topY + 22 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = this.enraged ? 'rgba(255,150,150,0.5)' : 'rgba(190,140,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 兜帽
    const hoodG = ctx.createRadialGradient(cx, topY + 34 + bob, 4, cx, topY + 40 + bob, 48);
    hoodG.addColorStop(0, this.enraged ? '#7a1a3a' : '#4a2280');
    hoodG.addColorStop(1, 'rgba(12,6,22,0.95)');
    ctx.fillStyle = hoodG;
    ctx.beginPath();
    ctx.moveTo(cx, topY + bob);
    ctx.quadraticCurveTo(cx + 44, topY + 16 + bob, cx + 34, topY + 62 + bob);
    ctx.quadraticCurveTo(cx, topY + 82 + bob, cx - 34, topY + 62 + bob);
    ctx.quadraticCurveTo(cx - 44, topY + 16 + bob, cx, topY + bob);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = this.enraged ? 'rgba(255,160,160,0.45)' : 'rgba(200,150,255,0.45)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 胸口核心
    const coreY = topY + 98 + bob;
    const coreP = 0.6 + 0.4 * Math.sin(time * 3);
    ctx.save();
    ctx.translate(cx, coreY);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, 48, this.enraged ? [255, 90, 90] : [170, 110, 255], 0.32 * coreP);
    ctx.rotate(time * 0.9);
    ctx.fillStyle = this.enraged ? 'rgba(255,160,160,0.95)' : 'rgba(214,178,255,0.95)';
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(9, 0);
    ctx.lineTo(0, 13);
    ctx.lineTo(-9, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 角
    ctx.fillStyle = this.enraged ? '#ffb0b0' : '#d8c0ff';
    ctx.beginPath();
    ctx.moveTo(cx - 26, topY + 26 + bob);
    ctx.lineTo(cx - 46, topY - 14 + bob);
    ctx.lineTo(cx - 14, topY + 12 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 26, topY + 26 + bob);
    ctx.lineTo(cx + 46, topY - 14 + bob);
    ctx.lineTo(cx + 14, topY + 12 + bob);
    ctx.closePath();
    ctx.fill();

    // 眼睛
    ctx.globalCompositeOperation = 'lighter';
    const eyeC = this.enraged ? 'rgba(255,80,80,0.98)' : 'rgba(210,140,255,0.98)';
    ctx.fillStyle = eyeC;
    ctx.beginPath();
    ctx.ellipse(cx - 14 + this.facing * 3, topY + 44 + bob, 6.5, 3.6, -0.18, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 14 + this.facing * 3, topY + 44 + bob, 6.5, 3.6, 0.18, 0, TAU);
    ctx.fill();
    glow(ctx, cx, topY + 44 + bob, 60, this.enraged ? [255, 80, 80] : [180, 120, 255], 0.35);

    // 蓄力法球
    if (this.action) {
      const p = 1 - this.actionT / (this.action === 'volley' ? 0.55 : this.action === 'slam' ? 0.7 : 0.6);
      glow(ctx, cx + this.facing * 46, this.cy + bob, 46 * (0.4 + p), [255, 150, 200], 0.55);
      ctx.strokeStyle = 'rgba(255,180,220,' + (0.4 + p * 0.5) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + this.facing * 46, this.cy + bob, 30 * (0.4 + p * 0.7), 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // 受击白闪
    if (this.hurtFlash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.hurtFlash * 3;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(cx, this.cy + bob, 56, 76, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();
  }
}

/* =========================================================
   弹道
   ========================================================= */
class Projectile {
  constructor(o) {
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.r = 8; this.dmg = 0; this.element = 'arcane';
    this.color = [178, 139, 255];
    this.life = 2.2; this.owner = 'player';
    this.pierce = 0; this.hitSet = new Set();
    this.kind = 'orb'; this.spin = 0; this.gravity = 0;
    this.rot = 0;
    this.trail = [];
    this.dead = false;
    this.age = 0;
    Object.assign(this, o);
    this.age = 0;
  }

  update(dt, g) {
    this.age += dt;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }

    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += dt * 9;

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 9) this.trail.shift();

    if (this.x < -100 || this.x > WORLD.width + 100 || this.y > CONFIG.H + 200 || this.y < -400) {
      this.dead = true;
      return;
    }

    if (this.owner === 'player') {
      const targets = g.monsters.concat(g.boss && !g.boss.dead ? [g.boss] : []);
      for (const m of targets) {
        if (m.dead || this.hitSet.has(m)) continue;
        const dx = m.x + m.w / 2 - this.x;
        const dy = m.y + m.h / 2 - this.y;
        if (Math.abs(dx) < m.w / 2 + this.r && Math.abs(dy) < m.h / 2 + this.r) {
          g.projectileHit(this, m);
          this.hitSet.add(m);
          this.pierce--;
          if (this.pierce < 0) { this.dead = true; return; }
        }
      }
    } else {
      const p = g.player;
      if (p.invuln <= 0 &&
        Math.abs(p.x + p.w / 2 - this.x) < p.w / 2 + this.r &&
        Math.abs(p.y + p.h / 2 - this.y) < p.h / 2 + this.r) {
        p.takeDamage(this.dmg, g);
        this.dead = true;
        g.burst(this.x, this.y, this.color, 14, 220, 0.6);
        return;
      }
    }
  }

  draw(ctx, time) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 拖尾
    for (let i = 0; i < this.trail.length; i++) {
      const t = i / this.trail.length;
      const p = this.trail[i];
      ctx.fillStyle = rgba(this.color, t * 0.28);
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.r * t * 0.9, 0, TAU);
      ctx.fill();
    }

    if (this.kind === 'shard') {
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.fillStyle = rgba(shade(this.color, 1.2), 0.95);
      ctx.beginPath();
      ctx.moveTo(0, -this.r * 1.8);
      ctx.lineTo(this.r * 0.75, 0);
      ctx.lineTo(0, this.r * 1.8);
      ctx.lineTo(-this.r * 0.75, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.moveTo(0, -this.r * 1.8);
      ctx.lineTo(this.r * 0.4, -this.r * 0.2);
      ctx.lineTo(-this.r * 0.4, -this.r * 0.2);
      ctx.closePath();
      ctx.fill();
    } else if (this.kind === 'wave') {
      const wobble = Math.sin(time * 22) * 5;
      ctx.fillStyle = rgba(this.color, 0.8);
      ctx.beginPath();
      ctx.moveTo(this.x - 16, WORLD.groundY);
      ctx.quadraticCurveTo(this.x, WORLD.groundY - 54 - wobble, this.x + 16, WORLD.groundY);
      ctx.closePath();
      ctx.fill();
      glow(ctx, this.x, WORLD.groundY - 24, 58, this.color, 0.42);
    } else if (this.kind === 'shadow') {
      glow(ctx, this.x, this.y, this.r * 4.2, this.color, 0.5);
      const g2 = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r);
      g2.addColorStop(0, 'rgba(255,255,255,0.95)');
      g2.addColorStop(0.4, rgba(shade(this.color, 1.3), 0.9));
      g2.addColorStop(1, rgba(this.color, 0));
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, TAU);
      ctx.fill();
    } else {
      glow(ctx, this.x, this.y, this.r * 4.6, this.color, 0.6);
      const g2 = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r * 1.7);
      g2.addColorStop(0, 'rgba(255,255,255,0.95)');
      g2.addColorStop(0.22, 'rgba(255,255,255,0.7)');
      g2.addColorStop(0.45, rgba(shade(this.color, 1.15), 0.92));
      g2.addColorStop(0.8, rgba(this.color, 0.55));
      g2.addColorStop(1, rgba(this.color, 0));
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 1.7, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }
}

/* =========================================================
   拾取物
   ========================================================= */
class Pickup {
  constructor(x, y, kind) {
    this.x = x;
    this.y = y;
    this.kind = kind;
    this.vy = -220;
    this.vx = rand(-60, 60);
    this.t = 0;
    this.dead = false;
    this.r = 11;
  }
  update(dt, g) {
    this.t += dt;
    this.vy += 1500 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.98;

    const ground = findGroundAt(this.x);
    if (ground && this.y > ground.y - 14) {
      this.y = ground.y - 14;
      this.vy *= -0.42;
      this.vx *= 0.7;
      if (Math.abs(this.vy) < 40) this.vy = 0;
    }

    const p = g.player;
    const d = Math.hypot(p.cx - this.x, p.cy - this.y);
    if (d < 90) {
      const k = 260 * dt;
      this.x += ((p.cx - this.x) / d) * k * 3;
      this.y += ((p.cy - this.y) / d) * k * 3;
    }
    if (d < 26) {
      this.dead = true;
      if (this.kind === 'hp') {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.14);
        g.addFloatText(p.cx, p.y - 6, '+' + Math.round(p.maxHp * 0.14), [255, 140, 150]);
      } else {
        p.mp = Math.min(p.maxMp, p.mp + p.maxMp * 0.2);
        g.addFloatText(p.cx, p.y - 6, '+' + Math.round(p.maxMp * 0.2), [140, 200, 255]);
      }
      g.burst(this.x, this.y, this.kind === 'hp' ? [255, 130, 140] : [130, 190, 255], 12, 180, 0.5);
      SFX.pickup();
    }
  }
  draw(ctx, time) {
    const c = this.kind === 'hp' ? [255, 120, 140] : [130, 190, 255];
    const bob = Math.sin(time * 4 + this.x) * 3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, this.x, this.y + bob, 26, c, 0.45);
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createRadialGradient(this.x - 2, this.y + bob - 3, 0, this.x, this.y + bob, 9);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.5, rgba(shade(c, 1.2)));
    g.addColorStop(1, rgba(shade(c, 0.75)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y + bob, 8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/* =========================================================
   特效
   ========================================================= */
class Ring {
  constructor(x, y, radius, color, dur) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.color = color;
    this.t = 0;
    this.dur = dur || 0.42;
    this.dead = false;
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.dur) this.dead = true;
  }
  draw(ctx) {
    const k = this.t / this.dur;
    const r = this.radius * easeOutCubic(k);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(this.color, (1 - k) * 0.85);
    ctx.lineWidth = 3 * (1 - k) + 0.6;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

class FloatText {
  constructor(x, y, text, color, opts) {
    opts = opts || {};
    this.x = x; this.y = y;
    this.text = String(text);
    this.color = color;
    this.t = 0;
    this.dur = opts.dur || 0.85;
    this.size = opts.size || 17;
    this.dead = false;
    this.vy = opts.vy == null ? -68 : opts.vy;
    this.vx = opts.vx == null ? rand(-24, 24) : opts.vx;
  }
  update(dt) {
    this.t += dt;
    this.y += this.vy * dt;
    this.x += this.vx * dt;
    this.vy *= 0.94;
    if (this.t >= this.dur) this.dead = true;
  }
  draw(ctx) {
    const k = this.t / this.dur;
    const alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    const pop = k < 0.16 ? easeOutBack(k / 0.16) : 1;
    const s = this.size * (0.6 + pop * 0.4) * (1 + (1 - Math.min(1, k * 3)) * 0.35);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x, this.y);
    ctx.scale(s / 17, s / 17);
    ctx.font = '800 17px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = 'rgba(12,8,20,0.9)';
    ctx.strokeText(this.text, 0, 0);
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, 0, 0);
    ctx.restore();
  }
}

class Lightning {
  constructor(x1, y1, x2, y2, color, dur) {
    this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
    this.color = color;
    this.t = 0;
    this.dur = dur || 0.28;
    this.dead = false;
    this.segs = [];
    this.forks = [];
    this.regenerate();
  }
  regenerate() {
    this.segs = [];
    const n = 11;
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const px = lerp(this.x1, this.x2, k);
      const py = lerp(this.y1, this.y2, k);
      const amp = 18 * Math.sin(k * Math.PI) + 4;
      this.segs.push({ x: px + rand(-amp, amp), y: py + rand(-6, 6) });
    }
    this.forks = [];
    for (let f = 0; f < 2; f++) {
      const i0 = 2 + Math.floor(Math.random() * (n - 5));
      const base = this.segs[i0];
      const dir = Math.random() < 0.5 ? -1 : 1;
      const pts = [{ x: base.x, y: base.y }];
      let cx = base.x, cy = base.y;
      for (let k = 0; k < 3; k++) {
        cx += dir * rand(8, 22) + rand(-6, 6);
        cy += rand(6, 20);
        pts.push({ x: cx, y: cy });
      }
      this.forks.push(pts);
    }
  }
  update(dt) {
    this.t += dt;
    if (this.t > this.dur) this.dead = true;
    if (Math.random() < 0.6) this.regenerate();
  }
  draw(ctx) {
    const k = Math.max(0, 1 - this.t / this.dur);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(this.x1, this.y1);
      for (const s of this.segs) ctx.lineTo(s.x, s.y);
      ctx.lineTo(this.x2, this.y2);
    };
    // 外层辉光
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(this.color, k * 0.2);
    ctx.lineWidth = 16;
    path(); ctx.stroke();
    ctx.strokeStyle = rgba(this.color, k * 0.5);
    ctx.lineWidth = 7;
    path(); ctx.stroke();
    ctx.strokeStyle = rgba(this.color, k * 0.95);
    ctx.lineWidth = 3;
    path(); ctx.stroke();
    // 白核
    ctx.strokeStyle = 'rgba(255,255,255,' + (k * 0.95) + ')';
    ctx.lineWidth = 1.4;
    path(); ctx.stroke();
    // 分叉
    ctx.strokeStyle = rgba(this.color, k * 0.8);
    ctx.lineWidth = 1.6;
    for (const pts of this.forks) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    // 落点辉光
    glow(ctx, this.x2, this.y2, 52 * k, this.color, k * 0.6);
    ctx.restore();
  }
}

class Blast {
  constructor(x, y, r, color, dur) {
    this.x = x; this.y = y;
    this.r = r; this.color = color;
    this.t = 0;
    this.dur = dur || 0.5;
    this.dead = false;
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.dur) this.dead = true;
  }
  draw(ctx) {
    const k = this.t / this.dur;
    const rad = this.r * (0.2 + 0.8 * easeOutCubic(k));
    const a = (1 - k) * (1 - k);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, rad);
    g.addColorStop(0, 'rgba(255,255,255,' + (a * 0.55) + ')');
    g.addColorStop(0.22, rgba(shade(this.color, 1.2), a * 0.7));
    g.addColorStop(0.45, rgba(this.color, a * 0.5));
    g.addColorStop(0.7, rgba(this.color, a * 0.22));
    g.addColorStop(1, rgba(this.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, rad, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

class Afterimage {
  constructor(x, y, w, h, facing, color) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.facing = facing;
    this.color = color;
    this.t = 0; this.dur = 0.42;
    this.dead = false;
  }
  update(dt) {
    this.t += dt;
    if (this.t > this.dur) this.dead = true;
  }
  draw(ctx) {
    const k = 1 - this.t / this.dur;
    ctx.save();
    ctx.globalAlpha = k * 0.22;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(this.color, 0.55);
    rr(ctx, this.x, this.y, this.w, this.h, 10);
    ctx.fill();
    ctx.restore();
  }
}
