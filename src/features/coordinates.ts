/**
 * 座標系管理モジュール
 *
 * PhotoLinkMapで使用する座標系:
 *
 * ① Image座標（原寸、常にこれで保持）
 *    - 単位: px（原寸での画像ピクセル）
 *    - 原点: 画像左上
 *    - range: [0, pageWidth] × [0, pageHeight]
 *    - 保存: pin.px / pin.py はこの座標
 *
 * ② Canvas座標（表示用、ズーム依存）
 *    - Canvas座標 = Image座標 × zoomScale
 *    - SVGのcx/cy, clickイベントはCanvas座標
 *    - canvasW = pageWidth × zoomScale
 *    - canvasH = pageHeight × zoomScale
 *
 * ③ PDF座標（pdf-lib内部）
 *    - Y軸が上向き（SVGと逆）
 *    - PDF座標X = Image座標X × (pdfW / pageWidth)
 *    - PDF座標Y = pdfH - Image座標Y × (pdfH / pageHeight)
 */

// ===== Canvas ↔ Image 変換 =====

/** Canvas座標 → Image座標 */
export function canvasToImage(canvasX: number, canvasY: number, zoomScale: number) {
  return { x: canvasX / zoomScale, y: canvasY / zoomScale }
}

/** Image座標 → Canvas座標 */
export function imageToCanvas(imageX: number, imageY: number, zoomScale: number) {
  return { x: imageX * zoomScale, y: imageY * zoomScale }
}

// ===== Image ↔ PDF 変換 =====

/** Image座標 → PDF座標 */
export function imageToPdf(
  imageX: number,
  imageY: number,
  pageWidth: number,
  pageHeight: number,
  pdfW: number,
  pdfH: number,
) {
  const sx = pdfW / pageWidth
  const sy = pdfH / pageHeight
  return {
    x: imageX * sx,
    y: pdfH - imageY * sy,  // Y軸反転
  }
}

// ===== デバッグ表示 =====

export interface CoordDebugInfo {
  imageX: number; imageY: number
  canvasX: number; canvasY: number
  pdfX?: number;  pdfY?: number
  zoomScale: number
  pageWidth: number; pageHeight: number
}

export function formatCoordDebug(info: CoordDebugInfo): string {
  const lines = [
    `Image座標:  (${info.imageX.toFixed(1)}, ${info.imageY.toFixed(1)}) / (${info.pageWidth}×${info.pageHeight})`,
    `Canvas座標: (${info.canvasX.toFixed(1)}, ${info.canvasY.toFixed(1)}) @ zoom=${info.zoomScale.toFixed(2)}`,
  ]
  if (info.pdfX !== undefined) {
    lines.push(`PDF座標:    (${info.pdfX.toFixed(1)}, ${info.pdfY?.toFixed(1)})`)
  }
  return lines.join('\n')
}
