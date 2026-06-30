/**
 * 矢印方向の共通定義
 *
 * 角度定義（要件通り）:
 *   →  = 0°
 *   ↘  = 45°
 *   ↓  = 90°
 *   ↙  = 135°
 *   ←  = 180°
 *   ↖  = 225°
 *   ↑  = 270°
 *   ↗  = 315°
 *   なし = -1
 *
 * 座標変換:
 *   SVG  (Y軸下向き): dx = cos(deg°), dy =  sin(deg°)
 *   PDF  (Y軸上向き): dx = cos(deg°), dy = -sin(deg°)  ← PDF内部はY反転
 */

export const ARROW_DIRS = [
  { deg: 225, label: '↖' },
  { deg: 270, label: '↑' },
  { deg: 315, label: '↗' },
  { deg: 180, label: '←' },
  { deg: -1,  label: '✕' },   // 矢印なし
  { deg: 0,   label: '→' },
  { deg: 135, label: '↙' },
  { deg: 90,  label: '↓' },
  { deg: 45,  label: '↘' },
] as const

export const NO_ARROW = -1

/**
 * SVG用: 矢印の始点・終点・矢印頭を計算
 * SVGのY軸は下向きなので dy = +sin(rad)
 */
export function calcArrowSVG(px: number, py: number, r: number, al: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)   // SVG: Y軸下向き
  return {
    tx: px + dx * r,          // 丸の端（矢印ライン始点）
    ty: py + dy * r,
    ex: px + dx * (r + al),   // 矢印先端
    ey: py + dy * (r + al),
  }
}

/**
 * PDF用: 矢印の始点・終点・矢印頭を計算
 * PDFのY軸は上向き（かつ座標はすでにPDF空間に変換済み）
 * なので dy = -sin(rad)
 */
export function calcArrowPDF(
  px: number,   // PDF空間X
  py: number,   // PDF空間Y（Y軸上向き）
  r: number,
  al: number,
  deg: number
) {
  const rad = (deg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = -Math.sin(rad)  // PDF: Y軸上向き
  const tx = px + dx * r, ty = py + dy * r
  const ex = px + dx * (r + al), ey = py + dy * (r + al)
  // 矢印頭の垂直方向
  const nx = -dy, ny = dx    // 法線ベクトル
  return {
    tx, ty, ex, ey, nx, ny,
    // 矢印頭の左右2点（長さahead, 幅aw）
    calcHead: (ahead: number, aw: number) => ({
      l: { x: ex - dx * ahead + nx * aw, y: ey - dy * ahead + ny * aw },
      r: { x: ex - dx * ahead - nx * aw, y: ey - dy * ahead - ny * aw },
    }),
  }
}
