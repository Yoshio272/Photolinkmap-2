/**
 * キャリブレーション座標変換
 *
 * 緯度経度 ⇔ Image座標(px,py) の相互変換。
 *
 * 変換方式（基準点の数で自動切替）:
 *   2点   → 相似変換（回転 + 等方スケール + 平行移動）。2点が水平/垂直でも破綻しない。
 *   3点   → アフィン変換（厳密解）。X/Y独立スケール・せん断・回転に対応。
 *   4点以上 → 最小二乗アフィン。
 *
 * GPS座標は局所平面（東西=メートル, 南北=メートル）に投影してから変換するため、
 * 緯度経度の非線形性（経度1度の距離が緯度で変わる）も補正される。
 *
 * 「キャリブレーションを使用する」がONの場合のみ利用される。
 */
import type { CalibPoint, LatLng } from '../../types'

const EARTH_R = 111000 // 緯度1度あたりの距離(m) 近似

// ===== GPS → 局所平面投影 =====
// 基準点配列の先頭を原点とし、東西(ex)・南北(ny)のメートル座標へ変換
function makeProjector(pts: CalibPoint[]) {
  const origin = pts[0]
  const cosLat = Math.cos((origin.lat ?? 0) * Math.PI / 180)
  return (lat: number, lng: number) => ({
    ex: (lng - (origin.lng ?? 0)) * EARTH_R * cosLat,
    ny: (lat - (origin.lat ?? 0)) * EARTH_R,
  })
}

// 有効な基準点（px,py,lat,lng が全て揃っているもの）のみ抽出
function validPoints(pts: CalibPoint[]): Required<CalibPoint>[] {
  return pts.filter(
    p => p && p.lat !== undefined && p.lng !== undefined &&
         p.px !== undefined && p.py !== undefined
  ) as Required<CalibPoint>[]
}

// ===== 一直線・近接チェック =====
// 戻り値: 'ok' | 'collinear'(一直線) | 'tooclose'(近すぎ) | 'insufficient'(点不足)
export type CalibQuality = 'ok' | 'collinear' | 'tooclose' | 'insufficient'

export function checkCalibQuality(pts: CalibPoint[]): CalibQuality {
  const vp = validPoints(pts)
  if (vp.length < 2) return 'insufficient'
  const proj = makeProjector(vp)
  const L = vp.map(p => proj(p.lat, p.lng))

  // 2点間が近すぎないか（10m未満は警告）
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) {
      const d = Math.hypot(L[i].ex - L[j].ex, L[i].ny - L[j].ny)
      if (d < 10) return 'tooclose'
    }
  }

  if (vp.length >= 3) {
    // 3点が作る三角形の面積（小さすぎると一直線）
    const area = Math.abs(
      (L[1].ex - L[0].ex) * (L[2].ny - L[0].ny) -
      (L[2].ex - L[0].ex) * (L[1].ny - L[0].ny)
    ) / 2
    if (area < 50) return 'collinear' // 50m²未満は実質一直線
  }
  return 'ok'
}

// ===== 変換行列の構築 =====
// px = m00*ex + m01*ny + m02
// py = m10*ex + m11*ny + m12
interface AffineMatrix {
  m00: number; m01: number; m02: number
  m10: number; m11: number; m12: number
}

// 2点 → 相似変換（回転+等方スケール+平行移動）
function solveSimilarity(vp: Required<CalibPoint>[], proj: (lat: number, lng: number) => { ex: number; ny: number }): AffineMatrix | null {
  const a = vp[0], b = vp[1]
  const la = proj(a.lat, a.lng), lb = proj(b.lat, b.lng)
  const vx = lb.ex - la.ex, vy = lb.ny - la.ny
  const wx = b.px - a.px, wy = b.py - a.py
  const denom = vx * vx + vy * vy
  if (denom < 1e-9) return null
  // 複素数除算で回転+スケール係数を求める
  const Mre = (wx * vx + wy * vy) / denom // s*cosθ
  const Mim = (wy * vx - wx * vy) / denom // s*sinθ
  // px = a.px + Mre*(ex-la.ex) - Mim*(ny-la.ny)
  // py = a.py + Mim*(ex-la.ex) + Mre*(ny-la.ny)
  return {
    m00: Mre,  m01: -Mim, m02: a.px - Mre * la.ex + Mim * la.ny,
    m10: Mim,  m11: Mre,  m12: a.py - Mim * la.ex - Mre * la.ny,
  }
}

