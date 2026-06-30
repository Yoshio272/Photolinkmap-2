import { useState } from 'react'
import type { RefObject } from 'react'
import type { Pin, ExportConfig } from '../../types'
import type { BackgroundSource } from '../../services/background'
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib'
import { calcArrowPDF, NO_ARROW } from '../../features/arrow'
import { getPinType } from '../../types'
import { getPinPdfLinkUrl } from '../../features/viewer/viewerTypes'
import type { StorageConfig } from '../../services/storage'
// arrow utilities used below

interface Props {
  pins: Pin[]; pdfLoaded: boolean
  bgSource: BackgroundSource | null
  canvasRef: RefObject<HTMLCanvasElement | null>
  pageW: number; pageH: number   // Image原寸サイズ
  exportConfig: ExportConfig
  setExportConfig: (c: ExportConfig) => void
  storageConfig?: StorageConfig
  projectName: string
  setStatusMsg: (m: string) => void
}

function hex2rgb(h: string) {
  return rgb(parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255)
}

export function ExportTab({ pins, pdfLoaded, bgSource, canvasRef, pageW, pageH, exportConfig, setExportConfig, storageConfig, projectName, setStatusMsg }: Props) {
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [exporting, setExporting] = useState(false)

  const linked = pins.filter(p => p.link).length

  function prog(p: number, m: string) { setProgress(p); setProgressMsg(m) }

  async function doExport() {
    if (!pdfLoaded) { alert('図面を読み込んでください'); return }
    if (!pins.length) { alert('ピンがありません'); return }
    const canvas = canvasRef.current; if (!canvas) return
    setExporting(true); setProgress(0)
    try {
      prog(10, 'PDF解析中...')
      let doc: PDFDocument

      if (bgSource?.type === 'pdf') {
        doc = await PDFDocument.load(bgSource.data as Uint8Array)
      } else {
        doc = await PDFDocument.create()
        // ページサイズは原寸（pageW/pageH）で作成（ズーム非依存）
        const imgW = pageW > 0 ? pageW : canvas.width
        const imgH = pageH > 0 ? pageH : canvas.height
        const pg = doc.addPage([imgW, imgH])
        console.log('IMAGE BG: page created', imgW, imgH)
        if (bgSource?.type === 'image') {
          const isPng = (bgSource.data as string).startsWith('data:image/png')
          const ib = await (await fetch(bgSource.data as string)).arrayBuffer()
          const img = isPng ? await doc.embedPng(ib) : await doc.embedJpg(ib)
          console.log('IMAGE BG: drawImage', 0, 0, imgW, imgH)
          pg.drawImage(img, { x: 0, y: 0, width: imgW, height: imgH })
        } else {
          const ib = await (await fetch(canvas.toDataURL('image/jpeg', 0.92))).arrayBuffer()
          pg.drawImage(await doc.embedJpg(ib), { x: 0, y: 0, width: imgW, height: imgH })
        }
      }

      prog(25, 'ページ取得中...')
      const page = doc.getPages()[0]
      const { width: pW, height: pH } = page.getSize()   // MediaBox（回転前）サイズ
      const rotRaw = page.getRotation().angle
      const rot = ((rotRaw % 360) + 360) % 360            // 0/90/180/270 に正規化

      // pin.px/py は pdf.js viewport（回転適用後）座標系
      // vpW/vpH = pin.px/py の基準サイズ（background.ts の viewport サイズ・ズーム不変）
      // canvasW/H はズーム依存のため使用禁止
      if (pageW <= 0 || pageH <= 0) {
        throw new Error('図面サイズが取得できません。図面を読み込み直してください。')
      }
      const vpW = pageW   // 回転適用後の原寸幅
      const vpH = pageH   // 回転適用後の原寸高

      // ===== 実測ログ =====
      console.log('PDF ROTATE', rot)
      console.log('MEDIABOX pW pH', pW, pH)
      console.log('VIEWPORT vpW vpH', vpW, vpH)
      console.log('BGSIZE pageW pageH', pageW, pageH)

      /**
       * ピン座標（回転後viewport座標・y下向き）→ MediaBox座標（y上向き）変換
       * 背景＝元PDFコンテンツはMediaBox座標系で記述されており、
       * ビューワーが表示時にRotateを適用する。
       * ピンも同じMediaBox座標系に変換すれば、表示時に背景と一緒に回転される。
       */
      function toPdfCoord(ix: number, iy: number): { x: number; y: number } {
        switch (rot) {
          case 90:  return { x: iy * (pW / vpH),       y: ix * (pH / vpW) }
          case 180: return { x: pW - ix * (pW / vpW),  y: iy * (pH / vpH) }
          case 270: return { x: pW - iy * (pW / vpH),  y: pH - ix * (pH / vpW) }
          default:  return { x: ix * (pW / vpW),       y: pH - iy * (pH / vpH) }  // rot 0
        }
      }
      // 半径などスカラー値のスケール（回転で軸が入れ替わるため平均的なスケールを使用）
      // 半径・矢印長のスケール（回転時は軸が入れ替わるため対応軸のスケールを使用）
      const sx = (rot === 90 || rot === 270) ? pW / vpH : pW / vpW
      const font = await doc.embedFont(StandardFonts.HelveticaBold)
      const white = rgb(1, 1, 1)

      // 注記（ASCII only）
      const safeNote = exportConfig.noteText.replace(/[^\x00-\x7E]/g, '').trim()
      if (safeNote) page.drawText(safeNote, { x: 10, y: 10, size: 8, font, color: rgb(.3,.3,.3) })
      const now = new Date()
      page.drawText(`Output:${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`,
        { x: pW - 80, y: 10, size: 6.5, font, color: rgb(.5,.5,.5) })

      // ===== Box 360度ピンの共有リンクを事前取得（第三者閲覧用）=====
      const sharedUrlMap: Record<string, string> = {}
      const boxToken = localStorage.getItem('box_access_token') ?? ''
      // 360度写真 + 静止画の両方を共有リンク取得対象に
      const boxPins = pins.filter(p =>
        (getPinType(p) === '360' || getPinType(p) === 'photo') &&
        (storageConfig?.provider === 'box') &&
        (p.media?.driveFileId || (p.media?.url ?? p.link).match(/app\.box\.com\/file\/(\d+)/))
      )
      if (boxPins.length > 0 && exportConfig.enableHyperlink !== false && boxToken) {
        prog(30, `共有リンク取得中... (${boxPins.length}件)`)
        for (const p of boxPins) {
          const fid = p.media?.driveFileId
            ?? (p.media?.url ?? p.link).match(/app\.box\.com\/file\/(\d+)/)?.[1]
          if (!fid) continue
          try {
            const res = await fetch('/.netlify/functions/box-proxy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'create_shared_link', token: boxToken, fileId: fid }),
            })
            const data = await res.json() as { shared_link?: { download_url?: string }; reused?: boolean; error?: string }
            if (data.shared_link?.download_url) {
              sharedUrlMap[p.id] = data.shared_link.download_url
              console.log(`SHARED LINK ${data.reused ? 'reused' : 'created'}: ${fid} → ${data.shared_link.download_url.slice(0, 60)}`)
            } else if (data.error) {
              console.warn(`SHARED LINK failed for ${fid}: ${data.error}`)
            }
          } catch (e) {
            console.warn(`SHARED LINK error for ${fid}:`, e)
          }
        }
      }

      prog(35, `${pins.length}件のピンを描画中...`)

      for (let i = 0; i < pins.length; i++) {
        const pin = pins[i]
        prog(35 + Math.round((i+1)/pins.length * 55), `ピン ${i+1}/${pins.length}...`)
        // Image座標（回転後viewport）→ MediaBox座標（背景と同一座標系）
        const { x: px, y: py } = toPdfCoord(pin.px, pin.py)
        console.log(`PIN ${i+1} image:(${pin.px.toFixed(1)}, ${pin.py.toFixed(1)}) → pdf:(${px.toFixed(1)}, ${py.toFixed(1)}) rot=${rot}`)
        const r = (pin.r || 10) * sx, al = (pin.al || 30) * sx
        const clr = hex2rgb(pin.color || '#1565C0')
        const hasArrow = pin.deg !== NO_ARROW && al > 2

        if (hasArrow) {
          const arrow = calcArrowPDF(px, py, r, al, pin.deg)
          page.drawLine({ start: { x: arrow.tx, y: arrow.ty }, end: { x: arrow.ex, y: arrow.ey }, thickness: 1.5, color: clr })
          const head = arrow.calcHead(8, 4)
          page.drawLine({ start: { x: arrow.ex, y: arrow.ey }, end: { x: head.l.x, y: head.l.y }, thickness: 1.5, color: clr })
          page.drawLine({ start: { x: arrow.ex, y: arrow.ey }, end: { x: head.r.x, y: head.r.y }, thickness: 1.5, color: clr })
        }

        page.drawCircle({ x: px, y: py, size: r + 2, color: white, opacity: 0.88 })
        page.drawCircle({ x: px, y: py, size: r, color: clr })
        // ピン種別テキスト（小さなラベル）
        const pinType = getPinType(pin)
        if (pinType === '360' && r >= 6) {
          // 360マーク
          page.drawText('360', {
            x: px - font.widthOfTextAtSize('360', r * 0.55) / 2,
            y: py - r * 0.3,
            size: r * 0.55,
            font,
            color: white,
            opacity: 0.9,
          })
        }

        // ViewerProvider経由でリンクを生成
        // 360度写真 → PhotoLinkMap Viewerへのリンク
        // 通常写真  → Google Driveリンク
        const pinTypeVal = getPinType(pin)
        const viewerType = pinTypeVal === '360' ? 'photosphere' as const : 'image' as const
        const driveFileId = pin.media?.driveFileId
        const mediaUrl    = pin.media?.url || pin.link
        const storageProvider = storageConfig?.provider ?? 'google-drive'
        // ハイパーリンクなしモード: リンクを一切埋め込まない
        let linkUrl = ''
        if (exportConfig.enableHyperlink !== false) {
          linkUrl = getPinPdfLinkUrl(viewerType, driveFileId, mediaUrl, pin.name, pin.lat, pin.lng, storageProvider, sharedUrlMap[pin.id])
        }
        if (linkUrl) {
          const aw2 = (r + 4) * 2, ah2 = (r + 4) * 2, ax2 = px - r - 4, ay2 = py - r - 4
          const annot = doc.context.obj({
            Type: 'Annot', Subtype: 'Link', Rect: [ax2, ay2, ax2 + aw2, ay2 + ah2],
            Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(linkUrl) },
          })
          const ref = doc.context.register(annot)
          const annots = page.node.get(PDFName.of('Annots'))
          if (annots && 'push' in annots) (annots as { push: (r: typeof ref) => void }).push(ref)
          else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
        }
      }

      prog(95, '保存中...')
      const bytes = await doc.save()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }))
      a.download = exportConfig.fileName || 'survey.pdf'
      a.click(); URL.revokeObjectURL(a.href)
      prog(100, `✓ 完了: ${pins.length}件 / リンク付き${linked}件`)
      setStatusMsg(`✓ STEP5 PDF出力完了: ${exportConfig.fileName}`)
    } catch (e: unknown) {
      prog(0, '❌ ' + (e instanceof Error ? e.message : '出力エラー'))
    } finally { setExporting(false) }
  }

  return (
    <div className="overflow-y-auto flex-1 flex flex-col gap-0">
      <div className="section">
        <h4>STEP5 PDF出力</h4>
        <div className={`info-box ${!pdfLoaded ? 'info-warn' : !pins.length ? 'info-warn' : 'info-green'}`}>
          {!pdfLoaded ? '図面を読み込んでください' : !pins.length ? 'ピンがありません'
            : `✓ ${pins.length}件のピン | 🔗リンク付き: ${linked}件`}
        </div>
        <div className="info-warn text-xs">
          <b>📌 リンクを有効にするには</b><br />
          出力PDFを <b>ChromeまたはEdgeにドラッグ</b> して開いてください。<br />
          <span className="opacity-80">Adobe Readerはデフォルトでリンクをブロックします。</span>
        </div>
      </div>

      <div className="section">
        <div className="space-y-1">
          <label className="flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors"
            style={{ borderColor: exportConfig.enableHyperlink !== false ? '#1565C0' : '#e5e7eb',
                     background: exportConfig.enableHyperlink !== false ? '#E3EDFB' : 'white' }}>
            <input type="radio" name="hyperlink" className="accent-[#1565C0]"
              checked={exportConfig.enableHyperlink !== false}
              onChange={() => setExportConfig({ ...exportConfig, enableHyperlink: true })} />
            <span className="font-semibold">🔗 ハイパーリンクあり</span>
          </label>
          <label className="flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors"
            style={{ borderColor: exportConfig.enableHyperlink === false ? '#1565C0' : '#e5e7eb',
                     background: exportConfig.enableHyperlink === false ? '#E3EDFB' : 'white' }}>
            <input type="radio" name="hyperlink" className="accent-[#1565C0]"
              checked={exportConfig.enableHyperlink === false}
              onChange={() => setExportConfig({ ...exportConfig, enableHyperlink: false })} />
            <span className="font-semibold">🖨 ハイパーリンクなし（印刷用）</span>
          </label>
        </div>
        {exportConfig.enableHyperlink !== false && storageConfig?.provider === 'box' && (
          <div className="info-warn text-xs mt-2">
            ⚠ 360度写真には共有リンクが使用されます。<br />
            PDFを受け取った人はリンクを利用して写真を閲覧できます。<br />
            機密情報を含む場合はご注意ください。
          </div>
        )}
      </div>

      <div className="section">
        <h4>ファイル設定</h4>
        <div className="label">出力ファイル名</div>
        <input className="input mb-2" value={exportConfig.fileName}
          onChange={e => setExportConfig({ ...exportConfig, fileName: e.target.value })}
          onFocus={() => { if (!exportConfig.fileName) setExportConfig({ ...exportConfig, fileName: `${projectName.replace(/[^a-zA-Z0-9_\-]/g, '_')}.pdf` }) }} />
        <div className="label">注記（PDF左下・英数字のみ）</div>
        <input className="input" placeholder="Site Survey 2026-06"
          value={exportConfig.noteText} onChange={e => setExportConfig({ ...exportConfig, noteText: e.target.value })} />
      </div>

      {progressMsg && (
        <div className="section">
          <div className="h-1.5 bg-gray-200 rounded overflow-hidden mb-1">
            <div className="h-full bg-green-500 rounded transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-gray-500">{progressMsg}</div>
        </div>
      )}

      <div className="section">
        <button
          className="w-full py-3 text-sm font-bold text-white rounded-lg flex items-center justify-center gap-2 transition-colors"
          style={{ background: exporting || !pdfLoaded || !pins.length ? '#aadecb' : '#1D9E75', cursor: exporting ? 'not-allowed' : 'pointer' }}
          onClick={doExport} disabled={exporting || !pdfLoaded || !pins.length}>
          📤 ハイパーリンク付きPDFを出力
        </button>
      </div>
    </div>
  )
}
