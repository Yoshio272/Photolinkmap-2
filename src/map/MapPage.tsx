/**
 * 地図モード Ver1.0 — ステップA：地図モードの土台
 *
 * ゴール: 写真を取り込むと、撮影位置が航空写真上にピンで出る。
 *
 * この段階で実装するもの:
 *   - 地図表示（地理院 航空写真）
 *   - 写真取込（複数）
 *   - GPS自動配置（EXIFにGPSがあれば撮影位置にピン）
 *   - GPS無しの手動配置（地図クリックで配置）
 *   - ピンのドラッグ移動（Leaflet標準機能）
 *   - 番号表示（取込順 ①②③…）
 *
 * 実装しないもの（B・Cで追加）:
 *   - ピンクリックのポップアップ（No/コメント/リンク）→ B
 *   - Box/Drive連携 → B
 *   - PDF出力・縮尺・北矢印・現場名・日本語フォント → C
 *
 * データは既存アプリ（pins/calib/プロジェクト）と完全に独立。
 * 認証情報のみ将来共有。EXIF抽出は既存 services/gps.ts を流用。
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { readExifGPS } from '../services/gps'
import { getStorageProvider, createDefaultStorageConfig } from '../services/storage'
import type { StorageConfig, StorageProviderType, StorageFile } from '../services/storage'
import type { GoogleDriveProvider } from '../services/storage/GoogleDriveProvider'

// 地理院 航空写真タイル（APIキー不要・商用可）
const GSI_PHOTO_URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'
const GSI_ATTR = "出典：<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank' rel='noopener'>国土地理院</a>"

// 地図モード専用のピン型（既存Pinとは独立）
interface MapPin {
  id: string
  no: number            // 表示番号（取込順）
  lat: number
  lng: number
  fileName: string
  photoDataUrl: string  // ローカルプレビュー（B-2でクラウドリンクに発展）
  hasGps: boolean       // GPS由来か手動配置か
  comment: string       // B-1：コメント（意味の層）
  cloudUrl?: string     // B-2：クラウド参照（外部の層）。B-1では未使用
}

// 外部スクリプト/CSS動的ロード（package.json不変）
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

// ファイル → DataURL（プレビュー用）
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

// ポップアップ内HTMLのエスケープ（コメント・ファイル名に使う）
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] || c))
}

export function MapPage() {
  const mapElRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new globalThis.Map()) // pinId → L.marker
  const [libReady, setLibReady] = useState(false)
  const [pins, setPins] = useState<MapPin[]>([])
  const [pendingManual, setPendingManual] = useState<{ fileName: string; photoDataUrl: string }[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const noCounterRef = useRef(0)

  // ===== 地図モード独自のストレージ設定（既存アプリとは別管理。方式1）=====
  // localStorageキーを既存と分けて独立性を保つ
  const MAP_STORAGE_KEY = 'photolinkmap_map_storage_config'
  const [storageConfig, setStorageConfig] = useState<StorageConfig>(() => {
    try {
      const saved = localStorage.getItem(MAP_STORAGE_KEY)
      if (saved) return JSON.parse(saved) as StorageConfig
    } catch { /* ignore */ }
    return createDefaultStorageConfig()
  })
  // 設定変更を永続化
  useEffect(() => {
    try { localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(storageConfig)) } catch { /* ignore */ }
  }, [storageConfig])

  const [syncStatus, setSyncStatus] = useState('')
  const [syncing, setSyncing] = useState(false)

  // ===== C-1：画像化（出力レイヤー全部込み）=====
  const captureContainerRef = useRef<HTMLDivElement>(null)
  const [siteName, setSiteName] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [captureLog, setCaptureLog] = useState('')
  // C-2：撮影時のピン画面座標と画像実寸（PDFリンク配置に使う）
  const captureMetaRef = useRef<{
    imgW: number; imgH: number
    pins: { id: string; no: number; xRatio: number; yRatio: number; cloudUrl?: string }[]
  } | null>(null)
  const [exporting, setExporting] = useState(false)

  // 手動配置待ちキューの先頭（地図クリックで配置する対象）
  const pendingHead = pendingManual[0] ?? null

  // ===== ライブラリ読込 → 地図初期化 =====
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')
      await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
      if (cancelled || !mapElRef.current) return
      const L = (window as any).L
      const map = L.map(mapElRef.current).setView([35.681236, 139.767125], 17)
      L.tileLayer(GSI_PHOTO_URL, {
        attribution: GSI_ATTR, maxZoom: 18, crossOrigin: 'anonymous',
      }).addTo(map)
      L.control.scale({ imperial: false }).addTo(map)
      mapRef.current = map
      setLibReady(true)
    })()
    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [])

  // ===== 番号付きピンアイコンを生成 =====
  const makeIcon = useCallback((no: number, hasGps: boolean) => {
    const L = (window as any).L
    const color = hasGps ? '#1D9E75' : '#E67E22' // GPS=緑, 手動=オレンジ
    return L.divIcon({
      className: 'map-pin-icon',
      html: `<div style="
        width:28px;height:28px;border-radius:50%;
        background:${color};border:2px solid white;
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
        display:flex;align-items:center;justify-content:center;
        color:white;font-weight:bold;font-size:13px;font-family:sans-serif;">${no}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    })
  }, [])

  // ===== ピンを地図に描画/更新 =====
  const renderMarker = useCallback((pin: MapPin) => {
    const L = (window as any).L
    const map = mapRef.current
    if (!map) return
    // 既存マーカーがあれば一度消す
    const old = markersRef.current.get(pin.id)
    if (old) { map.removeLayer(old); markersRef.current.delete(pin.id) }

    const marker = L.marker([pin.lat, pin.lng], {
      icon: makeIcon(pin.no, pin.hasGps),
      draggable: true, // Leaflet標準ドラッグ
    }).addTo(map)

    // ポップアップ（No・写真・コメント表示。編集はサイドパネルで）
    const commentHtml = pin.comment
      ? `<div style="margin-top:4px;font-size:12px;color:#333;white-space:pre-wrap;">${escapeHtml(pin.comment)}</div>`
      : `<div style="margin-top:4px;font-size:11px;color:#999;">コメントなし</div>`
    const linkHtml = pin.cloudUrl
      ? `<a href="${escapeHtml(pin.cloudUrl)}" target="_blank" rel="noopener" style="
          display:inline-block;margin-top:6px;padding:4px 10px;background:#1D9E75;color:white;
          border-radius:4px;font-size:12px;text-decoration:none;">写真を開く</a>`
      : `<div style="margin-top:6px;font-size:11px;color:#bbb;">クラウド未同期</div>`
    marker.bindPopup(`
      <div style="font-family:sans-serif;min-width:140px;">
        <div style="font-weight:bold;font-size:13px;">No.${pin.no}</div>
        <img src="${pin.photoDataUrl}" style="width:100%;max-height:120px;object-fit:cover;border-radius:4px;margin-top:4px;" />
        <div style="font-size:11px;color:#666;margin-top:4px;">${escapeHtml(pin.fileName)}</div>
        ${commentHtml}
        ${linkHtml}
      </div>
    `, { maxWidth: 200 })

    // クリックで選択状態に（サイドパネルで編集できるよう）
    marker.on('click', () => setSelectedId(pin.id))

    // ドラッグ終了で緯度経度を更新
    marker.on('dragend', () => {
      const ll = marker.getLatLng()
      setPins(prev => prev.map(p => p.id === pin.id ? { ...p, lat: ll.lat, lng: ll.lng } : p))
    })
    markersRef.current.set(pin.id, marker)
  }, [makeIcon])

  // pins変更時にマーカーを同期
  useEffect(() => {
    if (!libReady) return
    pins.forEach(renderMarker)
    // 削除されたピンのマーカーを掃除
    const map = mapRef.current
    const liveIds = new Set(pins.map(p => p.id))
    markersRef.current.forEach((marker, id) => {
      if (!liveIds.has(id)) { map?.removeLayer(marker); markersRef.current.delete(id) }
    })
  }, [pins, libReady, renderMarker])

  // ===== 写真取込 =====
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const newGpsPins: MapPin[] = []
    const newManual: { fileName: string; photoDataUrl: string }[] = []

    for (const file of Array.from(files)) {
      const [gps, dataUrl] = await Promise.all([readExifGPS(file), fileToDataUrl(file)])
      noCounterRef.current += 1
      const no = noCounterRef.current
      if (gps) {
        newGpsPins.push({
          id: `mp_${Date.now()}_${no}`, no,
          lat: gps.lat, lng: gps.lng,
          fileName: file.name, photoDataUrl: dataUrl, hasGps: true,
          comment: '',
        })
      } else {
        // GPS無し → 手動配置キューへ（番号は配置時に確定するので一旦戻す）
        noCounterRef.current -= 1
        newManual.push({ fileName: file.name, photoDataUrl: dataUrl })
      }
    }

    if (newGpsPins.length > 0) {
      setPins(prev => [...prev, ...newGpsPins])
      // GPS配置したピンが収まるよう地図をフィット
      const L = (window as any).L
      const map = mapRef.current
      if (map && newGpsPins.length > 0) {
        const bounds = L.latLngBounds(newGpsPins.map(p => [p.lat, p.lng]))
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18 })
      }
    }
    if (newManual.length > 0) setPendingManual(prev => [...prev, ...newManual])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ===== 地図クリックで手動配置 =====
  useEffect(() => {
    const map = mapRef.current
    if (!map || !libReady) return
    const onClick = (e: any) => {
      if (!pendingHead) return
      noCounterRef.current += 1
      const no = noCounterRef.current
      const newPin: MapPin = {
        id: `mp_${Date.now()}_${no}`, no,
        lat: e.latlng.lat, lng: e.latlng.lng,
        fileName: pendingHead.fileName, photoDataUrl: pendingHead.photoDataUrl,
        hasGps: false, comment: '',
      }
      setPins(prev => [...prev, newPin])
      setPendingManual(prev => prev.slice(1)) // キューの先頭を消化
    }
    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [pendingHead, libReady])

  function removePin(id: string) {
    setPins(prev => prev.filter(p => p.id !== id))
    setSelectedId(prev => prev === id ? null : prev)
  }

  function updateComment(id: string, comment: string) {
    setPins(prev => prev.map(p => p.id === id ? { ...p, comment } : p))
  }

  // ピン選択時：地図をそのピンへ寄せてポップアップを開く
  function focusPin(id: string) {
    setSelectedId(id)
    const marker = markersRef.current.get(id)
    const map = mapRef.current
    const pin = pins.find(p => p.id === id)
    if (marker && map && pin) {
      map.panTo([pin.lat, pin.lng])
      marker.openPopup()
    }
  }

  const selectedPin = pins.find(p => p.id === selectedId) ?? null

  // ===== クラウド同期（既存と同じ名前マッチング方式。両クラウド対応）=====
  async function syncCloud() {
    const provider = getStorageProvider(storageConfig.provider)
    const err = provider.validateConfig(storageConfig)
    if (err) { setSyncStatus('❌ ' + err); return }
    if (pins.length === 0) { setSyncStatus('先に写真を配置してください'); return }

    const folderId = storageConfig.provider === 'google-drive'
      ? storageConfig.googleDrive.folderId
      : (storageConfig.box.folderId ?? '')

    setSyncing(true)
    setSyncStatus('📂 クラウドのファイル一覧を取得中...')
    try {
      const result = await (provider as GoogleDriveProvider).listFiles(folderId, storageConfig)
      if (!result.success || !result.files?.length) {
        setSyncStatus('❌ ' + (result.error || 'ファイル取得失敗'))
        setSyncing(false)
        return
      }
      // ファイル名 → StorageFile のマップ
      const fileMap: Record<string, StorageFile> = {}
      result.files.forEach(f => { fileMap[f.name.toLowerCase()] = f })

      // デバッグ: 実際のファイル名を確認
      console.log('[同期] クラウド側ファイル名(先頭5件):', result.files.slice(0, 5).map(f => f.name))
      console.log('[同期] ピン側ファイル名:', pins.map(p => p.fileName))

      // マッチング集計を先に計算（setPinsの外で確定させる）
      let matched = 0, unmatched = 0
      const updatedPins = pins.map(pin => {
        const fn = pin.fileName.toLowerCase()
        const base = fn.replace(/\.[^.]+$/, '')
        const hit = fileMap[fn]
          ?? Object.values(fileMap).find(f => f.name.toLowerCase().replace(/\.[^.]+$/, '') === base)
        if (hit) { matched++; return { ...pin, cloudUrl: hit.viewUrl } }
        unmatched++; return pin
      })
      setPins(updatedPins)
      setSyncStatus(`✓ ${result.files.length}件取得 / マッチ:${matched}件 / 未一致:${unmatched}件`)
    } catch (e: unknown) {
      setSyncStatus('❌ ' + (e instanceof Error ? e.message : '接続エラー'))
    } finally {
      setSyncing(false)
    }
  }

  // ===== C-1：撮影コンテナをhtml2canvasで画像化 =====
  async function capturePreview() {
    const container = captureContainerRef.current
    const map = mapRef.current
    if (!container || !map) return
    setCapturing(true)
    setCaptureLog('画像化中...')
    setPreviewUrl(null)
    try {
      await loadScript('https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js')
      const html2canvas = (window as any).html2canvas
      if (!html2canvas) { setCaptureLog('html2canvas 読込失敗'); setCapturing(false); return }

      // タイル読込が落ち着くのを少し待つ
      await new Promise(r => setTimeout(r, 400))

      // 撮影直前にピンの画面座標を記録（コンテナ基準の比率で保持）
      const rect = container.getBoundingClientRect()
      const pinMeta = pins.map(pin => {
        // Leaflet：緯度経度 → コンテナ内ピクセル座標
        const pt = map.latLngToContainerPoint([pin.lat, pin.lng])
        return {
          id: pin.id, no: pin.no,
          xRatio: pt.x / rect.width,   // 0〜1（コンテナ幅に対する比率）
          yRatio: pt.y / rect.height,  // 0〜1（コンテナ高に対する比率）
          cloudUrl: pin.cloudUrl,
        }
      })

      const canvas: HTMLCanvasElement = await html2canvas(container, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        scale: 2, // 高解像度
        logging: false,
      })
      const url = canvas.toDataURL('image/png')
      setPreviewUrl(url)
      captureMetaRef.current = { imgW: canvas.width, imgH: canvas.height, pins: pinMeta }
      const linked = pinMeta.filter(p => p.cloudUrl).length
      setCaptureLog(`✓ 画像化成功（${canvas.width}×${canvas.height}px / リンク付きピン:${linked}件）`)
    } catch (e: unknown) {
      setCaptureLog('❌ ' + (e instanceof Error ? e.message : '画像化失敗'))
    } finally {
      setCapturing(false)
    }
  }

  // ===== C-2：画像＋ピンリンク注釈をA3横PDF化 =====
  async function exportPdf() {
    if (!previewUrl || !captureMetaRef.current) {
      setCaptureLog('先にプレビュー画像を生成してください')
      return
    }
    setExporting(true)
    try {
      const { PDFDocument, PDFString, PDFName } = await import('pdf-lib')
      const meta = captureMetaRef.current
      const pngBytes = await fetch(previewUrl).then(r => r.arrayBuffer())
      const pdf = await PDFDocument.create()
      const png = await pdf.embedPng(pngBytes)

      // A3横（842×1191pt の横向き = 1191×842）
      const pageW = 1191, pageH = 842
      const page = pdf.addPage([pageW, pageH])

      // 画像をページ全面に収める（アスペクト比保持）
      const margin = 20
      const maxW = pageW - margin * 2
      const maxH = pageH - margin * 2
      const scale = Math.min(maxW / png.width, maxH / png.height)
      const imgW = png.width * scale
      const imgH = png.height * scale
      const imgX = (pageW - imgW) / 2
      const imgY = (pageH - imgH) / 2
      page.drawImage(png, { x: imgX, y: imgY, width: imgW, height: imgH })

      // 各ピンの位置にリンク注釈（透明・約40px相当のヒットエリア）
      // 撮影時コンテナ幅に対する40pxの比率を、PDF上の画像幅に換算
      const containerW = captureContainerRef.current?.getBoundingClientRect().width ?? meta.imgW
      const hitRatio = 40 / containerW           // コンテナ上の40pxが画像幅に占める比率
      const half = Math.max(hitRatio * imgW, 12) / 2
      for (const p of meta.pins) {
        if (!p.cloudUrl) continue
        // 比率 → PDF座標。画像はimgX,imgYに配置、Y軸はPDFが下原点なので反転
        const cx = imgX + p.xRatio * imgW
        const cyTop = p.yRatio * imgH        // 画像上端からの距離
        const cy = imgY + imgH - cyTop       // PDF座標（下原点）に変換
        const annot = pdf.context.obj({
          Type: 'Annot', Subtype: 'Link',
          Rect: [cx - half, cy - half, cx + half, cy + half],
          Border: [0, 0, 0],
          A: { S: 'URI', URI: PDFString.of(p.cloudUrl) },
        })
        const ref = pdf.context.register(annot)
        const existing = page.node.get(PDFName.of('Annots'))
        if (existing && 'push' in existing) {
          (existing as { push: (r: typeof ref) => void }).push(ref)
        } else {
          page.node.set(PDFName.of('Annots'), pdf.context.obj([ref]))
        }
      }

      const bytes = await pdf.save()
      const blob = new Blob([bytes instanceof Uint8Array ? bytes.buffer as ArrayBuffer : bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${siteName || '現場位置図'}_位置図.pdf`
      a.click()
      URL.revokeObjectURL(url)
      const linked = meta.pins.filter(p => p.cloudUrl).length
      setCaptureLog(`✓ PDF出力完了（リンク付きピン:${linked}件）`)
    } catch (e: unknown) {
      setCaptureLog('❌ PDF生成エラー: ' + (e instanceof Error ? e.message : '失敗'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* 地図エリア */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* 撮影コンテナ：地図＋オーバーレイ（これをhtml2canvasで撮る）*/}
        <div ref={captureContainerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
          <div ref={mapElRef} style={{ width: '100%', height: '100%' }} />

          {/* オーバーレイ：現場名（左上）*/}
          {siteName && (
            <div style={{
              position: 'absolute', top: 12, left: 12, zIndex: 500,
              background: 'rgba(255,255,255,0.9)', padding: '6px 12px',
              borderRadius: 6, fontSize: 16, fontWeight: 700, color: '#222',
              boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            }}>
              {siteName}
            </div>
          )}

          {/* オーバーレイ：出力日（左上・現場名の下）*/}
          <div style={{
            position: 'absolute', top: siteName ? 48 : 12, left: 12, zIndex: 500,
            background: 'rgba(255,255,255,0.85)', padding: '3px 8px',
            borderRadius: 4, fontSize: 11, color: '#555',
          }}>
            出力日：{new Date().toLocaleDateString('ja-JP')}
          </div>

          {/* オーバーレイ：北矢印（右上）*/}
          <div style={{
            position: 'absolute', top: 12, right: 12, zIndex: 500,
            background: 'rgba(255,255,255,0.9)', width: 40, height: 48,
            borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ fontSize: 18, lineHeight: 1, color: '#c0392b' }}>▲</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#222' }}>N</div>
          </div>
        </div>

        {/* 手動配置の案内バナー（撮影コンテナの外＝画像には写らない）*/}
        {pendingHead && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, background: '#E67E22', color: 'white',
            padding: '8px 16px', borderRadius: 20, fontSize: 14, fontWeight: 600,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}>
            📍「{pendingHead.fileName}」に位置情報がありません。地図をクリックして配置してください
            （残り {pendingManual.length} 枚）
          </div>
        )}
      </div>

      {/* サイドパネル */}
      <div style={{ width: 320, padding: 16, borderLeft: '1px solid #ddd', overflow: 'auto', background: '#fafafa' }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>地図モード（撮影位置図）</h2>
        <p style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>
          写真を選ぶと、GPS情報から航空写真上に撮影位置が表示されます。
          GPSが無い写真は地図をクリックして配置します。
        </p>

        <input
          ref={fileInputRef} type="file" accept="image/*" multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!libReady}
          style={{
            width: '100%', padding: 12, fontSize: 15, fontWeight: 600,
            background: libReady ? '#1D9E75' : '#ccc', color: 'white',
            border: 'none', borderRadius: 8, cursor: libReady ? 'pointer' : 'default',
          }}
        >
          写真を選択
        </button>

        {/* ===== クラウド同期（B-2）===== */}
        <div style={{ marginTop: 16, padding: 12, background: 'white', border: '1px solid #e0e0e0', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>クラウド同期</div>
          <div style={{ fontSize: 11, color: '#777', marginBottom: 8, lineHeight: 1.5 }}>
            クラウドに保存済みの写真と、ファイル名で自動的にリンクを紐付けます。
          </div>

          {/* プロバイダ選択 */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['google-drive', 'box'] as StorageProviderType[]).map(p => (
              <button key={p}
                onClick={() => setStorageConfig({ ...storageConfig, provider: p })}
                style={{
                  flex: 1, padding: '6px', fontSize: 12, fontWeight: 600,
                  background: storageConfig.provider === p ? '#1D9E75' : '#f0f0f0',
                  color: storageConfig.provider === p ? 'white' : '#666',
                  border: 'none', borderRadius: 6, cursor: 'pointer',
                }}>
                {p === 'google-drive' ? 'Google Drive' : 'Box'}
              </button>
            ))}
          </div>

          {/* Google Drive 設定 */}
          {storageConfig.provider === 'google-drive' && (
            <div style={{ marginBottom: 8 }}>
              <input
                placeholder="GAS WebApp URL"
                value={storageConfig.googleDrive.webAppUrl}
                onChange={e => setStorageConfig({ ...storageConfig, googleDrive: { ...storageConfig.googleDrive, webAppUrl: e.target.value } })}
                style={{ width: '100%', boxSizing: 'border-box', padding: 6, fontSize: 11, fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: 4, marginBottom: 4 }}
              />
              <input
                placeholder="DriveフォルダID"
                value={storageConfig.googleDrive.folderId}
                onChange={e => setStorageConfig({ ...storageConfig, googleDrive: { ...storageConfig.googleDrive, folderId: e.target.value } })}
                style={{ width: '100%', boxSizing: 'border-box', padding: 6, fontSize: 11, fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: 4 }}
              />
            </div>
          )}

          {/* Box 設定 */}
          {storageConfig.provider === 'box' && (
            <div style={{ marginBottom: 8 }}>
              <input
                placeholder="BoxフォルダID"
                value={storageConfig.box.folderId ?? ''}
                onChange={e => setStorageConfig({ ...storageConfig, box: { ...storageConfig.box, folderId: e.target.value } })}
                style={{ width: '100%', boxSizing: 'border-box', padding: 6, fontSize: 11, fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: 4 }}
              />
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                {localStorage.getItem('box_access_token') ? '🟢 Boxサインイン済み' : '⚪ 未サインイン（メインアプリでBoxログインが必要）'}
              </div>
            </div>
          )}

          <button
            onClick={syncCloud}
            disabled={syncing || pins.length === 0}
            style={{
              width: '100%', padding: 8, fontSize: 13, fontWeight: 600,
              background: (syncing || pins.length === 0) ? '#ccc' : '#E0F5EC',
              color: (syncing || pins.length === 0) ? 'white' : '#0F6E56',
              border: '1px solid #5DCAA5', borderRadius: 6,
              cursor: (syncing || pins.length === 0) ? 'default' : 'pointer',
            }}>
            {syncing ? '⏳ 同期中...' : '🔄 クラウドと同期'}
          </button>
          {syncStatus && (
            <div style={{
              fontSize: 11, marginTop: 6,
              color: syncStatus.startsWith('✓') ? '#0F6E56' : syncStatus.startsWith('❌') ? '#c00' : '#777',
              fontWeight: syncStatus.startsWith('✓') ? 600 : 400,
            }}>{syncStatus}</div>
          )}
        </div>

        {/* ===== C-1：出力（プレビュー画像生成）===== */}
        <div style={{ marginTop: 16, padding: 12, background: 'white', border: '1px solid #e0e0e0', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>出力プレビュー</div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>現場名</label>
          <input
            value={siteName}
            onChange={e => setSiteName(e.target.value)}
            placeholder="例：○○新築工事"
            style={{ width: '100%', boxSizing: 'border-box', padding: 6, fontSize: 13, border: '1px solid #ccc', borderRadius: 4, marginBottom: 8 }}
          />
          <button
            onClick={capturePreview}
            disabled={capturing}
            style={{
              width: '100%', padding: 10, fontSize: 14, fontWeight: 600,
              background: capturing ? '#ccc' : '#1D9E75', color: 'white',
              border: 'none', borderRadius: 6, cursor: capturing ? 'default' : 'pointer',
            }}>
            {capturing ? '⏳ 画像化中...' : '🖼 プレビュー画像を生成'}
          </button>
          {captureLog && (
            <div style={{
              fontSize: 11, marginTop: 6,
              color: captureLog.startsWith('✓') ? '#0F6E56' : captureLog.startsWith('❌') ? '#c00' : '#777',
            }}>{captureLog}</div>
          )}
          {previewUrl && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>生成された画像：</div>
              <img src={previewUrl} alt="プレビュー" style={{ width: '100%', border: '1px solid #ddd', borderRadius: 4 }} />
              <button
                onClick={exportPdf}
                disabled={exporting}
                style={{
                  width: '100%', marginTop: 8, padding: 10, fontSize: 14, fontWeight: 600,
                  background: exporting ? '#ccc' : '#1565C0', color: 'white',
                  border: 'none', borderRadius: 6, cursor: exporting ? 'default' : 'pointer',
                }}>
                {exporting ? '⏳ PDF生成中...' : '📄 リンク付きPDFを出力（A3横）'}
              </button>
              <div style={{ fontSize: 10, color: '#999', marginTop: 4, lineHeight: 1.5 }}>
                ピン位置にクラウドへのリンクが埋め込まれます。クラウド未同期のピンはリンクなしになります。
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600 }}>
          配置済み: {pins.length} 件
        </div>

        {/* 選択中ピンの詳細＋コメント編集 */}
        {selectedPin && (
          <div style={{
            marginTop: 10, padding: 12, background: 'white',
            border: '2px solid #1D9E75', borderRadius: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{
                minWidth: 24, height: 24, borderRadius: '50%',
                background: selectedPin.hasGps ? '#1D9E75' : '#E67E22', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 'bold',
              }}>{selectedPin.no}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>No.{selectedPin.no} の詳細</div>
            </div>
            <img src={selectedPin.photoDataUrl} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 4 }} />
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{selectedPin.fileName}</div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginTop: 8, marginBottom: 4 }}>コメント</label>
            <textarea
              value={selectedPin.comment}
              onChange={e => updateComment(selectedPin.id, e.target.value)}
              placeholder="例：外壁東面のひび割れ確認"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', padding: 8, fontSize: 13,
                border: '1px solid #ccc', borderRadius: 6, resize: 'vertical', fontFamily: 'sans-serif',
              }}
            />
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          {pins.map(pin => (
            <div key={pin.id}
              onClick={() => focusPin(pin.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: 8, marginBottom: 6,
                background: pin.id === selectedId ? '#eafaf940' : 'white',
                border: pin.id === selectedId ? '2px solid #1D9E75' : '1px solid #eee',
                borderRadius: 6, cursor: 'pointer',
              }}>
              <div style={{
                minWidth: 24, height: 24, borderRadius: '50%',
                background: pin.hasGps ? '#1D9E75' : '#E67E22', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 'bold',
              }}>{pin.no}</div>
              <img src={pin.photoDataUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} />
              <div style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pin.fileName}
                <div style={{ color: '#999' }}>
                  {pin.hasGps ? 'GPS配置' : '手動配置'}{pin.comment ? '・コメント有' : ''}{pin.cloudUrl ? '・🔗' : ''}
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); removePin(pin.id) }}
                style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
