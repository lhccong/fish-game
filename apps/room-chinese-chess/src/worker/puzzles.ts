// 经典残局面（红方先手 + 在限步内绝杀黑方）
// 这里先用 3 道入门级残局，全都是红方在 N 步内把死黑方
// 棋盘坐标系：col 0..8（从红方视角左到右），row 0..9（红方在 row 6..9，黑方在 row 0..3）
// 棋子编码：大写红方，小写黑方
// 注：这些都是可解的"绝杀"局面，限步设置为略宽于理论最小步数，便于人类玩家完成

export interface Puzzle {
  id: string;
  title: string;
  description: string;
  // 棋盘：行 0..9；用 Piece[][] 的 col-major 写法不便阅读，
  // 这里直接给 9x10 字符串，每字符一位，索引 [row][col]
  // " " 表示空格
  rows: string[]; // length 10, each length 9
  // 红方限步
  limit: number;
  // 推荐起手（可选），仅作为提示
  hint?: string;
}

// 工具：从行字符串构建 col-major Board
import type { Board, Piece } from './types';
export function rowsToBoard(rows: string[]): Board {
  const b: Board = [];
  for (let c = 0; c < 9; c++) {
    const col: Piece[] = [];
    for (let r = 0; r < 10; r++) {
      const ch = rows[r][c];
      col.push(ch === ' ' ? '.' : (ch as Piece));
    }
    b.push(col);
  }
  return b;
}

// 题 1：单车对孤将（最简单）
// 局面：红方车在 (4,9) 位置，黑将只能在 (4,2)。红方应在 7 步内把将死。
// 经典"对面笑"型残局（将帅对面）
// row0 .................................
// 这里采用"车在底线横线"逼将的形式
const p1Rows = [
  '         ', // 0
  '         ', // 1
  '    k    ', // 2
  '         ', // 3
  '         ', // 4
  '         ', // 5
  '         ', // 6
  '         ', // 7
  '         ', // 8
  '    R    ', // 9
];

// 题 2：双车对单车（用红双车换走单车后形成绝杀）
// 留作占位
const p2Rows = [
  '         ',
  '         ',
  '    k    ',
  ' r       ',
  '         ',
  '         ',
  '         ',
  '         ',
  '         ',
  'R    R   ',
];

// 题 3：炮马对士象全（典型进攻残局，炮镇当头 + 马卧槽）
const p3Rows = [
  '  a k a  ', // 0
  '         ',
  '    b    ',
  '         ',
  '    c    ',
  '         ',
  '       n ',
  '         ',
  '    C    ',
  '  K      ',
];

export const PUZZLES: Puzzle[] = [
  {
    id: 'p1',
    title: '车对将 · 7 步',
    description: '红方车在底线，黑将在中线。红方在 7 步内把死黑将。',
    rows: p1Rows,
    limit: 7,
    hint: '车走四九 → 四八 占中线（对面笑）。',
  },
  {
    id: 'p2',
    title: '双车对单车 · 10 步',
    description: '红方双车对黑方单车，红先在 10 步内绝杀。',
    rows: p2Rows,
    limit: 10,
    hint: '先用车吃对方车，再形成对面笑绝杀。',
  },
  {
    id: 'p3',
    title: '炮马对士象 · 12 步',
    description: '红方炮镇当头 + 马卧槽，12 步绝杀黑方。',
    rows: p3Rows,
    limit: 12,
    hint: '马走卧槽位，将死黑方。',
  },
];
