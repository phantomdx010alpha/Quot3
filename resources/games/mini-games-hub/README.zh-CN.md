# 小游戏厅 · Games Hall

> 一个页面里装 12 款浏览器小游戏：4096、贪吃蛇、俄罗斯方块、扫雷、打砖块、Flappy、记忆翻牌、打地鼠、数字华容道、星空战机、跑酷小恐龙、五子棋。不用安装、不用登录，最高分存在你自己的浏览器里。

[English](README.md) | **简体中文**

<a href="https://bushimashen.github.io/games/"><b>▶ 在线试玩</b></a>

## 12 款游戏

| 游戏 | 操作 |
|---|---|
| **4096** | 方向键 / WASD，手机可滑动；空格切换 AI 自动托管（1~10× 倍速），Backspace 撤销一步 |
| **贪吃蛇** | 方向键 / WASD 转向，空格暂停，R 重开 |
| **俄罗斯方块** | ←→ 移动、↑ 旋转、↓ 软降、空格硬降、C 暂存 |
| **扫雷** | 点击翻开，右键 / 插旗模式标记 |
| **打砖块** | 鼠标或 ←→ 移动挡板 |
| **Flappy 小鸟** | 空格 / 点击扇翅 |
| **记忆翻牌** | 翻对子，步数越少越好 |
| **打地鼠** | 在地鼠缩回去之前点它 |
| **数字华容道** | 点方块或用方向键 |
| **星空战机** | 方向键移动，空格开火 |
| **跑酷小恐龙** | 空格 / 点击起跳，↓ 下蹲 |
| **五子棋** | 点交叉点落子，U 悔棋 |

## 结构：12 款游戏，共 118KB JS

每款游戏都是一个**框架无关的 ES 模块**，只导出一个对象：

```js
export default {
  id: 'snake',
  name: '贪吃蛇',
  options: [{ key: 'size', label: '盘面', def: 4, values: [...] }],  // 可选
  runtime: [{ key: 'auto', label: '操作', def: 'off', values: [...] }], // 可选
  mount(container, api) { /* 往 container 里画 */ return { destroy() {}, setRuntime(k, v) {} } }
}
```

`api` 只有五个能力：`score(v)`、`over(v)`、`win(v)`、`status(text)`、`options`（实时 getter）、
`setRuntime(key, value)`。外壳只认这五件事——所以「加一款游戏 = 写一个文件 + 在注册表加一行」，
大厅代码一行都不用动。

共用绘制工具（`setupCanvas`、`onKey`、`onSwipe`、`roundRect`、`centerText` 等）在 `games/canvasKit.js`。
**大多数游戏画在 `<canvas>` 上，有两款不是**：扫雷和记忆翻牌直接拼 DOM —— 一格格按钮等于白送命中判定、
键盘焦点与可访问性，用 canvas 反而要自己重写这些。

## 为什么没有「风之剑修」

站内大厅里还有一款 **风之剑修**（水墨仙侠肉鸽，29MB，自带全屏页面与联机房间）。它不是 `mount()` 模块，
注册表里那一条是纯 `href` 链接，所以外壳会把没有 `load()` 的条目过滤掉。
把它搬进来意味着往这个仓库塞 456 个文件、29MB 素材，就为了一个本来就有独立项目的游戏，不划算。

## 最高分

按游戏分别存在 `localStorage` 的 `games-hall:best:<id>` 下。标了 `bestLower: true` 的计时制游戏
（扫雷、记忆翻牌）**只在赢的时候**记成绩，且越小越好。没有服务端，所以成绩不跨设备同步，清站点数据就清零。

## 怎么用

大厅用了 ES 模块，请起本地服务而不是双击：

```bash
python -m http.server 8000    # 然后打开 http://localhost:8000
```

支持深链：`?g=snake` 直接进贪吃蛇。

## 许可

MIT —— 见 [LICENSE](LICENSE)。游戏均为原创实现，未打包任何第三方游戏代码。
