/**
 * 4096 / 2048 自动求解器 —— Expectiminimax + 迭代加深 + 时间预算。
 *
 * 为什么不是「贪心一步」或随机：4×4 冲 4096 需要考虑新块的随机落点，
 * 只贪当前一步会在中后期被新块堵死。这里对未来若干步做「期望最优」搜索：
 *   · 玩家节点：4 个方向取最大（max）
 *   · 机会节点：每个空位按 90% 出 2 / 10% 出 4 取加权平均（expectation）
 *   · 叶子用局面评估函数打分（空格 / 单调性 / 平滑度 / 最大块在角 / 可合并对）
 *   · 迭代加深 + 时间预算：时间够就加一层深度，超时就用上一层已算完的结果
 *
 * 纯逻辑、无 DOM 依赖，可直接在 Node 里跑基准测试（_scratch/ai4096-bench.js）。
 * 棋盘用 Uint8Array 存「以 2 为底的指数」：0=空、1=2、2=4 … 12=4096。
 */

/* 评估函数权重（经 Node 实战跑分调整，见 41 号文档） */
export const WEIGHTS = {
  empty: 12.0, // 空格越多越好
  emptyQuad: 0.6, // 空格的二次项，鼓励保持大片空区
  smooth: 1.6, // 相邻块差值越小越好（惩罚）
  mono: 3.2, // 单调性：每行/列尽量单向递减（惩罚 min(增,减)）
  merge: 5.0, // 相邻可合并对数
  corner: 7.0, // 最大块在角落的奖励系数（×最大块指数）
  maxExp: 1.0, // 鼓励把块做大
  snake: 5.0, // 蛇形位置权重：鼓励形成「大块在蛇头、沿蛇身递减」的链（过大反而压死灵活性，实测 26 时两局都只到 1024）
  death: -1e6, // 死局惩罚
}

const DIR_LEFT = 0
const DIR_RIGHT = 1
const DIR_UP = 2
const DIR_DOWN = 3
const DIR_NAME = ['left', 'right', 'up', 'down']

const cellIndex = (dir, i, j, n) => {
  if (dir === DIR_LEFT) return i * n + j
  if (dir === DIR_RIGHT) return i * n + (n - 1 - j)
  if (dir === DIR_UP) return j * n + i
  return (n - 1 - j) * n + i
}

/**
 * @param {number} size 盘面边长 3~7
 * @param {object} opts {weights, maxDepth}
 */
