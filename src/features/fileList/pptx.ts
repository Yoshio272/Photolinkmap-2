import PptxGenJS from 'pptxgenjs'
import type { FileEntry } from './index'

/**
 * ファイルモード — 写真一覧の PowerPoint 出力
 *
 * PDF出力（pdf.ts）が HTML を画像化して貼る方式なのに対し、
 * こちらは PowerPoint 上で編集できる「表」として作成する。
 *   - サムネイル画像はセル内に図として配置
 *   - ファイル名セルにハイパーリンク（クリックで写真が開く）
 *   - 文字はすべて編集可能（日本語もそのまま使える）
 *
 * A4縦（10 x 14.14 inch）で 1ページ12行、PDF出力と同じ体裁。
 */
export interface FileListPptxResult {
  pages: number
  linked: number
}

// A4縦（inch）。PDF出力（595.28 x 841.89pt）と同じ 1:√2
const SLIDE_W = 10
const SLIDE_H = 14.14
const MARGIN_X = 0.46
const MARGIN_TOP = 0.42
const ROWS_PER_PAGE = 12

// 列幅（inch）: No / 写真 / ファイル名 / 撮影時刻
const COL_NO = 0.5
const COL_THUMB = 0.95
const COL_TIME = 1.6
const TABLE_W = SLIDE_W - MARGIN_X * 2
const COL_NAME = TABLE_W - COL_NO - COL_THUMB - COL_TIME

const ROW_H = 0.86
const HEAD_H = 0.32

const BLUE = '1565C0'
const GRAY = '6B7280'
const INK = '111827'
const BORDER = 'E5E7EB'

/** 写真名一覧の PowerPoint を生成してダウンロードする */
export async function exportFileListPptx(
  entries: FileEntry[],
  siteName: string,
): Promise<FileListPptxResult> {
  if (entries.length === 0) throw new Error('写真がありません。先に取り込んでください')

  const chunks: FileEntry[][] = []
  for (let i = 0; i < entries.length; i += ROWS_PER_PAGE) {
    chunks.push(entries.slice(i, i + ROWS_PER_PAGE))
  }

  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'A4P', width: SLIDE_W, height: SLIDE_H })
  pptx.layout = 'A4P'

  const dateStr = formatToday()
  let linked = 0

  for (let pi = 0; pi < chunks.length; pi++) {
    const rows = chunks[pi]
    const slide = pptx.addSlide()

    // ===== ヘッダー =====
    slide.addText(siteName || '写真一覧', {
      x: MARGIN_X, y: MARGIN_TOP, w: TABLE_W * 0.6, h: 0.32,
      fontSize: 18, bold: true, color: INK, valign: 'bottom',
    })
    slide.addText('写真一覧表', {
      x: MARGIN_X, y: MARGIN_TOP + 0.32, w: TABLE_W * 0.6, h: 0.2,
      fontSize: 10, color: GRAY, valign: 'top',
    })
    slide.addText(
      `出力日: ${dateStr}\n写真: ${entries.length}件\n${pi + 1} / ${chunks.length} ページ`,
      {
        x: MARGIN_X + TABLE_W * 0.6, y: MARGIN_TOP, w: TABLE_W * 0.4, h: 0.52,
        fontSize: 9, color: '374151', align: 'right', valign: 'top', lineSpacingMultiple: 1.2,
      },
    )
    // ヘッダー下の青い罫
    slide.addShape(pptx.ShapeType.rect, {
      x: MARGIN_X, y: MARGIN_TOP + 0.58, w: TABLE_W, h: 0.02,
      fill: { color: BLUE }, line: { color: BLUE, width: 0 },
    })

    // ===== 表ヘッダー行 =====
    const tableTop = MARGIN_TOP + 0.68
    const headCells: [string, number][] = [
      ['No', COL_NO], ['写真', COL_THUMB], ['ファイル名', COL_NAME], ['撮影時刻', COL_TIME],
    ]
    let hx = MARGIN_X
    for (const [label, w] of headCells) {
      slide.addText(label, {
        x: hx, y: tableTop, w, h: HEAD_H,
        fill: { color: BLUE }, color: 'FFFFFF',
        fontSize: 10, bold: true, align: 'center', valign: 'middle',
        line: { color: BLUE, width: 0.5 },
      })
      hx += w
    }

    // ===== データ行 =====
    for (let ri = 0; ri < rows.length; ri++) {
      const e = rows[ri]
      const y = tableTop + HEAD_H + ri * ROW_H
      let x = MARGIN_X

      // No
      slide.addText(String(e.no), {
        x, y, w: COL_NO, h: ROW_H,
        fontSize: 11, bold: true, color: BLUE, align: 'center', valign: 'middle',
        line: { color: BORDER, width: 0.5 },
      })
      x += COL_NO

      // 写真（セル枠 → サムネイルを中央に重ねる）
      slide.addShape(pptx.ShapeType.rect, {
        x, y, w: COL_THUMB, h: ROW_H,
        fill: { color: 'FFFFFF' }, line: { color: BORDER, width: 0.5 },
      })
      if (e.thumbDataUrl) {
        const size = 0.7
        slide.addImage({
          data: e.thumbDataUrl,
          x: x + (COL_THUMB - size) / 2,
          y: y + (ROW_H - size) / 2,
          w: size, h: size,
          sizing: { type: 'cover', w: size, h: size },
        })
      }
      x += COL_THUMB

      // ファイル名（リンクあり＝青・下線）
      const label = `${e.is360 ? '🌐 ' : ''}${e.fileName}${e.cloudUrl ? '' : '\n（リンクなし）'}`
      if (e.cloudUrl) linked++
      slide.addText(label, {
        x, y, w: COL_NAME, h: ROW_H,
        fontSize: 9,
        bold: true,
        color: e.cloudUrl ? BLUE : INK,
        underline: e.cloudUrl ? { style: 'sng' } : undefined,
        align: 'left', valign: 'middle',
        margin: 4,
        line: { color: BORDER, width: 0.5 },
        ...(e.cloudUrl ? { hyperlink: { url: e.cloudUrl } } : {}),
      })
      x += COL_NAME

      // 撮影時刻
      slide.addText(e.takenAt ?? '—', {
        x, y, w: COL_TIME, h: ROW_H,
        fontSize: 9, color: INK, align: 'center', valign: 'middle',
        line: { color: BORDER, width: 0.5 },
      })
    }
  }

  await pptx.writeFile({ fileName: `${siteName || '写真一覧'}_写真一覧.pptx` })

  return { pages: chunks.length, linked }
}

function formatToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}
