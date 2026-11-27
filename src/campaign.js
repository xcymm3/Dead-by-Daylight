import { HUMAN } from './game.js'
import { CAMPAIGN } from './maps.js'
import { createPracticeGame } from './opponent.js'

const PROGRESS_KEY = 'grid-operations:campaign-cleared-v1'

export function createCampaignGame(level, seed, skills = []) {
  const stage = CAMPAIGN[level - 1]
  if (!Number.isInteger(level) || !stage) throw new RangeError('无效的战役关卡')
  const difficulty = stage.tracking ? 'hard' : 'normal'
  return { ...createPracticeGame(HUMAN, skills.length, skills, difficulty, seed), campaignLevel: level }
}

export function loadCampaignProgress(storage) {
  try {
    const value = Number((storage ?? globalThis.localStorage).getItem(PROGRESS_KEY))
    return Number.isInteger(value) && value >= 0 && value <= CAMPAIGN.length ? value : 0
  } catch {
    return 0
  }
}

export function completeCampaignLevel(cleared, game, storage) {
  if (game.winner !== HUMAN || game.campaignLevel !== cleared + 1 || cleared >= CAMPAIGN.length) return cleared
  const next = Math.max(game.campaignLevel, loadCampaignProgress(storage))
  try {
    (storage ?? globalThis.localStorage).setItem(PROGRESS_KEY, String(next))
  } catch {
    // The level remains unlocked in this session if storage is unavailable.
  }
  return next
}
