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
import type { CSSProperties } from 'react'
import { readExifGPS } from '../services/gps'
import { getStorageProvider, createDefaultStorageConfig } from '../services/storage'
import type { StorageConfig, StorageFile } from '../services/storage'
import type { GoogleDriveProvider } from '../services/storage/GoogleDriveProvider'
import { getPinPdfLinkUrl } from '../features/viewer/viewerTypes'
import { StorageSettingsButton } from '../components/Storage/StorageSettingsButton'
import {
  serializeProject, deserializeProject, saveProject, loadProject,
  listProjects, deleteProject, renameProject,
  rememberLastProject, getLastProjectName, type MapState, type MapProjectMeta,
} from '../features/mapProject'

// 地理院 航空写真タイル（APIキー不要・商用可）
const GSI_PHOTO_URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'
const GSI_ATTR = "出典：<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank' rel='noopener'>国土地理院</a>"

// 地図タイルの種類（すべて国土地理院・APIキー不要）
type BaseMapKey = 'photo' | 'std' | 'pale'
interface BaseMapDef { key: BaseMapKey; label: string; url: string; maxNativeZoom: number }
const BASE_MAPS: BaseMapDef[] = [
  { key: 'photo', label: '航空写真', url: GSI_PHOTO_URL, maxNativeZoom: 18 },
  { key: 'std',   label: '標準地図', url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',  maxNativeZoom: 18 },
  { key: 'pale',  label: '淡色地図', url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', maxNativeZoom: 18 },
]

// ヘッダーの未実装ボタン（地図モードでは保存系が未対応のためグレーアウト表示）
// 機能する保存系ボタン（図面モードのヘッダーと同じデザイン）
const mapToolbarBtnStyle: CSSProperties = {
  fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
  border: '1px solid #d1d5db', background: 'white', color: '#374151', cursor: 'pointer',
  whiteSpace: 'nowrap',
}

// 地図モード専用：通常写真をOpenSeadragonで開く /viewer?type=image URLを組み立てる
// （共通関数 getPinPdfLinkUrl は変更せず、表示先の切替を地図モードに閉じ込める）
function buildMapImageViewerUrl(
  fileId: string | undefined,
  title: string | undefined,
  provider: string,
  sharedUrl: string | undefined,
): string {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  const params = new URLSearchParams()
  params.set('type', 'image')
  if (fileId) params.set('fileId', fileId)
  if (title) params.set('title', title)
  if (sharedUrl) params.set('shared', sharedUrl)
  if (provider && provider !== 'google-drive') params.set('storageProvider', provider)
  return `${base}/viewer?${params.toString()}`
}

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
  cloudUrl?: string     // B-2：クラウド参照（外部の層）。360度はViewer URL、通常はviewUrl
  is360: boolean        // 360度写真か（アスペクト比2:1で判定）
  fileId?: string       // 同期時に取得するクラウドのファイルID
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

// 360度判定：画像のアスペクト比が2:1（equirectangular）かどうか
// THETA・Insta360等はファイル名に360を含まないため、アスペクト比で判定する
function detect360(dataUrl: string): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const ratio = img.width / img.height
      resolve(ratio >= 1.9 && ratio <= 2.1)
    }
    img.onerror = () => resolve(false)
    img.src = dataUrl
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
  const tileLayerRef = useRef<any>(null)                 // 現在のベースマップタイルレイヤー
  const [baseMap, setBaseMap] = useState<BaseMapKey>('photo') // 選択中の地図種類
  const [libReady, setLibReady] = useState(false)
  const [pins, setPins] = useState<MapPin[]>([])
  const [pendingManual, setPendingManual] = useState<{ fileName: string; photoDataUrl: string; is360: boolean }[]>([])
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
  const [projectName, setProjectName] = useState<string>('') // 現在開いているプロジェクト名（未保存は空）
  const [projectSaveStatus, setProjectSaveStatus] = useState('') // 保存結果メッセージ
  const [showManager, setShowManager] = useState(false) // プロジェクト管理モーダル
  const [projectList, setProjectList] = useState<MapProjectMeta[]>([]) // 保存済み一覧
  const [isDirty, setIsDirty] = useState(false) // 未保存の変更があるか
  const suppressDirtyRef = useRef(true) // 読込・保存・初期化中はdirtyを立てない
  const [lastProjectPrompt, setLastProjectPrompt] = useState<string | null>(null) // 起動時の前回案内
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [captureLog, setCaptureLog] = useState('')
  // C-2：撮影時のピン画面座標と画像実寸（PDFリンク配置に使う）
  const captureMetaRef = useRef<{
    imgW: number; imgH: number
    pins: { id: string; no: number; xRatio: number; yRatio: number; cloudUrl?: string }[]
  } | null>(null)
  const [exporting, setExporting] = useState(false)
  // 自前の縮尺バー（Leaflet control非依存でPDFに確実に写す）
  const [scaleBar, setScaleBar] = useState<{ label: string; widthPx: number } | null>(null)

  // ===== C-3a：図面オーバーレイ（半・地図連動モデル）=====
  // 図面は独立DOMレイヤー。アンカー緯度経度を持ち、地図のpan/zoomに追従する。
  const overlayElRef = useRef<HTMLDivElement>(null)   // 図面DOM要素
  const overlayImgRef = useRef<HTMLImageElement | null>(null)
  // 図面の状態（追従計算に必要な情報を最初から全部持つ）
  const overlayStateRef = useRef<{
    dataUrl: string
    imgW: number; imgH: number       // 元画像の実寸
    anchorLat: number; anchorLng: number  // 図面中心が対応する地図上の緯度経度
    baseZoom: number                 // 配置時の地図ズーム（scale補正の基準）
    baseFitScale: number             // 配置時の初期フィットスケール（100%の基準）
    userScale: number                // ユーザー微調整スケール（baseFitScale基準の倍率）
    userRotation: number             // 回転角°（-180〜180に正規化）
    opacity: number
  } | null>(null)
  const [overlayLoaded, setOverlayLoaded] = useState(false)
  const [overlayOpacity, setOverlayOpacity] = useState(50)  // %（UIと同期）
  const [overlayRotation, setOverlayRotation] = useState(0) // 度（UIと同期、0.5刻み）
  const [overlayScalePct, setOverlayScalePct] = useState(100) // %（ユーザー微調整スケール、UIと同期）
  const overlayFileInputRef = useRef<HTMLInputElement>(null)
  const [overlayLog, setOverlayLog] = useState('')
  const [shiftHeld, setShiftHeld] = useState(false) // Shiftキー押下中（カーソル表示用）

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
      // zoomControl:false で標準の左上ズームを無効化し、右上に再配置（方位マークの下）
      const map = L.map(mapElRef.current, { maxZoom: 21, zoomControl: false }).setView([35.681236, 139.767125], 18)
      const initialDef = BASE_MAPS.find(b => b.key === 'photo')!
      tileLayerRef.current = L.tileLayer(initialDef.url, {
        attribution: GSI_ATTR,
        maxNativeZoom: initialDef.maxNativeZoom, // 実タイルの上限
        maxZoom: 21,       // タイルを引き伸ばして21まで拡大表示
        crossOrigin: 'anonymous',
      }).addTo(map)
      L.control.zoom({ position: 'topright' }).addTo(map)
      // 縮尺バーはLeaflet controlを使わず自前DOMで描画（PDF再現性のため）
      // ズームコントロールを方位マーク（右上・高さ約60px）の下に押し下げる
      const zoomStyleId = 'map-zoom-position-style'
      if (!document.getElementById(zoomStyleId)) {
        const style = document.createElement('style')
        style.id = zoomStyleId
        style.textContent = `.leaflet-top.leaflet-right .leaflet-control-zoom { margin-top: 66px; }
.leaflet-control-attribution { margin-bottom: 13px !important; }
body.pdf-capturing .map-pin-number-text { transform: translateY(-8px); }
body.pdf-capturing .map-pin-badge-text { transform: translateY(-8px); }`
        document.head.appendChild(style)
      }
      mapRef.current = map
      setLibReady(true)
    })()
    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [])

  // ===== 番号付きピンアイコンを生成 =====
  const makeIcon = useCallback((no: number, hasGps: boolean, is360: boolean) => {
    const L = (window as any).L
    const color = hasGps ? '#1D9E75' : '#E67E22' // GPS=緑, 手動=オレンジ
    // 360度写真は枠を青系にして🌐バッジを付ける
    const border = is360 ? '#2196F3' : 'white'
    const badge = is360
      ? `<div class="map-pin-badge" style="position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;background:#2196F3;border:1.5px solid white;display:flex;align-items:center;justify-content:center;font-size:9px;"><span class="map-pin-badge-text" style="display:inline-block;">🌐</span></div>`
      : ''
    return L.divIcon({
      className: 'map-pin-icon',
      html: `<div style="position:relative;">
        <div class="map-pin-number" style="
          width:28px;height:28px;border-radius:50%;
          background:${color};border:2px solid ${border};
          box-shadow:0 1px 4px rgba(0,0,0,0.4);
          display:flex;align-items:center;justify-content:center;line-height:1;
          color:white;font-weight:bold;font-size:13px;font-family:sans-serif;"><span class="map-pin-number-text" style="display:inline-block;">${no}</span></div>
        ${badge}
      </div>`,
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
      icon: makeIcon(pin.no, pin.hasGps, pin.is360),
      draggable: true, // Leaflet標準ドラッグ
    }).addTo(map)

    // ポップアップ（No・写真・コメント表示。編集はサイドパネルで）
    const commentHtml = pin.comment
      ? `<div style="margin-top:4px;font-size:12px;color:#333;white-space:pre-wrap;">${escapeHtml(pin.comment)}</div>`
      : `<div style="margin-top:4px;font-size:11px;color:#999;">コメントなし</div>`
    const linkLabel = pin.is360 ? '🌐 360°ビューを開く' : '写真を開く'
    const linkHtml = pin.cloudUrl
      ? `<a href="${escapeHtml(pin.cloudUrl)}" target="_blank" rel="noopener" style="
          display:inline-block;margin-top:6px;padding:4px 10px;background:${pin.is360 ? '#2196F3' : '#1D9E75'};color:white;
          border-radius:4px;font-size:12px;text-decoration:none;">${linkLabel}</a>`
      : `<div style="margin-top:6px;font-size:11px;color:#bbb;">クラウド未同期</div>`
    const title360 = pin.is360 ? ' <span style="font-size:10px;color:#2196F3;">🌐360°</span>' : ''
    marker.bindPopup(`
      <div style="font-family:sans-serif;min-width:140px;">
        <div style="font-weight:bold;font-size:13px;">No.${pin.no}${title360}</div>
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
    const newManual: { fileName: string; photoDataUrl: string; is360: boolean }[] = []

    for (const file of Array.from(files)) {
      const [gps, dataUrl] = await Promise.all([readExifGPS(file), fileToDataUrl(file)])
      const is360 = await detect360(dataUrl)
      noCounterRef.current += 1
      const no = noCounterRef.current
      if (gps) {
        newGpsPins.push({
          id: `mp_${Date.now()}_${no}`, no,
          lat: gps.lat, lng: gps.lng,
          fileName: file.name, photoDataUrl: dataUrl, hasGps: true,
          comment: '', is360,
        })
      } else {
        // GPS無し → 手動配置キューへ（番号は配置時に確定するので一旦戻す）
        noCounterRef.current -= 1
        newManual.push({ fileName: file.name, photoDataUrl: dataUrl, is360 })
      }
    }

    if (newGpsPins.length > 0) {
      setPins(prev => [...prev, ...newGpsPins])
      // GPS配置したピンが収まるよう地図をフィット
      const L = (window as any).L
      const map = mapRef.current
      if (map && newGpsPins.length > 0) {
        const bounds = L.latLngBounds(newGpsPins.map(p => [p.lat, p.lng]))
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 20 })
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
        hasGps: false, comment: '', is360: pendingHead.is360,
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

      const isBox = storageConfig.provider === 'box'
      const boxToken = isBox ? (localStorage.getItem('box_access_token') ?? '') : ''

      // 各ピンをマッチング。360度はViewer URL生成（Boxは共有リンク取得も同期時に完結）
      let matched = 0, unmatched = 0, linked360 = 0
      const updatedPins: MapPin[] = []
      for (const pin of pins) {
        const fn = pin.fileName.toLowerCase()
        const base = fn.replace(/\.[^.]+$/, '')
        const hit = fileMap[fn]
          ?? Object.values(fileMap).find(f => f.name.toLowerCase().replace(/\.[^.]+$/, '') === base)
        if (!hit) { unmatched++; updatedPins.push(pin); continue }
        matched++

        // Boxの場合、共有リンク(download_url)を取得（360度・通常写真とも外部閲覧に必要）
        let sharedUrl: string | undefined
        if (isBox && boxToken) {
          try {
            const res = await fetch('/.netlify/functions/box-proxy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'create_shared_link', token: boxToken, fileId: hit.fileId }),
            })
            const data = await res.json() as { shared_link?: { download_url?: string } }
            if (data.shared_link?.download_url) sharedUrl = data.shared_link.download_url
          } catch { /* 共有リンク取得失敗時はsharedUrlなしで続行 */ }
        }

        let cloudUrl: string
        if (pin.is360) {
          // 360度 → Photo Sphere Viewer（既存の共通関数をそのまま利用）
          cloudUrl = getPinPdfLinkUrl(
            'photosphere', hit.fileId, hit.viewUrl, pin.fileName,
            pin.lat, pin.lng, storageConfig.provider, sharedUrl,
          )
          linked360++
        } else {
          // 通常写真 → OpenSeadragon（/viewer?type=image）
          // 共通関数は使わず、地図モード内でURLを組み立てる（表示先の切替を地図モードに閉じる）
          cloudUrl = buildMapImageViewerUrl(hit.fileId, pin.fileName, storageConfig.provider, sharedUrl)
        }
        updatedPins.push({ ...pin, cloudUrl, fileId: hit.fileId })
      }
      setPins(updatedPins)
      const s360 = linked360 > 0 ? ` / 360°:${linked360}件` : ''
      setSyncStatus(`✓ ${result.files.length}件取得 / マッチ:${matched}件 / 未一致:${unmatched}件${s360}`)
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

      // PDF（html2canvas）出力時のみ、ピン文字を8px上へ補正する。
      // 画面表示はflex中央のまま。html2canvasのflex中央ズレを撮影の瞬間だけ相殺する。
      document.body.classList.add('pdf-capturing')
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
      document.body.classList.remove('pdf-capturing')
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

  // ===== 地図タイルの切り替え（航空写真／標準地図／淡色地図）=====
  const switchBaseMap = useCallback((key: BaseMapKey) => {
    const map = mapRef.current
    const L = (window as any).L
    if (!map || !L) return
    const def = BASE_MAPS.find(b => b.key === key)
    if (!def) return
    // 既存タイルを外して新タイルを最背面に追加
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current)
    tileLayerRef.current = L.tileLayer(def.url, {
      attribution: GSI_ATTR,
      maxNativeZoom: def.maxNativeZoom,
      maxZoom: 21,
      crossOrigin: 'anonymous',
    }).addTo(map)
    tileLayerRef.current.bringToBack()
    setBaseMap(key)
  }, [])

  // ===== 自前の縮尺バー計算（Leaflet control非依存）=====
  // 画面上の実距離から、キリのいい距離に対応するバー長さ(px)を求める
  const updateScaleBar = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const size = map.getSize()
    const y = size.y / 2
    // 画面中央で水平100px離れた2点の実距離(m)
    const p1 = map.containerPointToLatLng([0, y])
    const p2 = map.containerPointToLatLng([100, y])
    const metersPer100px = map.distance(p1, p2)
    if (!isFinite(metersPer100px) || metersPer100px <= 0) return
    const metersPerPx = metersPer100px / 100
    // キリのいい距離候補から、60〜200pxに収まるものを選ぶ
    const niceMeters = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
    let chosen = niceMeters[0]
    for (const m of niceMeters) {
      const px = m / metersPerPx
      if (px >= 60 && px <= 200) { chosen = m; break }
      if (px > 200) break
      chosen = m
    }
    const widthPx = chosen / metersPerPx
    const label = chosen >= 1000 ? `${chosen / 1000} km` : `${chosen} m`
    setScaleBar({ label, widthPx })
  }, [])

  // ===== C-3a：図面オーバーレイ =====
  // 図面レイヤーのtransformを地図の現在状態に合わせて更新（追従の心臓部）
  // 図面はoverlayPane内に配置するため、layerPoint座標系で計算する
  // （overlayPaneはLeafletがpan時にtransformで動かすので、layerPoint基準なら追従する）
  const updateOverlayTransform = useCallback(() => {
    const map = mapRef.current
    const el = overlayElRef.current
    const st = overlayStateRef.current
    if (!map || !el || !st) return
    // アンカー緯度経度 → layerPoint（overlayPane基準の座標）
    const pt = map.latLngToLayerPoint([st.anchorLat, st.anchorLng])
    // ズーム差からスケール補正（地図を拡大すると図面も拡大）
    const zoomScale = Math.pow(2, map.getZoom() - st.baseZoom)
    // 実表示スケール = ズーム連動 × 初期フィット × ユーザー微調整
    const scale = zoomScale * st.baseFitScale * st.userScale
    // 図面はアンカー（中心）基準で配置。transform-origin=center で回転・拡大の基準点を固定
    el.style.left = `${pt.x}px`
    el.style.top = `${pt.y}px`
    el.style.transform =
      `translate(-50%, -50%) rotate(${st.userRotation}deg) scale(${scale})`
    el.style.transformOrigin = 'center center'
    el.style.opacity = String(st.opacity)
  }, [])

  // ファイル（PNG/JPG/PDF）→ 画像DataURLに統一
  async function fileToOverlayImage(file: File): Promise<{ dataUrl: string; w: number; h: number }> {
    const ext = file.name.toLowerCase()
    if (ext.endsWith('.pdf')) {
      // PDF → 1ページ目を画像化（既存PDF.js利用）
      // CAD系PDFはCIDフォントが壊れていることが多く、フォント処理で描画が落ちやすい。
      // オーバーレイ用途では図面の線・形状が見えれば十分なので、フォント処理を堅牢化する。
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()
      const cMapUrl = new URL('pdfjs-dist/cmaps/', import.meta.url).toString()
      const standardFontDataUrl = new URL('pdfjs-dist/standard_fonts/', import.meta.url).toString()
      const ab = await file.arrayBuffer()
      const doc = await pdfjsLib.getDocument({
        data: new Uint8Array(ab),
        cMapUrl, cMapPacked: true,
        standardFontDataUrl,
        disableFontFace: true,   // フォントをcanvas描画にフォールバック（壊れたCIDフォント対策）
        useSystemFonts: false,
        stopAtErrors: false,     // 一部エラーでも描画を続ける
      }).promise
      const page = await doc.getPage(1)
      const vp = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(vp.width)
      canvas.height = Math.round(vp.height)
      const ctx = canvas.getContext('2d')!
      // 白背景を敷く（透明だと重ねたとき見えにくいため）
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
      return { dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }
    }
    // PNG/JPG → そのまま
    const dataUrl = await fileToDataUrl(file)
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve({ w: 800, h: 600 })
      img.src = dataUrl
    })
    return { dataUrl, w: dims.w, h: dims.h }
  }

  async function handleOverlayFile(files: FileList | null) {
    if (!files || !files[0]) return
    const map = mapRef.current
    if (!map) return
    setOverlayLog('図面を読込中...')
    try {
      const { dataUrl, w, h } = await fileToOverlayImage(files[0])
      // 初期配置：図面の中心を現在の地図中心に、図面が地図幅の約60%に収まる初期スケール
      const center = map.getCenter()
      const mapSize = map.getSize()
      const baseFitScale = (mapSize.x * 0.6) / w
      overlayStateRef.current = {
        dataUrl, imgW: w, imgH: h,
        anchorLat: center.lat, anchorLng: center.lng,
        baseZoom: map.getZoom(),
        baseFitScale,
        userScale: 1,        // 100%
        userRotation: 0,
        opacity: overlayOpacity / 100,
      }
      setOverlayLoaded(true)
      setOverlayRotation(0)
      setOverlayScalePct(100)
      setOverlayLog('✓ 図面を配置しました。ドラッグで移動、Shift+ドラッグで回転できます')
      // DOM生成後、強制reflow + rAF2段で初回描画を確実化
      requestAnimationFrame(() => {
        const el = overlayElRef.current
        if (el) void el.offsetHeight // 強制reflow
        requestAnimationFrame(() => updateOverlayTransform())
      })
    } catch (e: unknown) {
      setOverlayLog('❌ ' + (e instanceof Error ? e.message : '読込失敗'))
    }
    if (overlayFileInputRef.current) overlayFileInputRef.current.value = ''
  }

  function removeOverlay() {
    overlayStateRef.current = null
    setOverlayLoaded(false)
    setOverlayLog('')
  }

  // ===== プロジェクト保存（Step2: 保存基盤モジュールへの接続）=====

  // 図面オーバーレイ画像を 200px 幅・JPEG品質0.6 のサムネイルに縮小
  async function makeThumbnail(): Promise<string | null> {
    const st = overlayStateRef.current
    if (!st?.dataUrl) return null
    return await new Promise<string | null>((resolve) => {
      const img = new Image()
      img.onload = () => {
        const w = 200
        const h = Math.round((img.naturalHeight / img.naturalWidth) * w)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        try { resolve(canvas.toDataURL('image/jpeg', 0.6)) } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = st.dataUrl
    })
  }

  // 図面画像を JPEG品質0.75 に再圧縮（保存容量を抑える。案W）
  async function compressOverlayDataUrl(dataUrl: string): Promise<string> {
    return await new Promise<string>((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        try { resolve(canvas.toDataURL('image/jpeg', 0.75)) } catch { resolve(dataUrl) }
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    })
  }

  // 現在の画面状態を MapState に集める（シリアライズの入力）
  async function collectMapState(): Promise<MapState> {
    const map = mapRef.current
    const center = map ? map.getCenter() : { lat: 35.681236, lng: 139.767125 }
    const zoom = map ? map.getZoom() : 18
    const st = overlayStateRef.current
    const thumbnail = await makeThumbnail()
    let overlay: MapState['overlay'] = null
    if (st) {
      const compressed = await compressOverlayDataUrl(st.dataUrl)
      overlay = {
        dataUrl: compressed, imgW: st.imgW, imgH: st.imgH,
        anchorLat: st.anchorLat, anchorLng: st.anchorLng,
        baseZoom: st.baseZoom, baseFitScale: st.baseFitScale,
        userScale: st.userScale, userRotation: st.userRotation, opacity: st.opacity,
      }
    }
    return {
      siteName,
      mapCenter: { lat: center.lat, lng: center.lng },
      mapZoom: zoom,
      baseMap,
      pins: pins.map(p => ({
        id: p.id, no: p.no, lat: p.lat, lng: p.lng, fileName: p.fileName,
        hasGps: p.hasGps, comment: p.comment, is360: p.is360,
        cloudUrl: p.cloudUrl, fileId: p.fileId,
      })),
      overlay,
      thumbnail,
    }
  }

  // 保存の共通処理（完全/フォールバックの結果をメッセージ表示）
  async function doSaveProject(name: string, createdAt?: string) {
    setProjectSaveStatus('保存中...')
    const state = await collectMapState()
    const project = serializeProject(state, name, { createdAt })
    const res = saveProject(project)
    if (res.ok && res.mode === 'full') {
      setProjectName(name)
      rememberLastProject(name)
      setIsDirty(false)
      setProjectSaveStatus(`✓ 「${name}」を保存しました`)
    } else if (res.ok && res.mode === 'fallback') {
      setProjectName(name)
      rememberLastProject(name)
      setIsDirty(false)
      setProjectSaveStatus(`✓ 「${name}」を保存しました（図面画像は容量超過のため位置情報のみ）`)
    } else {
      setProjectSaveStatus(`❌ 保存に失敗しました: ${res.error ?? ''}`)
    }
    setTimeout(() => setProjectSaveStatus(''), 4000)
  }

  // 上書き保存（未保存なら別名保存にフォールバック）
  async function handleSaveProject() {
    if (!projectName) { handleSaveAsProject(); return }
    const existing = loadProject(projectName)
    await doSaveProject(projectName, existing?.createdAt)
  }

  // 別名保存
  async function handleSaveAsProject() {
    const name = prompt('プロジェクト名を入力してください', projectName || siteName || '')
    if (!name) return
    await doSaveProject(name)
  }

  // プロジェクトを読み込んで画面状態に復元（Step3の管理モーダルから呼ぶ）
  function applyLoadedProject(name: string) {
    const project = loadProject(name)
    if (!project) { setProjectSaveStatus('❌ プロジェクトが見つかりません'); return }
    suppressDirtyRef.current = true // 読込中の変更でdirtyを立てない
    const state: MapState = deserializeProject(project)
    // 地図位置
    const map = mapRef.current
    if (map) map.setView([state.mapCenter.lat, state.mapCenter.lng], state.mapZoom)
    if (state.baseMap && state.baseMap !== baseMap) switchBaseMap(state.baseMap as BaseMapKey)
    // 現場名
    setSiteName(state.siteName)
    // ピン（写真プレビューは保存されていないので photoDataUrl は空）
    setPins(state.pins.map(p => ({
      id: p.id, no: p.no, lat: p.lat, lng: p.lng, fileName: p.fileName,
      photoDataUrl: '', hasGps: p.hasGps, comment: p.comment, is360: p.is360,
      cloudUrl: p.cloudUrl, fileId: p.fileId,
    })))
    // 図面オーバーレイ
    if (state.overlay && state.overlay.dataUrl) {
      overlayStateRef.current = {
        dataUrl: state.overlay.dataUrl, imgW: state.overlay.imgW, imgH: state.overlay.imgH,
        anchorLat: state.overlay.anchorLat, anchorLng: state.overlay.anchorLng,
        baseZoom: state.overlay.baseZoom, baseFitScale: state.overlay.baseFitScale,
        userScale: state.overlay.userScale, userRotation: state.overlay.userRotation,
        opacity: state.overlay.opacity,
      }
      setOverlayLoaded(true)
      setOverlayRotation(state.overlay.userRotation)
      setOverlayScalePct(Math.round(state.overlay.userScale * 100))
      setOverlayOpacity(Math.round(state.overlay.opacity * 100))
      requestAnimationFrame(() => updateOverlayTransform())
    } else {
      overlayStateRef.current = null
      setOverlayLoaded(false)
      if (state.overlay && !state.overlay.dataUrl) {
        setOverlayLog('※ この案件は図面画像が保存されていません（位置情報のみ）。図面を再読込してください')
      }
    }
    setProjectName(name)
    rememberLastProject(name)
    setProjectSaveStatus(`✓ 「${name}」を開きました`)
    setTimeout(() => setProjectSaveStatus(''), 3000)
    // 読込完了後、dirtyをリセットして監視を再開
    setIsDirty(false)
    setTimeout(() => { suppressDirtyRef.current = false }, 200)
  }

  // 管理モーダルを開く（一覧を読み込む）
  function openManager() {
    setProjectList(listProjects())
    setShowManager(true)
  }

  // 管理モーダルから開く
  function handleOpenProject(name: string) {
    if (isDirty && !confirm('保存していない変更があります。別のプロジェクトを開くと失われます。よろしいですか？')) {
      return
    }
    applyLoadedProject(name)
    setShowManager(false)
  }

  // 管理モーダルから削除
  function handleDeleteProject(name: string) {
    if (!confirm(`「${name}」を削除しますか？この操作は取り消せません。`)) return
    deleteProject(name)
    if (projectName === name) setProjectName('')
    setProjectList(listProjects())
  }

  // 管理モーダルからリネーム
  function handleRenameProject(oldName: string) {
    const newName = prompt('新しいプロジェクト名', oldName)
    if (!newName || newName === oldName) return
    const ok = renameProject(oldName, newName)
    if (!ok) { alert('その名前は既に使われています'); return }
    if (projectName === oldName) setProjectName(newName)
    setProjectList(listProjects())
  }

  // 新規プロジェクト（現在の内容をクリア）
  function handleNewProject() {
    // 未保存の変更がある場合は確認
    if (isDirty && !confirm('保存していない変更があります。新規プロジェクトを開始すると失われます。よろしいですか？')) {
      return
    }
    // 現在の内容をクリア
    suppressDirtyRef.current = true
    setPins([])
    overlayStateRef.current = null
    setOverlayLoaded(false)
    setOverlayLog('')
    setSiteName('')
    setProjectName('')
    setIsDirty(false)
    setProjectSaveStatus('新規プロジェクトを開始しました')
    setTimeout(() => setProjectSaveStatus(''), 3000)
    setTimeout(() => { suppressDirtyRef.current = false }, 100)
  }

  // 変更検出：主要stateが変わったら未保存(dirty)にする（読込・保存・初期化中は抑制）
  useEffect(() => {
    if (suppressDirtyRef.current) return
    setIsDirty(true)
  }, [pins, siteName, baseMap, overlayLoaded, overlayRotation, overlayScalePct, overlayOpacity])

  // 起動時：前回開いていたプロジェクト名があれば案内を出す（自動復元はしない）
  useEffect(() => {
    if (!libReady) return
    const last = getLastProjectName()
    if (last) {
      const exists = listProjects().some(p => p.name === last)
      if (exists) setLastProjectPrompt(last)
    }
    // 初期化完了後、dirty監視を有効化
    const t = setTimeout(() => { suppressDirtyRef.current = false }, 300)
    return () => clearTimeout(t)
  }, [libReady])

  // タブを閉じる・リロード時、未保存なら警告（ブラウザ標準ダイアログ）
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  // 地図のpan/zoomイベントで図面を追従させる
  useEffect(() => {
    const map = mapRef.current
    if (!map || !libReady) return
    // 図面追従(transform)は move で毎フレーム（DOM操作のみで軽い）
    // 縮尺バー更新は setState を伴うため moveend/zoomend のみ（パン中のカクつき防止）
    const followUpdate = () => updateOverlayTransform()
    const scaleUpdate = () => { updateOverlayTransform(); updateScaleBar() }
    updateScaleBar() // 初回計算
    map.on('move', followUpdate)
    map.on('moveend', scaleUpdate)
    map.on('zoom', followUpdate)
    map.on('zoomend', scaleUpdate)
    map.on('viewreset', scaleUpdate)
    return () => {
      map.off('move', followUpdate)
      map.off('moveend', scaleUpdate)
      map.off('zoom', followUpdate)
      map.off('zoomend', scaleUpdate)
      map.off('viewreset', scaleUpdate)
    }
  }, [libReady, updateOverlayTransform, updateScaleBar])

  // 図面オーバーレイのドラッグ（移動 or Shift+回転）
  useEffect(() => {
    const el = overlayElRef.current
    const map = mapRef.current
    if (!el || !map || !overlayLoaded) return

    let mode: 'none' | 'move' | 'rotate' = 'none'
    let startX = 0, startY = 0
    let startAnchorPt = { x: 0, y: 0 }
    // 回転用：開始時のマウス角度と、開始時の図面回転角
    let startMouseAngle = 0
    let startRotation = 0

    // アンカー中心からの角度（度）を求める
    const angleFromAnchor = (clientX: number, clientY: number): number => {
      const st = overlayStateRef.current
      if (!st) return 0
      const rect = el.getBoundingClientRect()
      // 要素の中心 = アンカー画面位置
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      return Math.atan2(clientY - cy, clientX - cx) * 180 / Math.PI
    }

    const onPointerDown = (e: PointerEvent) => {
      const st = overlayStateRef.current
      if (!st) return
      if (e.shiftKey) {
        // 回転モード：開始角度を記録
        mode = 'rotate'
        startMouseAngle = angleFromAnchor(e.clientX, e.clientY)
        startRotation = st.userRotation
      } else {
        // 移動モード
        mode = 'move'
        startX = e.clientX
        startY = e.clientY
        startAnchorPt = map.latLngToContainerPoint([st.anchorLat, st.anchorLng])
      }
      el.setPointerCapture(e.pointerId)
      e.preventDefault()
      e.stopPropagation()
    }

    const onPointerMove = (e: PointerEvent) => {
      const st = overlayStateRef.current
      if (!st || mode === 'none') return
      if (mode === 'move') {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        const newPt = { x: startAnchorPt.x + dx, y: startAnchorPt.y + dy }
        const ll = map.containerPointToLatLng([newPt.x, newPt.y])
        st.anchorLat = ll.lat
        st.anchorLng = ll.lng
        updateOverlayTransform()
      } else if (mode === 'rotate') {
        // 現在のマウス角度との差分を回転角に加算（連続角度で計算）
        const currentAngle = angleFromAnchor(e.clientX, e.clientY)
        let rot = startRotation + (currentAngle - startMouseAngle)
        // -180〜180に正規化
        while (rot > 180) rot -= 360
        while (rot < -180) rot += 360
        // 0.5°単位に丸めて適用
        rot = Math.round(rot * 2) / 2
        st.userRotation = rot
        updateOverlayTransform()
        setOverlayRotation(rot) // UI同期
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      mode = 'none'
      try { el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
    }
  }, [overlayLoaded, updateOverlayTransform])

  // Shiftキー押下状態を追跡（カーソル表示用）
  useEffect(() => {
    if (!overlayLoaded) return
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true) }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [overlayLoaded])

  // 回転スライダー → state反映
  useEffect(() => {
    const st = overlayStateRef.current
    if (st && st.userRotation !== overlayRotation) {
      st.userRotation = overlayRotation
      updateOverlayTransform()
    }
  }, [overlayRotation, updateOverlayTransform])

  // スケールスライダー → state反映
  useEffect(() => {
    const st = overlayStateRef.current
    if (st) {
      st.userScale = overlayScalePct / 100
      updateOverlayTransform()
    }
  }, [overlayScalePct, updateOverlayTransform])

  // リセット（回転・スケール・透明度を初期化、位置は保持）
  function resetOverlay() {
    const st = overlayStateRef.current
    if (!st) return
    st.userRotation = 0
    st.userScale = 1
    st.opacity = 1
    setOverlayRotation(0)
    setOverlayScalePct(100)
    setOverlayOpacity(100)
    updateOverlayTransform()
  }

  // 図面divをLeafletのoverlayPaneに移動（タイルの上・マーカーの下＝ピンが常に最前面）
  useEffect(() => {
    const map = mapRef.current
    const el = overlayElRef.current
    if (!map || !el || !overlayLoaded) return
    const overlayPane = map.getPanes().overlayPane
    if (overlayPane && el.parentElement !== overlayPane) {
      overlayPane.appendChild(el)
      // 移動後に再計算（位置合わせ）
      requestAnimationFrame(() => updateOverlayTransform())
    }
  }, [overlayLoaded, updateOverlayTransform])

  // 透明度スライダー → state反映
  useEffect(() => {
    const st = overlayStateRef.current
    if (st) { st.opacity = overlayOpacity / 100; updateOverlayTransform() }
  }, [overlayOpacity, updateOverlayTransform])

  // ④ Shift+ホイールで透明度変更（Shift中は地図ズームをキャンセル）
  useEffect(() => {
    const map = mapRef.current
    const container = mapElRef.current
    if (!map || !container || !overlayLoaded) return
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return // 通常ホイールは地図ズームに任せる
      // Shift押下中：地図ズームを止めて透明度を変更
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY < 0 ? 2 : -2 // 上で+2%、下で-2%
      setOverlayOpacity(prev => Math.max(0, Math.min(100, prev + delta)))
    }
    // captureフェーズでLeafletのズームより先に捕まえる
    container.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => container.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
  }, [overlayLoaded])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* ===== ヘッダー（図面モードと同じ見た目・案B）===== */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
        background: 'white', borderBottom: '1px solid #e5e7eb', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        flexWrap: 'wrap', flexShrink: 0,
      }}>
        {/* ロゴ */}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1565C0', marginRight: 4 }}>PhotoLinkMap</span>

        {/* 図面モードへ */}
        <a href="/"
          onClick={(e) => {
            if (isDirty && !confirm('保存していない変更があります。図面モードへ移動すると失われます。よろしいですか？')) {
              e.preventDefault()
            }
          }}
          style={{
            fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 4,
            background: '#1565C0', color: 'white', textDecoration: 'none', marginRight: 4,
          }}>📐 図面モードへ</a>

        {/* 地図種類の切り替え */}
        <div style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden', marginRight: 4 }}>
          {BASE_MAPS.map((b, i) => (
            <button key={b.key} onClick={() => switchBaseMap(b.key)}
              style={{
                fontSize: 12, fontWeight: 600, padding: '4px 10px', border: 'none', cursor: 'pointer',
                borderLeft: i === 0 ? 'none' : '1px solid #d1d5db',
                background: baseMap === b.key ? '#1D9E75' : 'white',
                color: baseMap === b.key ? 'white' : '#374151',
              }}>
              {b.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 4px' }} />

        {/* 保存先設定（共通コンポーネント）*/}
        <StorageSettingsButton storageConfig={storageConfig} setStorageConfig={setStorageConfig} />

        <div style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 4px' }} />

        {/* 保存系（地図モードでは未実装のためグレーアウト）*/}
        {/* 上書き保存・別名保存・管理・新規（すべて機能）*/}
        <button onClick={handleSaveProject} style={mapToolbarBtnStyle}>💾 上書き保存</button>
        <button onClick={handleSaveAsProject} style={mapToolbarBtnStyle}>📋 別名保存</button>
        <button onClick={openManager} style={mapToolbarBtnStyle}>📂 管理</button>
        <button onClick={handleNewProject} style={mapToolbarBtnStyle}>新規プロジェクト</button>
        {/* 現在のプロジェクト名 */}
        {projectName && <span style={{ fontSize: 12, color: '#6b7280' }}>{projectName}</span>}
        {isDirty && <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>● 未保存</span>}
        {/* 保存ステータス */}
        {projectSaveStatus && (
          <span style={{
            fontSize: 12, fontWeight: 600,
            color: projectSaveStatus.startsWith('✓') ? '#0F6E56' : projectSaveStatus.startsWith('❌') ? '#c00' : '#6b7280',
          }}>{projectSaveStatus}</span>
        )}
      </div>

      {/* 起動時：前回プロジェクトの案内バナー */}
      {lastProjectPrompt && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
          background: '#EEF6FF', borderBottom: '1px solid #cfe2ff', flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, color: '#1565C0' }}>
            前回のプロジェクト「<b>{lastProjectPrompt}</b>」があります
          </span>
          <button
            onClick={() => { applyLoadedProject(lastProjectPrompt); setLastProjectPrompt(null) }}
            style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 4, border: 'none', background: '#1565C0', color: 'white', cursor: 'pointer' }}>
            続きから開く
          </button>
          <button
            onClick={() => setLastProjectPrompt(null)}
            style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 4, border: '1px solid #ccc', background: 'white', color: '#555', cursor: 'pointer' }}>
            新規で始める
          </button>
        </div>
      )}

      {/* ===== 本体（地図エリア＋サイドバー）===== */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* 地図エリア */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* 撮影コンテナ：地図＋オーバーレイ（これをhtml2canvasで撮る）*/}
        <div ref={captureContainerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
          <div ref={mapElRef} style={{ width: '100%', height: '100%' }} />

          {/* C-3a：図面オーバーレイ（地図タイルの上、ピンより下）*/}
          {overlayLoaded && overlayStateRef.current && (
            <div
              ref={overlayElRef}
              style={{
                position: 'absolute',
                width: overlayStateRef.current.imgW,
                height: overlayStateRef.current.imgH,
                zIndex: 400,            // C3b-rotateと同じ値に戻す（切り分け）
                cursor: shiftHeld ? 'crosshair' : 'move',
                pointerEvents: 'auto',
                willChange: 'transform',
                userSelect: 'none',
              }}
            >
              <img
                ref={overlayImgRef}
                src={overlayStateRef.current.dataUrl}
                alt="図面オーバーレイ"
                draggable={false}
                onLoad={() => {
                  // 画像デコード完了後にtransform適用（初回paint確実化）
                  // rAF2段でレイアウト確定を待つ
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => updateOverlayTransform())
                  })
                }}
                style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
              />
            </div>
          )}

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

          {/* オーバーレイ：自前縮尺バー（左下・Leaflet非依存でPDFに確実に写る）*/}
          {scaleBar && (
            <div style={{
              position: 'absolute', bottom: 16, left: 12, zIndex: 500,
              background: 'rgba(255,255,255,0.85)', padding: '3px 6px', borderRadius: 4,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#222', marginBottom: 2 }}>{scaleBar.label}</div>
              <div style={{
                width: scaleBar.widthPx, height: 6,
                borderLeft: '2px solid #222', borderRight: '2px solid #222', borderBottom: '2px solid #222',
              }} />
            </div>
          )}
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
      <div style={{ width: 320, padding: 16, borderLeft: '1px solid #ddd', overflow: 'auto', background: '#fafafa', position: 'relative', zIndex: 5000 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>
          地図モード（撮影位置図）
        </h2>
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

        {/* ===== クラウド同期（B-2）：フォルダIDと同期ボタン。接続設定はヘッダーの「保存先設定」へ ===== */}
        <div style={{ marginTop: 16, padding: 12, background: 'white', border: '1px solid #e0e0e0', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>クラウド同期</div>
            <span style={{ fontSize: 11, color: '#0F6E56', fontWeight: 600 }}>
              {storageConfig.provider === 'google-drive' ? 'Google Drive' : 'Box'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#777', marginBottom: 8, lineHeight: 1.5 }}>
            クラウドに保存済みの写真と、ファイル名で自動的にリンクを紐付けます。接続設定はヘッダーの「📁 保存先設定」から。
          </div>

          {/* ルートフォルダID（現場ごとに変えるのでサイドバーに残す）*/}
          {storageConfig.provider === 'google-drive' ? (
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>DriveフォルダID</label>
              <input
                placeholder="DriveフォルダID"
                value={storageConfig.googleDrive.folderId}
                onChange={e => setStorageConfig({ ...storageConfig, googleDrive: { ...storageConfig.googleDrive, folderId: e.target.value } })}
                style={{ width: '100%', boxSizing: 'border-box', padding: 6, fontSize: 11, fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: 4 }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>BoxフォルダID</label>
              <input
                placeholder="BoxフォルダID"
                value={storageConfig.box.folderId ?? ''}
                onChange={e => setStorageConfig({ ...storageConfig, box: { ...storageConfig.box, folderId: e.target.value } })}
                style={{ width: '100%', boxSizing: 'border-box', padding: 6, fontSize: 11, fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: 4 }}
              />
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                {localStorage.getItem('box_access_token') ? '🟢 Boxサインイン済み' : '⚪ 未サインイン（保存先設定でBoxログインが必要）'}
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

        {/* ===== C-3a：図面オーバーレイ ===== */}
        <div style={{ marginTop: 16, padding: 12, background: 'white', border: '1px solid #e0e0e0', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>図面オーバーレイ</div>
          <div style={{ fontSize: 11, color: '#777', marginBottom: 8, lineHeight: 1.5 }}>
            図面を航空写真に半透明で重ねます。読み込んだ後、図面をドラッグして位置を合わせてください。
          </div>
          <input
            ref={overlayFileInputRef} type="file" accept="image/*,.pdf"
            style={{ display: 'none' }}
            onChange={e => handleOverlayFile(e.target.files)}
          />
          {!overlayLoaded ? (
            <button
              onClick={() => overlayFileInputRef.current?.click()}
              disabled={!libReady}
              style={{
                width: '100%', padding: 10, fontSize: 14, fontWeight: 600,
                background: libReady ? '#7E57C2' : '#ccc', color: 'white',
                border: 'none', borderRadius: 6, cursor: libReady ? 'pointer' : 'default',
              }}>
              📐 図面を読み込む（PDF / 画像）
            </button>
          ) : (
            <>
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  スケール：{overlayScalePct}%
                </label>
                <input
                  type="range" min={20} max={300} value={overlayScalePct}
                  onChange={e => setOverlayScalePct(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  回転：{overlayRotation.toFixed(1)}°
                </label>
                <input
                  type="range" min={-180} max={180} step={0.5} value={overlayRotation}
                  onChange={e => setOverlayRotation(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  透明度：{overlayOpacity}%
                </label>
                <input
                  type="range" min={0} max={100} value={overlayOpacity}
                  onChange={e => setOverlayOpacity(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ fontSize: 10, color: '#999', marginBottom: 8, lineHeight: 1.5 }}>
                💡 図面をドラッグで移動、Shift+ドラッグで回転（0.5°単位）<br />
                💡 Shift+マウスホイールで透明度を変更
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={resetOverlay}
                  style={{
                    flex: 1, padding: 8, fontSize: 12, fontWeight: 600,
                    background: '#f0f0f0', color: '#555', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer',
                  }}>
                  リセット
                </button>
                <button
                  onClick={removeOverlay}
                  style={{
                    flex: 1, padding: 8, fontSize: 12, fontWeight: 600,
                    background: '#fff', color: '#c00', border: '1px solid #e0a0a0', borderRadius: 6, cursor: 'pointer',
                  }}>
                  図面を削除
                </button>
              </div>
            </>
          )}
          {overlayLog && (
            <div style={{
              fontSize: 11, marginTop: 6,
              color: overlayLog.startsWith('✓') ? '#0F6E56' : overlayLog.startsWith('❌') ? '#c00' : '#777',
            }}>{overlayLog}</div>
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
                  {pin.hasGps ? 'GPS配置' : '手動配置'}{pin.is360 ? '・🌐360°' : ''}{pin.comment ? '・コメント有' : ''}{pin.cloudUrl ? '・🔗' : ''}
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); removePin(pin.id) }}
                style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>
      </div>
      </div>

      {/* ===== プロジェクト管理モーダル ===== */}
      {showManager && (
        <div
          onClick={() => setShowManager(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 10, width: 560, maxWidth: '95vw', maxHeight: '85vh',
              display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>📂 プロジェクト管理</h3>
              <button onClick={() => setShowManager(false)}
                style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#666', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ overflow: 'auto', flex: 1, padding: 14 }}>
              {projectList.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#999', padding: '40px 0', fontSize: 13 }}>
                  保存済みのプロジェクトはありません。<br />「別名保存」で現在の作業を保存できます。
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {projectList.map(meta => (
                    <div key={meta.name}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: 10,
                        border: '1px solid #e5e7eb', borderRadius: 8,
                        background: meta.name === projectName ? '#E0F5EC' : 'white',
                      }}>
                      {/* サムネイル */}
                      <div style={{ width: 64, height: 48, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {meta.thumbnail
                          ? <img src={meta.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 20, color: '#ccc' }}>📄</span>}
                      </div>
                      {/* 情報 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {meta.name}
                          {meta.name === projectName && <span style={{ fontSize: 10, color: '#0F6E56', marginLeft: 6 }}>開いています</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                          ピン{meta.pinCount}件{meta.hasOverlay ? '・図面あり' : ''}・{new Date(meta.updatedAt).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      {/* 操作 */}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button onClick={() => handleOpenProject(meta.name)}
                          style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#1D9E75', color: 'white', cursor: 'pointer' }}>開く</button>
                        <button onClick={() => handleRenameProject(meta.name)}
                          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', background: 'white', color: '#555', cursor: 'pointer' }}>名前</button>
                        <button onClick={() => handleDeleteProject(meta.name)}
                          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #e0a0a0', background: 'white', color: '#c00', cursor: 'pointer' }}>削除</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '10px 18px', borderTop: '1px solid #e5e7eb', textAlign: 'right' }}>
              <button onClick={() => setShowManager(false)}
                style={{ fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 6, background: '#f0f0f0', color: '#555', border: '1px solid #ccc', cursor: 'pointer' }}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
