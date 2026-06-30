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
  photoDataUrl: string  // ローカルプレビュー（Bでクラウドリンクに発展）
  hasGps: boolean       // GPS由来か手動配置か
  comment?: string      // Bで使用
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

export function MapPage() {
  const mapElRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new globalThis.Map()) // pinId → L.marker
  const [libReady, setLibReady] = useState(false)
  const [pins, setPins] = useState<MapPin[]>([])
  const [pendingManual, setPendingManual] = useState<{ fileName: string; photoDataUrl: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const noCounterRef = useRef(0)

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
        hasGps: false,
      }
      setPins(prev => [...prev, newPin])
      setPendingManual(prev => prev.slice(1)) // キューの先頭を消化
    }
    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [pendingHead, libReady])

  function removePin(id: string) {
    setPins(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* 地図 */}
      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={mapElRef} style={{ width: '100%', height: '100%' }} />
        {/* 手動配置の案内バナー */}
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

        <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600 }}>
          配置済み: {pins.length} 件
        </div>

        <div style={{ marginTop: 8 }}>
          {pins.map(pin => (
            <div key={pin.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: 8, marginBottom: 6, background: 'white',
              border: '1px solid #eee', borderRadius: 6,
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
                <div style={{ color: '#999' }}>{pin.hasGps ? 'GPS配置' : '手動配置'}</div>
              </div>
              <button onClick={() => removePin(pin.id)}
                style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
