export const SKILL_MODES = [[0, '无技能'], [2, '2 技能'], [3, '3 技能']]

export const SKILLS = {
  human: {
    strong: { name: '强壮', ai: true, description: '板砸眩晕由 3 回合增至 5 回合，被屠夫命中或被狙杀扣血时，屠夫额外跳过 1 回合。' },
    healing: { name: '治疗', description: '受伤时每次行动增加 1 治疗进度，原地等待增加 2，满 8 恢复 1 生命。' },
    escape: { name: '逃生', ai: true, description: '首次点亮第三盏灯时，若受伤则立即恢复健康。' },
    focus: { name: '专注', ai: true, description: '点灯后保护至下次人类回合开始，屠夫的命中无效且不会收到提示。' },
    trap: { name: '陷阱', uses: 2, description: '在原地布置陷阱，持续至下次人类回合开始。屠夫踩中跳过 2 回合，无需消耗移动。' },
    flare: { name: '信号枪', uses: 1, description: '选定方向并结束回合。下次人类回合开始时向前开枪，覆盖正前方 3 格及第 2、3 格两侧，命中使屠夫跳过 3 回合。' },
    blink: { name: '闪现', ai: true, uses: 1, description: '向指定方向闪现两格，落点须可通行，无需消耗移动。' },
    stealth: { name: '隐秘', ai: true, uses: 1, description: '从发动的本轮算起，连续 3 轮向屠夫隐藏亮灯数量及人类生命。' },
  },
  killer: {
    snipe: { name: '狙杀', ai: true, description: '屠夫回合开始时，人类健康则狙杀进度加 1。满 5 时人类失去 1 生命，屠夫从本回合起跳过 2 回合，遇到强壮则跳过 3 回合。人类受伤时重置进度。' },
    lockdown: { name: '封锁', ai: true, description: '翻越过的窗户永久封闭，破板少跳过 1 回合。' },
    frenzy: { name: '狂暴', ai: true, description: '亮灯达到 3 盏时可多移动 1 次，命中人类后不再跳过回合。' },
    sabotage: { name: '破坏', uses: 2, description: '经过已点亮的灯时自动破坏，最多 2 次。本局隐藏亮灯数量。' },
    watch: { name: '监视', ai: true, uses: 1, description: '移动前在原地放置并结束回合。下次屠夫回合起，人类在监视者所在格或周围八格时显示红色，否则显示绿色。' },
    track: { name: '跟踪', uses: 1, description: '移动前在原地放置并结束回合。下次屠夫回合起可操控跟踪者，每回合走 4 步，触碰人类后使其跳过 2 回合并暴露位置。' },
    blink: { name: '闪现', ai: true, uses: 1, description: '向指定方向闪现两格，落点须可通行，无需消耗移动。' },
    slash: { name: '挥刀', uses: Infinity, description: '移动后可沿指定方向挥刀一次，覆盖前方一格及其两侧。命中等同于碰到人类，挥空则跳过 1 回合。' },
  },
}

export const DIRECTIONS = { north: '北', east: '东', south: '南', west: '西' }

export function skillIds(role, solo = false) {
  return Object.entries(SKILLS[role] ?? {}).filter(([, skill]) => !solo || skill.ai).map(([id]) => id)
}

export function validSkillSelection(role, count, ids, solo = false) {
  const available = skillIds(role, solo)
  return Object.hasOwn(SKILLS, role) && SKILL_MODES.some(([size]) => size === count) && Array.isArray(ids) && ids.length <= count &&
    new Set(ids).size === ids.length && ids.every(id => available.includes(id))
}

export function validLoadout(role, count, ids, solo = false) {
  return validSkillSelection(role, count, ids, solo) && ids.length === count
}

export function makeLoadouts(selected) {
  return Object.fromEntries(Object.entries(SKILLS).map(([role, skills]) => [role,
    Object.fromEntries((selected[role] ?? []).map(id => [id,
      Number.isFinite(skills[id].uses) ? skills[id].uses : null]))]))
}

export function hasSkill(game, role, id) {
  return Object.hasOwn(game.skills?.[role] ?? {}, id)
}

export function canUse(game, role, id) {
  return game.skills?.[role]?.[id] > 0
}
