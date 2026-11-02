'use strict';

/* =========================================================
   全局配置 / 数据表
   ========================================================= */

const CONFIG = {
  W: 1280,
  H: 720,
  gravity: 2200,
  moveSpeed: 335,
  accel: 2600,
  airAccel: 1700,
  jumpV: -880,
  maxFall: 1500,
  invulnTime: 0.85,
  comboWindow: 1.6,
};

const WORLD = {
  width: 6400,
  height: 720,
  groundY: 560,
  levels: [430, 300, 175],
  bossGateX: 5520,
  bossSpawnX: 5960,
};

/* 三大区域：草原 → 洞窟 → 神殿 */
const REGIONS = [
  {
    key: 'valley',
    name: '枫叶草原',
    sub: '推荐 Lv.1',
    from: -4000,
    to: 2100,
    pal: {
      skyTop: [72, 140, 236], skyBot: [186, 220, 245],
      far: [126, 168, 210], mid: [78, 128, 142],
      grass: [124, 196, 104], grassDark: [72, 138, 76],
      dirt: [96, 70, 52], dirtDeep: [58, 42, 34],
      accent: [255, 226, 150], fog: [214, 236, 248],
    },
  },
  {
    key: 'cave',
    name: '幽雾洞窟',
    sub: '推荐 Lv.5',
    from: 2100,
    to: 4200,
    pal: {
      skyTop: [16, 16, 40], skyBot: [52, 42, 92],
      far: [40, 36, 76], mid: [28, 24, 58],
      grass: [86, 196, 200], grassDark: [40, 108, 122],
      dirt: [58, 52, 88], dirtDeep: [30, 26, 48],
      accent: [126, 226, 255], fog: [70, 120, 170],
    },
  },
  {
    key: 'temple',
    name: '星陨神殿',
    sub: '推荐 Lv.9',
    from: 4200,
    to: 99999,
    pal: {
      skyTop: [9, 7, 24], skyBot: [48, 26, 68],
      far: [32, 22, 54], mid: [22, 14, 40],
      grass: [148, 118, 208], grassDark: [84, 58, 138],
      dirt: [46, 36, 64], dirtDeep: [24, 18, 36],
      accent: [196, 158, 255], fog: [88, 54, 130],
    },
  },
];

/* ---------------------------------------------------------
   技能表
   --------------------------------------------------------- */
const SKILLS = [
  {
    id: 'bolt', name: '魔法弹', glyph: '✦', key: '1', keyCode: 'Digit1',
    mp: 6, cd: 0.30, power: 1.0, element: 'arcane', color: '#b28bff',
    desc: '凝聚奥术能量射出稳定的魔弹，无冷却，可长按连发。',
  },
  {
    id: 'fire', name: '火毒术', glyph: '❂', key: '2', keyCode: 'Digit2',
    mp: 16, cd: 1.25, power: 0.85, element: 'fire', color: '#ff8a3d',
    desc: '炎爆并附加灼烧，持续 3 秒。与冰霜叠加触发「蒸汽爆裂」。',
  },
  {
    id: 'ice', name: '冰霜箭', glyph: '❄', key: '3', keyCode: 'Digit3',
    mp: 14, cd: 1.25, power: 0.72, element: 'ice', color: '#7fd8ff',
    desc: '冰棱穿透并冻结目标。与雷霆叠加触发「霜雷爆」。',
  },
  {
    id: 'thunder', name: '雷电术', glyph: '⚡', key: '4', keyCode: 'Digit4',
    mp: 20, cd: 1.85, power: 1.5, element: 'lightning', color: '#ffe066',
    desc: '瞬发落雷，命中后向附近目标连锁跳跃，附加感电。',
  },
  {
    id: 'teleport', name: '瞬间移动', glyph: '✧', key: '5', keyCode: 'Digit5',
    mp: 12, cd: 2.0, power: 0, element: null, color: '#9ef0ff',
    desc: '向前闪现 240 像素，并获得 0.45 秒无敌。跨越地形与boss弹幕的保命技。',
  },
  {
    id: 'guard', name: '魔法盾', glyph: '◈', key: '6', keyCode: 'Digit6',
    mp: 30, cd: 17, power: 0, element: null, color: '#8fd4ff',
    desc: '15 秒内受到的 60% 伤害由法力承担，法师最关键的续航手段。',
  },
  {
    id: 'meditate', name: '冥想', glyph: '✷', key: '7', keyCode: 'Digit7',
    mp: 26, cd: 21, power: 0, element: null, color: '#c9a6ff',
    desc: '15 秒内魔法攻击 +45%，爆发期前置技能。',
  },
  {
    id: 'meteor', name: '陨石术', glyph: '☄', key: '8', keyCode: 'Digit8',
    mp: 60, cd: 12, power: 3.8, element: 'fire', color: '#ff7a45',
    desc: '召唤陨石轰击前方大范围，附加灼烧并造成强烈冲击。',
  },
  {
    id: 'heal', name: '圣光治愈', glyph: '✚', key: '9', keyCode: 'Digit9',
    mp: 45, cd: 13, power: 0, element: 'holy', color: '#b6ffc9',
    desc: '恢复 35% 生命值，净化灼烧/冻结/感电，并对周围造成圣光伤害。',
  },
];

/* ---------------------------------------------------------
   怪物
   --------------------------------------------------------- */
const MONSTERS = {
  slime: {
    name: '绿水灵', hp: 105, dmg: 9, exp: 18, speed: 54,
    w: 48, h: 40, color: [92, 214, 128], ai: 'walk', armor: 0, touch: 1,
  },
  mush: {
    name: '蘑菇仔', hp: 168, dmg: 13, exp: 28, speed: 82,
    w: 46, h: 48, color: [226, 118, 110], ai: 'hop', armor: 0, touch: 1,
  },
  bat: {
    name: '幽影蝠', hp: 128, dmg: 15, exp: 24, speed: 118,
    w: 46, h: 34, color: [156, 128, 224], ai: 'fly', armor: 0, touch: 1,
  },
  golem: {
    name: '岩石魔像', hp: 460, dmg: 24, exp: 68, speed: 40,
    w: 66, h: 78, color: [136, 130, 158], ai: 'walk', armor: 0.15, touch: 1,
  },
  wisp: {
    name: '幽光精', hp: 150, dmg: 17, exp: 34, speed: 92,
    w: 42, h: 42, color: [110, 220, 255], ai: 'fly', armor: 0, touch: 1, ranged: true,
  },
};

const BOSS_DEF = {
  name: '暗影魔君', hp: 8200, dmg: 32, exp: 1200,
  w: 132, h: 152, color: [120, 70, 180], armor: 0.1,
};

/* ---------------------------------------------------------
   元素反应表
   --------------------------------------------------------- */
const REACTIONS = {
  steam: { name: '蒸汽爆裂', color: [255, 214, 160], radius: 128, power: 0.95 },
  shatter: { name: '霜雷爆', color: [168, 234, 255], radius: 140, power: 1.05 },
  blaze: { name: '燎原', color: [255, 176, 102], radius: 168, power: 0.75 },
};

const ELEMENT_COLORS = {
  arcane: [178, 139, 255],
  fire: [255, 138, 61],
  ice: [127, 216, 255],
  lightning: [255, 224, 102],
  holy: [182, 255, 201],
  shadow: [190, 90, 220],
  none: [255, 255, 255],
};