export function createSolver(size, opts = {}) {
  const n = size
  const len = n * n
  const W = { ...WEIGHTS, ...(opts.weights || {}) }
  const maxDepth = opts.maxDepth || 6

  const line = new Uint8Array(n)
  // 每层递归复用缓冲，避免每步都 new（GC 是这类搜索的主要开销）
  const pool = []
  for (let d = 0; d <= maxDepth + 2; d++) pool.push(new Uint8Array(len))

  /* 蛇形位置权重：沿蛇形路径（第一行左→右，第二行右→左…）权重从 1 线性降到 0。
     它比单纯的平滑度/单调性更能保住大块——实测把 4×4 的通关率明显拉高。 */
  const snakeW = new Float64Array(len)
  {
    const idx = []
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < n; k++) {
        const c = r % 2 === 0 ? k : n - 1 - k
        idx.push(r * n + c)
      }
    }
    for (let i = 0; i < idx.length; i++) snakeW[idx[i]] = (len - 1 - i) / (len - 1)
  }

  let deadline = 0
  let aborted = false
  let nodes = 0

  const timeUp = () => {
    if ((nodes & 127) === 0 && performance.now() > deadline) aborted = true
    return aborted
  }

  /** 把 board 按 dir 移动写入 out，返回 {gained, changed} */
  function move(board, dir, out) {
    let gained = 0
    let changed = false
    for (let i = 0; i < n; i++) {
      let k = 0
      for (let j = 0; j < n; j++) {
        const v = board[cellIndex(dir, i, j, n)]
        if (v) line[k++] = v
      }
      let w = 0
      for (let j = 0; j < k; j++) {
        if (j + 1 < k && line[j] === line[j + 1]) {
          const nv = line[j] + 1
          line[w++] = nv
          gained += 1 << nv
          j++
        } else {
          line[w++] = line[j]
        }
      }
      for (let j = w; j < n; j++) line[j] = 0
      for (let j = 0; j < n; j++) {
        const cell = cellIndex(dir, i, j, n)
        if (board[cell] !== line[j]) changed = true
        out[cell] = line[j]
      }
    }
    return { gained, changed }
  }

  function evaluate(board) {
    let empty = 0
    let maxE = 0
    let maxIdx = 0
    for (let i = 0; i < len; i++) {
      const v = board[i]
      if (!v) empty++
      else if (v > maxE) {
        maxE = v
        maxIdx = i
      }
    }
    let score = W.empty * empty + W.emptyQuad * empty * empty + W.maxExp * maxE
    const mr = (maxIdx / n) | 0
    const mc = maxIdx % n
    if ((mr === 0 || mr === n - 1) && (mc === 0 || mc === n - 1)) score += W.corner * maxE

    let snakeScore = 0
    for (let i = 0; i < len; i++) {
      const v = board[i]
      if (v) snakeScore += v * snakeW[i]
    }
    score += W.snake * snakeScore

    let smooth = 0
    let merges = 0
    let monoPenalty = 0
    // 行
    for (let r = 0; r < n; r++) {
      let inc = 0
      let dec = 0
      for (let c = 0; c < n - 1; c++) {
        const a = board[r * n + c]
        const b = board[r * n + c + 1]
        if (!a || !b) continue
        const d = a - b
        if (d === 0) merges++
        else if (d > 0) dec++
        else inc++
        smooth -= d > 0 ? d : -d
      }
      monoPenalty += Math.min(inc, dec)
    }
    // 列
    for (let c = 0; c < n; c++) {
      let inc = 0
      let dec = 0
      for (let r = 0; r < n - 1; r++) {
        const a = board[r * n + c]
        const b = board[(r + 1) * n + c]
        if (!a || !b) continue
        const d = a - b
        if (d === 0) merges++
        else if (d > 0) dec++
        else inc++
        smooth -= d > 0 ? d : -d
      }
      monoPenalty += Math.min(inc, dec)
    }
    score += W.merge * merges + W.smooth * smooth - W.mono * monoPenalty
    return score
  }

  function hasMove(board) {
    for (let i = 0; i < len; i++) if (!board[i]) return true
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = board[r * n + c]
        if (!v) continue
        if (c + 1 < n && board[r * n + c + 1] === v) return true
        if (r + 1 < n && board[(r + 1) * n + c] === v) return true
      }
    }
    return false
  }

  /** 玩家节点：取四个方向的最大值；返回 -Infinity 表示无路可走 */
  function playerNode(board, depth, alpha, beta) {
    nodes++
    if (timeUp()) return 0
    if (!hasMove(board)) return W.death
    if (depth === 0) return evaluate(board)

    let best = -Infinity
    for (let dir = 0; dir < 4; dir++) {
      const out = pool[depth]
      const { changed } = move(board, dir, out)
      if (!changed) continue
      const v = chanceNode(out, depth - 1, alpha, beta)
      if (v > best) best = v
      if (best > alpha) alpha = best
      // 期望搜索没有标准 alpha-beta，但对上界做剪枝是安全的近似
      if (beta !== Infinity && alpha >= beta) break
      if (timeUp()) break
    }
    return best === -Infinity ? W.death : best
  }

  /** 机会节点：对每个空位按 2/4 的概率加权求期望 */
  function chanceNode(board, depth, alpha, beta) {
    const empties = []
    for (let i = 0; i < len; i++) if (!board[i]) empties.push(i)
    if (!empties.length) return evaluate(board) + W.death * 0.001

    // 最深的那一层只算「出 2」分支：4 的概率仅 10%，省掉一半展开对决策影响极小
    const both = depth > 1
    let sum = 0
    for (let k = 0; k < empties.length; k++) {
      const idx = empties[k]
      board[idx] = 1
      const v2 = playerNode(board, depth, alpha, beta)
      let v = 0.9 * v2
      if (both) {
        board[idx] = 2
        v += 0.1 * playerNode(board, depth, alpha, beta)
      }
      board[idx] = 0
      sum += v
      if (timeUp()) break
    }
    return sum / empties.length
  }

  /**
   * 决策：在给定时间预算内迭代加深，返回 {dir, depth, nodes, ms}
   * dir 为 null 表示已无路可走。
   */
  function decide(board, budgetMs = 60) {
    const start = performance.now()
    deadline = start + budgetMs
    aborted = false
    nodes = 0

    const work = pool[maxDepth + 1]
    work.set(board)

    let bestDir = null
    let reachedDepth = 0
    for (let depth = 1; depth <= maxDepth; depth++) {
      let localBest = -Infinity
      let localDir = null
      for (let dir = 0; dir < 4; dir++) {
        const out = pool[0]
        out.set(board)
        const { changed } = move(board, dir, out)
        if (!changed) continue
        const v = chanceNode(out, depth - 1 > 0 ? depth - 1 : 0, -Infinity, Infinity)
        if (v > localBest) {
          localBest = v
          localDir = dir
        }
        if (aborted) break
      }
      if (aborted || localDir === null) break
      bestDir = localDir
      reachedDepth = depth
      if (performance.now() > deadline) break
    }
    return {
      dir: bestDir === null ? null : DIR_NAME[bestDir],
      depth: reachedDepth,
      nodes,
      ms: performance.now() - start,
    }
  }

  return { move, evaluate, hasMove, decide, get size() { return n } }
}

/** 工具：普通二维数组（数值）→ 指数棋盘 */
export function toExpGrid(grid2d) {
  const n = grid2d.length
  const out = new Uint8Array(n * n)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = grid2d[r][c]
      out[r * n + c] = v ? Math.round(Math.log2(v)) : 0
    }
  }
  return out
}