// 3点以上 → アフィン変換（最小二乗、3点なら厳密解）
// 正規方程式 (AᵀA)x = Aᵀb を解く。Aは[ex, ny, 1]、bはpxまたはpy。
function solveAffine(vp: Required<CalibPoint>[], proj: (lat: number, lng: number) => { ex: number; ny: number }): AffineMatrix | null {
  const L = vp.map(p => proj(p.lat, p.lng))
  // AᵀA (3x3 対称行列)
  let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0
  // Aᵀbx, Aᵀby
  let bx0 = 0, bx1 = 0, bx2 = 0
  let by0 = 0, by1 = 0, by2 = 0
  for (let i = 0; i < vp.length; i++) {
    const ex = L[i].ex, ny = L[i].ny
    s00 += ex * ex; s01 += ex * ny; s02 += ex
    s11 += ny * ny; s12 += ny
    s22 += 1
    bx0 += ex * vp[i].px; bx1 += ny * vp[i].px; bx2 += vp[i].px
    by0 += ex * vp[i].py; by1 += ny * vp[i].py; by2 += vp[i].py
  }
  // 3x3 逆行列
  const inv = invert3x3([
    s00, s01, s02,
    s01, s11, s12,
    s02, s12, s22,
  ])
  if (!inv) return null
  const mx = mul3x3vec(inv, [bx0, bx1, bx2])
  const my = mul3x3vec(inv, [by0, by1, by2])
  return {
    m00: mx[0], m01: mx[1], m02: mx[2],
    m10: my[0], m11: my[1], m12: my[2],
  }
}

function invert3x3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null
  const id = 1 / det
  return [
    A * id, (c * h - b * i) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, (c * d - a * f) * id,
    C * id, (b * g - a * h) * id, (a * e - b * d) * id,
  ]
}

function mul3x3vec(m: number[], v: number[]): number[] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

// ===== 変換行列を取得（点数で自動切替）=====
function buildMatrix(pts: CalibPoint[]): AffineMatrix | null {
  const vp = validPoints(pts)
  if (vp.length < 2) return null
  const proj = makeProjector(vp)
  if (vp.length === 2) return solveSimilarity(vp, proj)
  return solveAffine(vp, proj)
}

// ===== 緯度経度 → Image座標(px,py) =====
export function latLngToPx(lat: number, lng: number, pts: CalibPoint[]): { x: number; y: number } | null {
  const vp = validPoints(pts)
  if (vp.length < 2) return null
  const matrix = buildMatrix(pts)
  if (!matrix) return null
  const proj = makeProjector(vp)
  const { ex, ny } = proj(lat, lng)
  return {
    x: matrix.m00 * ex + matrix.m01 * ny + matrix.m02,
    y: matrix.m10 * ex + matrix.m11 * ny + matrix.m12,
  }
}

// ===== Image座標(px,py) → 緯度経度 =====
// アフィン行列の逆変換 → 局所平面 → 緯度経度
export function pxToLatLng(px: number, py: number, pts: CalibPoint[]): LatLng {
  const vp = validPoints(pts)
  if (vp.length < 2) return { lat: 0, lng: 0 }
  const matrix = buildMatrix(pts)
  if (!matrix) return { lat: 0, lng: 0 }
  // [px,py] = M[ex,ny] + t  →  [ex,ny] = M⁻¹([px,py] - t)
  const det = matrix.m00 * matrix.m11 - matrix.m01 * matrix.m10
  if (Math.abs(det) < 1e-12) return { lat: 0, lng: 0 }
  const dx = px - matrix.m02
  const dy = py - matrix.m12
  const ex = (matrix.m11 * dx - matrix.m01 * dy) / det
  const ny = (-matrix.m10 * dx + matrix.m00 * dy) / det
  const origin = vp[0]
  const cosLat = Math.cos((origin.lat ?? 0) * Math.PI / 180)
  return {
    lat: (origin.lat ?? 0) + ny / EARTH_R,
    lng: (origin.lng ?? 0) + ex / (EARTH_R * cosLat),
  }
}

/** 緯度経度文字列のパース（"35.1234, 135.5678" / Google Maps URL 対応）*/
export function parseLatLng(input: string): LatLng | null {
  const s = input.trim()
  const urlMatch = s.match(/[@?q=]?(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/)
  if (urlMatch) {
    const lat = parseFloat(urlMatch[1]), lng = parseFloat(urlMatch[2])
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
  }
  return null
}
