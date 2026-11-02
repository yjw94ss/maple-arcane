'use strict';

/* =========================================================
   DOM UI
   ========================================================= */
const UI = {
  slots: {},
  last: {},
  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;

    this.el = {
      hud: document.getElementById('hud'),
      hpFill: document.getElementById('hpFill'),
      hpGhost: document.getElementById('hpGhost'),
      hpText: document.getElementById('hpText'),
      mpFill: document.getElementById('mpFill'),
      mpText: document.getElementById('mpText'),
      expFill: document.getElementById('expFill'),
      expText: document.getElementById('expText'),
      levelBadge: document.getElementById('levelBadge'),
      comboBox: document.getElementById('comboBox'),
      comboNum: document.getElementById('comboNum'),
      comboMult: document.getElementById('comboMult'),
      comboBar: document.getElementById('comboBar'),
      bossPanel: document.getElementById('bossPanel'),
      bossName: document.getElementById('bossName'),
      bossFill: document.getElementById('bossFill'),
      bossHpText: document.getElementById('bossHpText'),
      regionName: document.getElementById('regionName'),
      regionSub: document.getElementById('regionSub'),
      regionBanner: document.getElementById('regionBanner'),
      levelBanner: document.getElementById('levelBanner'),
      levelBannerNum: document.getElementById('levelBannerNum'),
      toasts: document.getElementById('toasts'),
      hint: document.getElementById('hint'),
      skillbar: document.getElementById('skillbar'),
    };

    this.buildSkillbar();
    this.buildHelp();
  },

  buildSkillbar() {
    // 触摸设备把技能槽建到固定层（#touchSkills）里，这样不跟着 #stage 一起被缩小
    const touch = document.body.classList.contains('is-touch');
    const bar = touch ? document.getElementById('touchSkills') : this.el.skillbar;
    if (!bar) return;
    bar.innerHTML = '';

    // 触摸端按“右手拇指够得到的距离”排序，而不是按键盘 1-9 的编号。
    // 数组是从右往左的优先级：最常用的魔法弹贴右手，长冷却的陨石/治愈放最左。
    const TOUCH_ORDER = ['bolt', 'fire', 'ice', 'thunder', 'teleport', 'guard', 'meditate', 'meteor', 'heal'];
    let list = SKILLS;
    if (touch) {
      list = TOUCH_ORDER.slice().reverse()
        .map((id) => SKILLS.find((s) => s.id === id))
        .filter(Boolean);
    }

    list.forEach((s) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (touch ? ' touch' : '');
      slot.style.setProperty('--c', s.color);
      slot.dataset.skill = s.id;
      slot.innerHTML =
        '<div class="glyph">' + s.glyph + '</div>' +
        '<div class="key">' + s.key + '</div>' +
        '<div class="cost">' + s.mp + '</div>' +
        '<div class="cdawn"></div>' +
        '<div class="cdtext"></div>' +
        '<div class="tip"><h5>' + s.name + '<i>' + s.mp + ' MP · ' + (s.cd > 0 ? s.cd + 's CD' : '无 CD') + '</i></h5>' +
        '<p>' + s.desc + '</p></div>';

      // 用 pointerdown 而不是 click：触屏没有 300ms 延迟，且能支持“按住连发”
      slot.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        if (GAME.state !== 'playing' || !GAME.player) return;
        if (slot.setPointerCapture) {
          try { slot.setPointerCapture(ev.pointerId); } catch (err) { /* 忽略 */ }
        }
        GAME.player.tryCast(s, GAME);
        // 按住 = 持续施法（复用键盘长按的自动施法逻辑）
        GAME.keys.add(s.keyCode);
        const release = () => {
          GAME.keys.delete(s.keyCode);
          slot.removeEventListener('pointerup', release);
          slot.removeEventListener('pointercancel', release);
        };
        slot.addEventListener('pointerup', release);
        slot.addEventListener('pointercancel', release);
      });

      bar.appendChild(slot);
      this.slots[s.id] = {
        root: slot,
        cd: slot.querySelector('.cdawn'),
        cdText: slot.querySelector('.cdtext'),
        p: -1,
        wasCooling: false,
      };
    });
  },

  buildHelp() {
    const box = document.getElementById('helpSkills');
    if (!box) return;
    box.innerHTML = SKILLS.map((s) =>
      '<div class="help-skill" style="--c:' + s.color + '">' +
      '<span class="hs-key">' + s.key + '</span>' +
      '<span class="hs-body"><b>' + s.name + '</b><span>' + s.desc + '</span></span>' +
      '</div>'
    ).join('');
  },

  update(g) {
    const p = g.player;
    if (!p) return;
    const e = this.el;

    // HP / MP
    const hpP = clamp(p.hp / p.maxHp, 0, 1);
    const mpP = clamp(p.mp / p.maxMp, 0, 1);
    e.hpFill.style.width = (hpP * 100).toFixed(1) + '%';
    e.hpGhost.style.width = (hpP * 100).toFixed(1) + '%';
    e.mpFill.style.width = (mpP * 100).toFixed(1) + '%';
    const hpStr = Math.ceil(p.hp) + '/' + p.maxHp;
    if (this.last.hp !== hpStr) { e.hpText.textContent = hpStr; this.last.hp = hpStr; }
    const mpStr = Math.floor(p.mp) + '/' + p.maxMp;
    if (this.last.mp !== mpStr) { e.mpText.textContent = mpStr; this.last.mp = mpStr; }

    // EXP
    const expP = clamp(p.exp / p.expNext, 0, 1);
    e.expFill.style.width = (expP * 100).toFixed(2) + '%';
    const expStr = 'Lv.' + p.level + '　EXP ' + Math.floor(p.exp) + ' / ' + p.expNext;
    if (this.last.exp !== expStr) { e.expText.textContent = expStr; this.last.exp = expStr; }
    if (this.last.level !== p.level) {
      e.levelBadge.textContent = p.level;
      this.last.level = p.level;
    }

    // 技能冷却
    for (const s of SKILLS) {
      const slot = this.slots[s.id];
      if (!slot) continue;
      const cd = p.cds[s.id];
      const cooling = cd > 0.02;
      if (cooling !== slot.wasCooling) {
        slot.root.classList.toggle('cooling', cooling);
        if (!cooling) {
          slot.root.classList.remove('ready-pulse');
          void slot.root.offsetWidth;
          slot.root.classList.add('ready-pulse');
        }
        slot.wasCooling = cooling;
      }
      if (cooling) {
        const pct = Math.round((cd / s.cd) * 100);
        if (Math.abs(pct - slot.p) > 1) {
          slot.cd.style.setProperty('--p', pct);
          slot.p = pct;
        }
        const txt = cd > 0.75 ? Math.ceil(cd) + '' : '';
        if (slot.cdText.textContent !== txt) slot.cdText.textContent = txt;
      } else if (slot.cdText.textContent !== '') {
        slot.cdText.textContent = '';
        slot.cd.style.setProperty('--p', 0);
        slot.p = -1;
      }
      // 蓝量不足
      const noMp = p.mp < s.mp;
      slot.root.style.opacity = noMp && !cooling ? 0.55 : 1;
    }

    // 连携
    if (g.combo.n >= 2) {
      if (this.last.comboHidden !== false) {
        e.comboBox.classList.remove('hidden');
        this.last.comboHidden = false;
      }
      if (this.last.comboN !== g.combo.n) {
        e.comboNum.textContent = g.combo.n;
        this.last.comboN = g.combo.n;
        e.comboBox.style.animation = 'none';
        void e.comboBox.offsetWidth;
        e.comboBox.style.animation = 'comboPop .18s ease-out';
      }
      const m = g.combo.mult.toFixed(2);
      if (this.last.mult !== m) { e.comboMult.textContent = 'x' + m; this.last.mult = m; }
      e.comboBar.style.width = clamp(g.combo.t / CONFIG.comboWindow, 0, 1) * 100 + '%';
    } else {
      if (this.last.comboHidden !== true) {
        e.comboBox.classList.add('hidden');
        this.last.comboHidden = true;
        e.comboNum.textContent = '0';
        this.last.comboN = -1;
      }
    }

    // Boss
    if (g.boss && !g.boss.dead) {
      if (this.last.bossShown !== true) {
        e.bossPanel.classList.remove('hidden');
        e.bossName.textContent = g.boss.def.name;
        this.last.bossShown = true;
      }
      const pct = clamp(g.boss.hp / g.boss.maxHp, 0, 1);
      e.bossFill.style.width = (pct * 100).toFixed(1) + '%';
      const t = Math.max(0, Math.ceil(g.boss.hp)) + ' / ' + g.boss.maxHp;
      if (this.last.bossHp !== t) { e.bossHpText.textContent = t; this.last.bossHp = t; }
    } else if (this.last.bossShown !== false) {
      e.bossPanel.classList.add('hidden');
      this.last.bossShown = false;
    }

    // 区域名
    const r = REGIONS[g.regionIndex];
    if (r && this.last.region !== r.key) {
      e.regionName.textContent = r.name;
      e.regionSub.textContent = r.sub;
      this.last.region = r.key;
    }
  },

  toast(msg, type) {
    const box = this.el.toasts || document.getElementById('toasts');
    // 统一类型名：'warning' → 'warn'
    const cls = type === 'warning' ? 'warn' : type;
    // 同一条提示不重复堆叠
    for (const old of box.children) {
      if (old.textContent === msg) old.remove();
    }
    const d = document.createElement('div');
    d.className = 'toast' + (cls ? ' ' + cls : '');
    d.textContent = msg;
    box.appendChild(d);
    // 最多同时显示 2 条，多余的立刻移除（避免连招/反应提示堆成一片遮住战斗）
    while (box.children.length > 2) box.firstElementChild.remove();
    setTimeout(() => d.remove(), 2000);
  },

  showRegion(name) {
    const b = this.el.regionBanner || document.getElementById('regionBanner');
    b.textContent = name;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  },

  showLevelUp(level) {
    const b = this.el.levelBanner || document.getElementById('levelBanner');
    const n = document.getElementById('levelBannerNum');
    n.textContent = level;
    b.classList.remove('hidden');
    n.style.animation = 'none';
    void n.offsetWidth;
    n.style.animation = '';
    clearTimeout(this._lvlTimer);
    this._lvlTimer = setTimeout(() => b.classList.add('hidden'), 1700);
  },

  reset() {
    this.last = {};
    this.el && this.el.comboBox.classList.add('hidden');
    this.el && this.el.bossPanel.classList.add('hidden');
    if (this.el) {
      this.el.hpText.textContent = '';
      this.el.mpText.textContent = '';
      this.el.expText.textContent = '';
    }
  },
};
