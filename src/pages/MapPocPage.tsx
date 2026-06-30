/**
 * 地図モード PoC（フェーズ1：地図画像化の検証）
 *
 * 目的: 国土地理院の航空写真をLeafletで表示し、それをcanvas画像化してPDFに貼れるかを検証する。
 *       これはVer1.0全機能の前提（地図がPDF化できなければ成立しない）。
 *
 * 検証する3点:
 *   1. Leafletで地理院航空写真タイルが表示できる
 *   2. 地図をcanvas画像化できる（CORS汚染が起きないか）
 *   3. 画像化したものをPDFに貼って出力できる
 *
 * このページは既存アプリと完全に独立。/map-poc でのみ表示される。
 * Leaflet等は外部CDNから動的読込し、package.jsonの依存を増やさない（ビルドリスク回避）。
 */
import { useEffect, useRef, useState } from 'react'

// 地理院 航空写真タイル（APIキー不要・商用可）
const GSI_PHOTO_URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'
const GSI_ATTR = "出典：<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank' rel='noopener'>国土地理院</a>"

// 外部スクリプト/CSSを動的ロードするヘルパー
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`load failed: ${src}`))
    document.head.appendChild(s)
  })
}
function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = href
  document.head.appendChild(l)
}

type Status = 'idle' | 'loading-libs' | 'map-ready' | 'capturing' | 'done' | 'error'

export function MapPocPage() {
  const mapElRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [log, setLog] = useState<string[]>([])
  const [captureMethod, setCaptureMethod] = useState<string>('')

  const addLog = (msg: string) => setLog(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`])

  // ライブラリ読込 → 地図初期化
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setStatus('loading-libs')
        addLog('Leaflet 読込中...')
        loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')
        await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
        addLog('Leaflet 読込完了')

        if (cancelled || !mapElRef.current) return
        const L = (window as any).L

        // 東京駅付近を初期表示
        const map = L.map(mapElRef.current).setView([35.681236, 139.767125], 17)
        L.tileLayer(GSI_PHOTO_URL, {
          attribution: GSI_ATTR,
          maxZoom: 18,
          crossOrigin: 'anonymous', // canvas汚染回避のため重要
        }).addTo(map)
        L.control.scale({ imperial: false }).addTo(map) // 距離スケール
        mapRef.current = map
        addLog('地図表示完了（地理院 航空写真）')
        setStatus('map-ready')
      } catch (e: any) {
        addLog('エラー: ' + e.message)
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [])

  // 地図を画像化してPDF出力
  async function handleExportPdf() {
    setStatus('capturing')
    addLog('画像化開始...')
    try {
      const canvas = await captureMap()
      if (!canvas) { addLog('画像化失敗'); setStatus('error'); return }
      addLog(`画像化成功（方式: ${captureMethod}）`)

      // PDF化（pdf-lib は既存依存にあるが、ここではcanvas→画像→pdf-libで貼る）
      addLog('PDF生成中...')
      const { PDFDocument } = await import('pdf-lib')
      const pngDataUrl = canvas.toDataURL('image/png')
      const pngBytes = await fetch(pngDataUrl).then(r => r.arrayBuffer())
      const pdf = await PDFDocument.create()
      const png = await pdf.embedPng(pngBytes)
      // A4横向き(842x595pt)に収める
      const pageW = 842, pageH = 595
      const page = pdf.addPage([pageW, pageH])
      const margin = 40
      const maxW = pageW - margin * 2
      const maxH = pageH - margin * 2 - 60
      const scale = Math.min(maxW / png.width, maxH / png.height)
      const w = png.width * scale, h = png.height * scale
      page.drawText('現場位置図（航空写真）PoC', { x: margin, y: pageH - margin, size: 18 })
      page.drawImage(png, { x: margin, y: pageH - margin - 20 - h, width: w, height: h })
      page.drawText('出典：国土地理院  /  出力日：' + new Date().toLocaleDateString(),
        { x: margin, y: margin, size: 10 })

      const bytes = await pdf.save()
      const blob = new Blob([bytes instanceof Uint8Array ? bytes.buffer as ArrayBuffer : bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'map-poc.pdf'
      a.click()
      URL.revokeObjectURL(url)
      addLog('PDF出力完了 ✓')
      setStatus('done')
    } catch (e: any) {
      addLog('PDF生成エラー: ' + e.message)
      setStatus('error')
    }
  }

  // 地図のcanvas化。leaflet-image → html2canvas の順に試す。
  async function captureMap(): Promise<HTMLCanvasElement | null> {
    const map = mapRef.current
    if (!map) return null

    // 方式1: leaflet-image（タイルとマーカーをcanvasに描く専用ライブラリ）
    try {
      addLog('方式1: leaflet-image を試行...')
      await loadScript('https://unpkg.com/leaflet-image@0.4.0/leaflet-image.js')
      const leafletImage = (window as any).leafletImage
      if (leafletImage) {
        const canvas: HTMLCanvasElement = await new Promise((resolve, reject) => {
          leafletImage(map, (err: any, resultCanvas: HTMLCanvasElement) => {
            if (err) reject(err); else resolve(resultCanvas)
          })
        })
        setCaptureMethod('leaflet-image')
        return canvas
      }
    } catch (e: any) {
      addLog('方式1失敗: ' + e.message)
    }

    // 方式2: html2canvas（DOM全体をスクショ）
    try {
      addLog('方式2: html2canvas を試行...')
      await loadScript('https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js')
      const html2canvas = (window as any).html2canvas
      if (html2canvas && mapElRef.current) {
        const canvas = await html2canvas(mapElRef.current, {
          useCORS: true,
          allowTaint: false,
        })
        setCaptureMethod('html2canvas')
        return canvas
      }
    } catch (e: any) {
      addLog('方式2失敗: ' + e.message)
    }

    return null
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* 地図 */}
      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={mapElRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* コントロールパネル */}
      <div style={{ width: 360, padding: 16, borderLeft: '1px solid #ddd', overflow: 'auto', background: '#fafafa' }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>地図画像化 PoC</h2>
        <p style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>
          国土地理院の航空写真を表示し、画像化してPDFに出力できるかを検証します。
          地図をズーム・移動してから「PDF出力」を押してください。
        </p>

        <button
          onClick={handleExportPdf}
          disabled={status !== 'map-ready' && status !== 'done' && status !== 'error'}
          style={{
            width: '100%', padding: '12px', fontSize: 15, fontWeight: 600,
            background: (status === 'map-ready' || status === 'done' || status === 'error') ? '#1D9E75' : '#ccc',
            color: 'white', border: 'none', borderRadius: 8,
            cursor: (status === 'map-ready' || status === 'done' || status === 'error') ? 'pointer' : 'default',
          }}
        >
          {status === 'capturing' ? '画像化中...' : 'PDF出力'}
        </button>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>状態: {status}</div>
          {captureMethod && <div style={{ fontSize: 12, color: '#1D9E75' }}>画像化方式: {captureMethod}</div>}
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>ログ</div>
          <div style={{
            fontSize: 11, fontFamily: 'monospace', background: '#1e1e1e', color: '#0f0',
            padding: 8, borderRadius: 6, height: 280, overflow: 'auto', whiteSpace: 'pre-wrap',
          }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
