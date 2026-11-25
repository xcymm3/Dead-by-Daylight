// Each row runs west to east. L = lamp, P = pallet, W = window, # = wall.
function board(...rows) {
  const types = { '.': 'empty', L: 'machine', P: 'pallet', W: 'window', '#': 'wall' }
  const tiles = [...rows.join('')].map(symbol => types[symbol])
  const cells = tiles.map((_, index) => index + 5)
  const matching = type => cells.filter(at => tiles[at - 5] === type)
  return {
    tiles, machines: matching('machine'), pallets: matching('pallet'),
    walls: matching('wall'), window: matching('window')[0], spawns: matching('empty'),
    playable: cells.filter(at => !['wall', 'window'].includes(tiles[at - 5])),
  }
}

export const STANDARD_BOARD = board('L.P.L', '..#..', '..W..', '..#..', 'L.P.L')

// Patrol is the chance of using the optional second step on a routine patrol.
// Tracking is the share of rounds spent intercepting with the hard killer AI.
export const CAMPAIGN = [
  { name: '西门灯廊', hint: '西侧三盏灯排成一线，点灯后就近从西门撤离。', patrol: 0,
    board: board('L.P..', 'L....', '.....', 'L.W..', '..P.L') },
  { name: '双灯小径', hint: '西北两盏灯离得很近，南侧两盏任选其一。', patrol: .15,
    board: board('L.P..', '.L...', '...W.', 'L.#.L', '..P..') },
  { name: '雨棚走道', hint: '中排的窗可以横向翻越，方便在两侧灯位之间转移。', patrol: .5, tracking: .05,
    board: board('..P.L', 'L.#..', '..W..', '.L..L', '..P..') },
  { name: '折角仓库', hint: '东侧两盏灯隔着转角，先看屠夫的位置再决定绕哪边。', patrol: .65, tracking: .12,
    board: board('L..L.', '.#...', '..W..', 'L..#L', '..P..') },
  { name: '错位回廊', hint: '南北灯位错开，木板只在北侧。', patrol: .85, tracking: .4,
    board: board('L.P..', '..#.L', '.W...', 'L..#.', '....L') },
  { name: '南墙哨所', hint: '屠夫会用足两步巡逻。南侧的墙把两盏灯隔开，留好翻窗转向的空间。', patrol: 1, tracking: .65,
    board: board('..P.L', 'L.#..', '..W..', '.#...', 'L.#.L') },
  { name: '经典庭院', hint: '四角各有一盏灯。利用中央的窗和南北两块木板，避开屠夫的拦截。', tracking: .8, board: STANDARD_BOARD },
  { name: '断桥灯场', hint: '只剩南侧一块木板，北侧两盏灯之间要绕过断墙。', tracking: .95,
    board: board('L.#.L', '..#..', '..W..', '.#...', 'L.P.L') },
  { name: '北塔夹道', hint: '场内没有木板。北窗两侧可以快速转移，南侧的灯只能绕墙接近。', tracking: 1,
    board: board('L.#.L', '..W..', '..#..', '.#...', 'L..#L') },
  { name: '封锁庭院', hint: '南侧的通道被封死，东西两区仅靠北窗相通。点第三盏灯前先选好撤离方向。', tracking: 1,
    board: board('L.#.L', '..W..', '..#..', '.#.#.', 'L#..L') },
]

export function boardFor(level) {
  return level ? CAMPAIGN[level - 1]?.board ?? STANDARD_BOARD : STANDARD_BOARD
}
