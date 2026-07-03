/**
 * BackgroundLayer - PDF/JPEG/PNG 共通表示サービス
 * fit/zoom/render を一本化し、背景形式を意識させない設計
 */
import * as pdfjsLib from 'pdfjs-dist'
import { PDFJS_WORKER_SRC, PDFJS_CMAP_URL } from './pdfjsCdn'

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC

const CMAP_URL = PDFJS_CMAP_URL

export type BgType = 'pdf' | 'image'

export interface BackgroundSource {
  type: BgType
  /** PDF: Uint8Array、画像: DataURL文字列（再描画用） */
  data: Uint8Array | string
  pageWidth: number   // 原寸幅 (PDF=pt, 画像=px)
  pageHeight: number  // 原寸高
  fileName: string
}

export interface RenderResult {
  canvasW: number
  canvasH: number
  scale: number
}

// ===== fit倍率計算（PDF・画像共通）=====
export function calcFitScale(
  pageW: number,
  pageH: number,
  areaW: number,
  areaH: number,
  padding = 32,
  maxScale = 4
): number {
  const availW = Math.max(areaW - padding * 2, 100)
  const availH = Math.max(areaH - padding * 2, 100)
  return Math.min(availW / pageW, availH / pageH, maxScale)
}

// ===== ファイル種別判定 =====
export function detectBgType(file: File): BgType | null {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'pdf'
  if (['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) return 'image'
  if (/\.(jpe?g|png)$/i.test(file.name)) return 'image'
  return null
}

// ===== ファイル読み込み → BackgroundSource生成 =====
export async function loadBackgroundFile(file: File): Promise<BackgroundSource> {
  const type = detectBgType(file)
  if (!type) throw new Error(`非対応ファイル形式: ${file.type}`)

  if (type === 'pdf') {
    const ab = await file.arrayBuffer()
    const bytes = new Uint8Array(ab)
    const doc = await pdfjsLib.getDocument({ data: ab.slice(0), cMapUrl: CMAP_URL, cMapPacked: true }).promise
    const page = await doc.getPage(1)
    // rotation を適用してキャンバスと同じ座標系にする
    const rotation = page.rotate ?? 0
    const vp = page.getViewport({ scale: 1, rotation })
    return { type: 'pdf', data: bytes, pageWidth: vp.width, pageHeight: vp.height, fileName: file.name }
  } else {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        // DataURLとして保存（再描画用）
        const oc = document.createElement('canvas')
        oc.width = img.naturalWidth; oc.height = img.naturalHeight
        oc.getContext('2d')!.drawImage(img, 0, 0)
        URL.revokeObjectURL(url)
        resolve({
          type: 'image',
          data: oc.toDataURL('image/png'),
          pageWidth: img.naturalWidth,
          pageHeight: img.naturalHeight,
          fileName: file.name,
        })
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像読込失敗')) }
      img.src = url
    })
  }
}

// ===== 指定スケールで canvas に描画 =====
export async function renderBackground(
  source: BackgroundSource,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<RenderResult> {
  if (source.type === 'pdf') {
    return renderPdf(source.data as Uint8Array, canvas, scale)
  } else {
    return renderImage(source.data as string, source.pageWidth, source.pageHeight, canvas, scale)
  }
}

// ===== fit倍率で描画 =====
export async function renderBackgroundFit(
  source: BackgroundSource,
  canvas: HTMLCanvasElement,
  areaW: number,
  areaH: number
): Promise<RenderResult> {
  const scale = calcFitScale(source.pageWidth, source.pageHeight, areaW, areaH)
  return renderBackground(source, canvas, scale)
}

// ===== PDF描画（内部）=====
async function renderPdf(bytes: Uint8Array, canvas: HTMLCanvasElement, scale: number): Promise<RenderResult> {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), cMapUrl: CMAP_URL, cMapPacked: true }).promise
  const page = await doc.getPage(1)
  const vp = page.getViewport({ scale })
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas }).promise
  return { canvasW: canvas.width, canvasH: canvas.height, scale }
}

// ===== 画像描画（内部）=====
function renderImage(
  dataUrl: string,
  pageW: number,
  pageH: number,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<RenderResult> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = Math.round(pageW * scale)
      const h = Math.round(pageH * scale)
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      resolve({ canvasW: w, canvasH: h, scale })
    }
    img.onerror = () => reject(new Error('画像再描画失敗'))
    img.src = dataUrl
  })
}

// ===== BackgroundSource を保存可能な形式に変換 =====
export interface SerializedBackground {
  type: BgType
  dataBase64?: string   // PDFのみ(バイナリをbase64化)
  dataUrl?: string      // 画像のみ
  pageWidth: number
  pageHeight: number
  fileName: string
}

export function serializeBackground(src: BackgroundSource): SerializedBackground {
  if (src.type === 'pdf') {
    const bytes = src.data as Uint8Array
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return { type: 'pdf', dataBase64: btoa(binary), pageWidth: src.pageWidth, pageHeight: src.pageHeight, fileName: src.fileName }
  } else {
    return { type: 'image', dataUrl: src.data as string, pageWidth: src.pageWidth, pageHeight: src.pageHeight, fileName: src.fileName }
  }
}

export function deserializeBackground(s: SerializedBackground): BackgroundSource {
  if (s.type === 'pdf' && s.dataBase64) {
    const binary = atob(s.dataBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { type: 'pdf', data: bytes, pageWidth: s.pageWidth, pageHeight: s.pageHeight, fileName: s.fileName }
  } else {
    return { type: 'image', data: s.dataUrl!, pageWidth: s.pageWidth, pageHeight: s.pageHeight, fileName: s.fileName }
  }
}
