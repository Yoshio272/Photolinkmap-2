import PptxGenJS from 'pptxgenjs'
import type { Pin } from '../../types'
import { NO_ARROW } from '../arrow'

/**
 * ピンを PowerPoint の「◯（楕円）図形」として書き出す。
 *
 * - ピンは編集可能な楕円図形（移動・拡大・色変更・文字編集ができる）
 * - 図形にハイパーリンクを付与（クリックで写真が開く）
 * - 向き矢印は矢じり付きの線図形として再現
 *
 * 座標系:
 *   pin.px / pin.py は「回転適用後の viewport 座標（Y下向き）」＝ pageW / pageH が基準。
 *   背景画像も renderBackground で同じ viewport 基準で描画するため、
 *   PDF出力のような回転補正・Y反転は不要（PowerPoint も Y 下向き）。
 */
export interface PptxExportOptions {
  /** 背景画像（PNG または JPEG の dataURL）。pageW×pageH と同じ内容・比率であること */
  imageDataUrl: string
  /** ピン座標の基準となる原寸サイズ（ズーム非依存） */
  pageW: number
  pageH: number
  pins: Pin[]
  /** ピンID → ハイパーリンクURL（空文字またはキー無しでリンクなし） */
  linkMap: Record<string, string>
  /** 注記（PDFと違い日本語も使用可） */
  noteText: string
  /** 出力ファイル名（.pptx） */
  fileName: string
  onProgress?: (pct: number, msg: string) => void
}

// 96dpi 換算で px→inch。PowerPoint の 1 辺上限（約 56 inch）に収まるよう縮小。
const DPI = 96
const MAX_SIDE_INCH = 50

export async function exportPptxWithPins(opts: PptxExportOptions): Promise<void> {
  const { imageDataUrl, pageW, pageH, pins, linkMap, noteText, fileName, onProgress } = opts
  const prog = (p: number, m: string) => onProgress?.(p, m)

  if (pageW <= 0 || pageH <= 0) {
    throw new Error('図面サイズが取得できません。図面を読み込み直してください。')
  }

  prog(40, 'スライド生成中...')

  // スライド寸法（図面のアスペクト比を維持）
  let slideW = pageW / DPI
  let slideH = pageH / DPI
  const k = Math.min(1, MAX_SIDE_INCH / Math.max(slideW, slideH))
  slideW *= k
  slideH *= k
  const s = slideW / pageW // px → inch（縦横同一スケール）

  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'PLM', width: slideW, height: slideH })
  pptx.layout = 'PLM'
  const slide = pptx.addSlide()

  prog(45, '背景を配置中...')
  slide.addImage({ data: imageDataUrl, x: 0, y: 0, w: slideW, h: slideH })

  // 始点→終点の線を bounding-box + flip で表現
  const lineBox = (x1: number, y1: number, x2: number, y2: number) => ({
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.max(Math.abs(x2 - x1), 0.01),
    h: Math.max(Math.abs(y2 - y1), 0.01),
    flipH: x2 < x1,
    flipV: y2 < y1,
  })

  let linkCount = 0

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i]
    prog(45 + Math.round(((i + 1) / pins.length) * 45), `ピン ${i + 1}/${pins.length}...`)

    const r0 = pin.r || 10
    const al0 = pin.al || 30
    const cx = pin.px * s
    const cy = pin.py * s
    const rIn = r0 * s
    const clr = (pin.color || '#1565C0').replace('#', '')

    // 向き矢印（PDF出力と同じ条件。SVG系 Y下向き: dx = cos, dy = sin）
    if (pin.deg !== NO_ARROW && al0 > 2) {
      const rad = (pin.deg * Math.PI) / 180
      const dx = Math.cos(rad)
      const dy = Math.sin(rad)
      const tx = (pin.px + dx * r0) * s
      const ty = (pin.py + dy * r0) * s
      const ex = (pin.px + dx * (r0 + al0)) * s
      const ey = (pin.py + dy * (r0 + al0)) * s
      slide.addShape(pptx.ShapeType.line, {
        ...lineBox(tx, ty, ex, ey),
        line: { color: clr, width: 2, endArrowType: 'triangle' },
      })
    }

    const linkUrl = linkMap[pin.id] || ''
    if (linkUrl) linkCount++

    // ◯図形（楕円）＋白フチ＋通し番号＋ハイパーリンク
    const fontSize = Math.max(6, Math.round(rIn * 72 * 0.85))
    slide.addText(String(i + 1), {
      shape: pptx.ShapeType.ellipse,
      x: cx - rIn,
      y: cy - rIn,
      w: rIn * 2,
      h: rIn * 2,
      fill: { color: clr },
      line: { color: 'FFFFFF', width: 1.5 },
      color: 'FFFFFF',
      fontSize,
      bold: true,
      align: 'center',
      valign: 'middle',
      ...(linkUrl ? { hyperlink: { url: linkUrl } } : {}),
    })
  }

  // 注記（PowerPoint は日本語もそのまま使える）
  const note = (noteText || '').trim()
  if (note) {
    slide.addText(note, {
      x: 0.1,
      y: slideH - 0.35,
      w: slideW - 0.2,
      h: 0.3,
      fontSize: 9,
      color: '555555',
    })
  }

  prog(95, '保存中...')
  await pptx.writeFile({ fileName })
  prog(100, `✓ 完了: ${pins.length}件 / リンク付き${linkCount}件`)
}
