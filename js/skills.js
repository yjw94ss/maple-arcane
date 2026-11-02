'use strict';

/* =========================================================
   技能实现
   ========================================================= */

/** 陨石：延迟坠落 → 范围爆炸 */
class Meteor {
  constructor(x, dmg, g) {
    this.x = x;
    this.y = -160;
    this.targetY = WORLD.groundY - 20;
    this.dmg = dmg;
    this.g = g;
    this.t = 0;
    this.dur = 0.62;
    this.dead = false;
    this.impacted = false;
    this.trail = [];
  }
  update(dt) {
    this.t += dt;
    const k = clamp(this.t / this.dur, 0, 1);
    this.y = lerp(-160, this.targetY, easeInCubic(k));
    this.trail.push({ x: this.x + rand(-6, 6), y: this.y, r: rand(10, 20) });
    if (this.trail.length > 16) this.trail.shift();
    if (k >= 1 && !this.impacted) {
      this.impacted = true;
      this.dead = true;
      this.g.meteorImpact(this.x, this.dmg);
    }
  }
  draw(ctx, time) {
    // 预警圈
    const k = clamp(this.t / this.dur, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,140,80,' + (0.25 + k * 0.45) + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(this.x, WORLD.groundY - 6, 110 * (0.4 + k * 0.6), 26 * (0.4 + k * 0.6), 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 尾焰
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const a = (i / this.trail.length) * 0.5;
      glow(ctx, p.x, p.y, p.r * 2.2, [255, 140, 60], a * 0.6);
    }
    glow(ctx, this.x, this.y, 78, [255, 160, 90], 0.8);
    ctx.restore();

    // 陨石本体：不规则岩块（正圆 + 两个暗点会被读成一张脸）
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.t * 3.2);
    const g2 = ctx.createRadialGradient(-7, -8, 2, 0, 0, 27);
    g2.addColorStop(0, '#fff6d8');
    g2.addColorStop(0.32, '#ff9a52');
    g2.addColorStop(0.72, '#c4461a');
    g2.addColorStop(1, '#5e1a0a');
    ctx.fillStyle = g2;
    ctx.beginPath();
    const N = 11;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const rad = 23 * (0.84 + (((i * 37) % 7) / 6) * 0.26);
      const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // 暗色裂面
    ctx.fillStyle = 'rgba(58,16,8,0.48)';
    const cracks = [
      [[-13, -5], [-4, -11], [2, -3], [-6, 6]],
      [[10, 6], [17, 11], [8, 16]],
      [[6, -15], [15, -9], [9, -4]],
    ];
    for (const poly of cracks) {
      ctx.beginPath();
      poly.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

const SKILL_EXEC = {
  /* 魔法弹 */
  bolt(p, g, s) {
    const dmg = p.magicPower(s.power);
    g.spawnProjectile({
      x: p.cx + p.facing * 16, y: p.y + 24,
      vx: p.facing * 780, vy: 0,
      r: 7, dmg, element: 'arcane',
      color: [178, 139, 255], owner: 'player', life: 1.05, kind: 'orb',
    });
    g.burst(p.cx + p.facing * 20, p.y + 24, [178, 139, 255], 5, 150, 0.35);
    p.vx -= p.facing * 28;
    SFX.castBolt();
  },

  /* 火毒术 */
  fire(p, g, s) {
    const dmg = p.magicPower(s.power);
    g.spawnProjectile({
      x: p.cx + p.facing * 18, y: p.y + 26,
      vx: p.facing * 540, vy: -40,
      r: 11, dmg, element: 'fire',
      color: [255, 138, 61], owner: 'player', life: 1.5, kind: 'orb',
      gravity: 160,
    });
    g.burst(p.cx + p.facing * 22, p.y + 26, [255, 160, 70], 12, 200, 0.5);
    p.vx -= p.facing * 60;
    SFX.castFire();
  },

  /* 冰霜箭 */
  ice(p, g, s) {
    const dmg = p.magicPower(s.power);
    g.spawnProjectile({
      x: p.cx + p.facing * 18, y: p.y + 25,
      vx: p.facing * 900, vy: 0,
      r: 8, dmg, element: 'ice',
      color: [127, 216, 255], owner: 'player', life: 1.1, kind: 'shard',
      pierce: 2,
    });
    g.burst(p.cx + p.facing * 22, p.y + 25, [160, 230, 255], 10, 190, 0.45);
    SFX.castIce();
  },

  /* 雷电术 */
  thunder(p, g, s) {
    const dmg = p.magicPower(s.power);
    const all = g.monsters.concat(g.boss && !g.boss.dead ? [g.boss] : []);
    const cands = [];
    for (const m of all) {
      if (m.dead) continue;
      const dx = m.cx - p.cx;
      if (dx * p.facing < -60) continue;
      if (Math.abs(dx) > 540) continue;
      if (Math.abs(m.cy - p.cy) > 280) continue;
      cands.push({ m, d: Math.abs(dx) });
    }
    cands.sort((a, b) => a.d - b.d);
    const chain = cands.slice(0, 3);

    if (!chain.length) {
      const lx = p.cx + p.facing * 120;
      g.effects.push(new Lightning(lx, -60, lx, WORLD.groundY, [255, 224, 102], 0.22));
      g.burst(lx, WORLD.groundY - 20, [255, 224, 102], 10, 200, 0.45);
      SFX.castThunder();
      return;
    }

    let prev = { x: p.cx, y: p.y + 8 };
    chain.forEach((t, i) => {
      const m = t.m;
      g.effects.push(new Lightning(m.cx + rand(-16, 16), -60, m.cx, m.cy - 6, [255, 224, 102], 0.3));
      if (i > 0) {
        g.effects.push(new Lightning(prev.x, prev.y, m.cx, m.cy, [255, 245, 180], 0.22));
      }
      g.damageMonster(m, dmg * (1 - i * 0.16), 'lightning');
      g.ring(m.cx, m.cy, 52, [255, 224, 102], 0.3);
      g.burst(m.cx, m.cy, [255, 224, 102], 12, 250, 0.5);
      prev = { x: m.cx, y: m.cy };
    });
    g.shake(6);
    SFX.castThunder();
  },

  /* 瞬间移动 */
  teleport(p, g, s) {
    const dist = 240;
    let nx = p.x + p.facing * dist;
    nx = clamp(nx, 10, WORLD.width - p.w - 10);
    const targetCx = nx + p.w / 2;
    // 地面状态下，若落点是深坑则原地闪现（保命优先）
    if (p.onGround && !findGroundAt(targetCx)) {
      nx = p.x;
    }
    const fx = nx;
    if (Math.abs(fx - p.x) > 8) {
      for (let i = 0; i < 5; i++) {
        g.effects.push(new Afterimage(lerp(p.x, fx, i / 5), p.y, p.w, p.h, p.facing, [158, 240, 255]));
      }
    }
    g.burst(p.cx, p.cy, [158, 240, 255], 12, 200, 0.5);
    p.x = nx;
    p.invuln = Math.max(p.invuln, 0.45);
    p.vy = Math.min(p.vy, 0);
    p.tpFlash = 0.3;
    g.burst(p.cx, p.cy, [158, 240, 255], 16, 280, 0.6);
    g.ring(p.cx, p.cy, 66, [158, 240, 255], 0.35);
    g.shake(3);
    SFX.teleport();
  },

  /* 魔法盾 */
  guard(p, g, s) {
    p.buffs.guard = 15;
    g.ring(p.cx, p.cy, 92, [140, 210, 255], 0.5);
    g.burst(p.cx, p.cy, [140, 210, 255], 20, 190, 0.9);
    g.addFloatText(p.cx, p.y - 12, '魔法盾', [150, 215, 255]);
    SFX.buff();
    g.toast('魔法盾 · 15 秒内 60% 伤害转化为法力消耗', 'good');
  },

  /* 冥想 */
  meditate(p, g, s) {
    p.buffs.meditate = 15;
    g.ring(p.cx, p.cy, 76, [190, 150, 255], 0.5);
    g.burst(p.cx, p.cy, [200, 160, 255], 22, 160, 1.0);
    g.addFloatText(p.cx, p.y - 12, '冥想 +45%', [200, 165, 255]);
    SFX.buff();
    g.toast('冥想 · 魔法攻击 +45%', 'good');
  },

  /* 陨石术 */
  meteor(p, g, s) {
    const dmg = p.magicPower(s.power);
    const tx = clamp(p.cx + p.facing * 210, 60, WORLD.width - 60);
    g.effects.push(new Meteor(tx, dmg, g));
    g.shake(5);
    SFX.castMeteor();
  },

  /* 圣光治愈 */
  heal(p, g, s) {
    const amount = Math.round(p.maxHp * 0.35);
    p.hp = Math.min(p.maxHp, p.hp + amount);
    g.addFloatText(p.cx, p.y - 14, '+' + amount, [150, 255, 190], { size: 20 });
    g.ring(p.cx, p.cy, 140, [150, 255, 190], 0.6);
    g.burst(p.cx, p.cy - 10, [170, 255, 200], 26, 220, 1.0);
    g.aoe(p.cx, p.cy, 160, p.magicPower(0.9), 'holy');
    for (let i = 0; i < 8; i++) {
      g.effects.push(new FloatText(p.cx + rand(-50, 50), p.cy + rand(-20, 30), '✦', '#b6ffc9', { dur: 1, size: 14, vy: -60 }));
    }
    SFX.heal();
  },
};
