import { useRef, useState } from 'react'
import type { Pin, AppMode, CalibState } from '../../types'
import { readExifGPS } from '../../services/gps'
import { PIN_TYPE_DEFAULT_COLORS } from '../../types'
import { latLngToPx } from '../../features/calibration/transform'
import {
  photoReducer as _photoReducer,
  createPhotoEntry,
  STATUS_LABELS, STATUS_BADGE,
  type PhotoEntry, type PhotoAction,
} from '../../features/photos/photoStore'

// suppress unused import
void _photoReducer

interface Props {
  pins: Pin[]
  setPins: (p: Pin[] | ((prev: Pin[]) => Pin[])) => void
  canvasW: number; canvasH: number
  pageW?: number; pageH?: number
  useCalib: boolean
  calib: CalibState
  setStatusMsg: (m: string) => void
  mode: AppMode
  onStartManualPlace: (photo: { name: string; url: string; is360: boolean }) => void
  // 集中管理された写真ストア
  photos: PhotoEntry[]
  dispatchPhotos: (action: PhotoAction) => void
}

export function PhotosTab({
  pins, setPins, canvasW, canvasH, pageW, pageH,
  useCalib, calib,
  setStatusMsg, onStartManualPlace,
  photos, dispatchPhotos,
}: Props) {
  const [loadingState, setLoadingState]   = useState(false)
  const [progressState, setProgressState] = useState(0)
  const fileRef   = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  // Image座標のフォールバック中心値
  function centerPos() {
    const baseW = (pageW && pageW > 0) ? pageW : canvasW
    const baseH = (pageH && pageH > 0) ? pageH : canvasH
    return {
      x: baseW / 2 + (Math.random() - 0.5) * 100,
      y: baseH / 2 + (Math.random() - 0.5) * 100,
    }
  }

  async function handlePhotos(files: FileList | null) {
    if (!files?.length) return
    setLoadingState(true); setProgressState(0)
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'))
    const newEntries: PhotoEntry[] = []
    const newPins: Pin[] = []

    for (let i = 0; i < arr.length; i++) {
      const f = arr[i]
      const url = URL.createObjectURL(f)
      const gps = await readExifGPS(f)
      const is360 = /360|sphere|pano|panorama|equirect/i.test(f.name)
      setProgressState(Math.round((i + 1) / arr.length * 100))

      const entry = createPhotoEntry(f.name, url, !!gps, is360)

      if (gps) {
        // GPS座標 → Image座標変換
        let px: number, py: number
        const converted = (useCalib && calib.ready)
          ? latLngToPx(gps.lat, gps.lng, calib.points)
          : null

        if (converted) {
          px = converted.x
          py = converted.y
        } else {
          const c = centerPos()
          px = c.x
          py = c.y
        }

        const pinType = is360 ? '360' as const : 'photo' as const
        const pinId = 'p' + Date.now() + '_' + i
        const pin: Pin = {
          id: pinId, px, py, lat: gps.lat, lng: gps.lng,
          name: f.name.replace(/\.[^.]+$/, ''), memo: '', link: url,
          deg: 270, r: 10, al: 0,
          color: PIN_TYPE_DEFAULT_COLORS[pinType],
          src: 'gps', placedBy: 'gps',
          showArrow: false,
          photoFileName: f.name,
          media: { type: pinType, url },
        }
        newPins.push(pin)
        entry.status = 'gps'
        entry.pinId = pinId
      }
      newEntries.push(entry)
    }

    dispatchPhotos({ type: 'ADD_PHOTOS', photos: newEntries })
    if (newPins.length > 0) {
      setPins(prev => [...prev, ...newPins])
    }

    setLoadingState(false)
    const placed  = newEntries.filter(e => e.status === 'gps').length
    const unplaced = newEntries.filter(e => e.status === 'unplaced').length
    setStatusMsg(`写真取込: ${newEntries.length}件（GPS配置:${placed}件 / 未配置:${unplaced}件）`)
  }

  // ===== GPS位置を再計算 =====
  // キャリブ後に取り込み済みGPSピンの px/py を正しい座標に更新する
  function recalcGpsPins() {
    if (!useCalib || !calib.ready) {
      alert('キャリブレーションを先に完了してください。')
      return
    }
    let count = 0
    setPins(prev => prev.map(pin => {
      if (pin.src !== 'gps' || pin.lat == null || pin.lng == null) return pin
      const p = latLngToPx(pin.lat, pin.lng, calib.points)
      if (!p) return pin
      count++
      return { ...pin, px: p.x, py: p.y, moved: false }
    }))
    setStatusMsg(`GPS位置を再計算しました（${count}件更新）`)
  }

  // pins変化をphotoストアに反映（移動・手動配置後）
  const syncedPhotos = photos.map(entry => {
    const pin = pins.find(p => p.photoFileName === entry.fileName || p.name === entry.displayName)
    if (!pin) return entry
    let status = entry.status
    if (pin.moved) status = 'moved'
    else if (pin.placedBy === 'manual' && entry.status === 'unplaced') status = 'manual'
    else if (pin.src === 'gps' && entry.status === 'unplaced') status = 'gps'
    return { ...entry, status, pinId: pin.id }
  })

  const visiblePhotos = syncedPhotos.filter(e => e.status !== 'deleted')
  const stats = {
    gps:      visiblePhotos.filter(e => e.status === 'gps').length,
    manual:   visiblePhotos.filter(e => e.status === 'manual').length,
    moved:    visiblePhotos.filter(e => e.status === 'moved').length,
    unplaced: visiblePhotos.filter(e => e.status === 'unplaced').length,
  }

  const hasGpsPins = pins.some(p => p.src === 'gps' && p.lat != null)

  return (
    <div className="overflow-y-auto flex-1">
      <div className="section">
        <h4>STEP3 写真取込（GPS自動配置）</h4>
        <div className="info-blue mb-2 text-xs">
          GPS付き写真は図面上に自動配置。GPS無し写真は「手動配置」ボタンで手動配置できます。
        </div>
        <div className="flex gap-2 mb-2">
          <button className="btn flex-1 justify-center" onClick={() => folderRef.current?.click()}>📁 フォルダ</button>
          <button className="btn flex-1 justify-center" onClick={() => fileRef.current?.click()}>📷 写真選択</button>
        </div>
        <input ref={fileRef} id="toolbar-photo-input" type="file" accept="image/*" multiple className="hidden"
          onChange={e => handlePhotos(e.target.files)} />
        <input ref={folderRef} type="file" accept="image/*" multiple className="hidden"
          // @ts-ignore
          webkitdirectory="true"
          onChange={e => handlePhotos(e.target.files)} />

        {loadingState && (
          <div className="h-1.5 bg-gray-200 rounded overflow-hidden mb-2">
            <div className="h-full bg-[#1565C0] rounded transition-all" style={{ width: `${progressState}%` }} />
          </div>
        )}

        {/* GPS位置再計算ボタン */}
        {hasGpsPins && useCalib && (
          <button
            className="btn w-full justify-center mb-2 text-xs"
            style={calib.ready
              ? { background: '#E8F5E9', color: '#2E7D32', borderColor: '#A5D6A7' }
              : { background: '#F5F5F5', color: '#9E9E9E', borderColor: '#E0E0E0' }}
            onClick={recalcGpsPins}
            disabled={!calib.ready}
            title={calib.ready ? 'キャリブ完了済み — 再計算できます' : 'キャリブレーションを完了してから実行してください'}>
            📍 GPS位置を再計算{!calib.ready && '（キャリブ未完了）'}
          </button>
        )}

        {/* 統計 */}
        {visiblePhotos.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {stats.gps      > 0 && <span className="badge badge-green text-xs">GPS:{stats.gps}</span>}
            {stats.manual   > 0 && <span className="badge badge-blue  text-xs">手動:{stats.manual}</span>}
            {stats.moved    > 0 && <span className="badge badge-warn  text-xs">移動:{stats.moved}</span>}
            {stats.unplaced > 0 && <span className="badge badge-gray  text-xs">未配置:{stats.unplaced}</span>}
          </div>
        )}

        {/* 写真一覧 */}
        {visiblePhotos.length > 0 && (
          <div className="max-h-72 overflow-y-auto border border-gray-100 rounded">
            {visiblePhotos.map((entry, i) => (
              <div key={entry.fileName + i}
                className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-50 last:border-0 text-xs">
                <img src={entry.objectUrl} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0"
                  onError={e => (e.currentTarget.style.display='none')} />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">
                    {entry.is360 ? '🌐 ' : '📷 '}{entry.displayName}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`badge ${STATUS_BADGE[entry.status]} text-xs`}>
                      {STATUS_LABELS[entry.status]}
                    </span>
                    {!entry.hasGps && entry.status === 'unplaced' && (
                      <span className="text-gray-400 text-xs">GPS無</span>
                    )}
                  </div>
                </div>
                {/* 手動配置ボタン（未配置のみ） */}
                {entry.status === 'unplaced' && (
                  <button
                    className="flex-shrink-0 px-2 py-1 text-xs bg-[#1565C0] text-white rounded-lg hover:bg-[#0D47A1] font-semibold whitespace-nowrap"
                    onClick={() => onStartManualPlace({
                      name: entry.displayName,
                      url: entry.objectUrl,
                      is360: entry.is360,
                    })}>
                    {entry.is360 ? '🌐 配置' : '📷 配置'}
                  </button>
                )}
                {entry.status !== 'unplaced' && (
                  <span className="text-gray-300 flex-shrink-0">✓</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
