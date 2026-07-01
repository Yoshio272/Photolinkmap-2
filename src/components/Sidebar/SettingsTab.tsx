import { useState, useRef } from 'react'
import type { StyleConfig } from '../../types'
import type { StorageConfig } from '../../services/storage'
import type { BackgroundSource } from '../../services/background'
import { loadBackgroundFile } from '../../services/background'
import { parseLatLng } from '../../features/calibration/transform'
import { StorageSettingsPanel } from '../Storage/StorageSettingsPanel'

interface Props {
  style: StyleConfig; setStyle: (s: StyleConfig) => void
  storageConfig: StorageConfig; setStorageConfig: (c: StorageConfig) => void
  pdfLoaded: boolean
  bgSource: BackgroundSource | null
  onBgLoaded: (source: BackgroundSource) => void
  useCalib: boolean
  setUseCalib: (v: boolean) => void
  calib: import('../../types').CalibState
  setCalib: (c: import('../../types').CalibState | ((p: import('../../types').CalibState) => import('../../types').CalibState)) => void
}

const PIN_COLORS = [
  { c: '#1565C0', label: '青' }, { c: '#E53935', label: '赤' },
  { c: '#2E7D32', label: '緑' }, { c: '#F57F17', label: '黄' },
  { c: '#6A1B9A', label: '紫' }, { c: '#333333', label: '黒' },
]

export function SettingsTab({
  style, setStyle, storageConfig, setStorageConfig, pdfLoaded, onBgLoaded,
  useCalib, setUseCalib, calib, setCalib,
}: Props) {
  const [bgLoading, setBgLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ===== 図面読込 =====
  async function handleBgFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setBgLoading(true)
    try { onBgLoaded(await loadBackgroundFile(file)) }
    catch (err: unknown) { alert(err instanceof Error ? err.message : '読み込みに失敗しました') }
    finally { setBgLoading(false); e.target.value = '' }
  }

  // ===== キャリブレーション =====

  return (
    <div className="overflow-y-auto flex-1">
      {/* STEP1 */}
      <div className="section">
        <h4>STEP1 図面読込</h4>
        <div className="info-blue mb-2 text-xs">PDF・JPEG・PNG に対応。Google Mapsのスクリーンショットも使えます。</div>
        <button className="btn w-full justify-center mb-1.5 font-semibold"
          style={{ background: '#1565C0', color: '#fff', borderColor: '#1565C0' }}
          onClick={() => fileRef.current?.click()} disabled={bgLoading}>
          {bgLoading ? '読み込み中...' : '📄 図面を読み込む（PDF / JPG / PNG）'}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png" className="hidden" onChange={handleBgFile} />
        {pdfLoaded && <div className="text-xs text-green-600 font-semibold mt-1">✓ 読込済み</div>}
      </div>


      {/* キャリブレーション（選択制） */}
      <div className="section">
        <h4>キャリブレーション（オプション）</h4>
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" checked={useCalib}
            onChange={e => setUseCalib(e.target.checked)}
            className="accent-[#1565C0] w-4 h-4" />
          <span className="text-xs font-semibold text-gray-700">キャリブレーションを使用する</span>
        </label>
        <div className="text-xs text-gray-400 mb-2">
          Google Maps座標（緯度経度）と連携したい場合のみONにしてください。
          OFFでも写真配置・360度配置・PDF出力は全て利用できます。
        </div>

        {useCalib && (
          <CalibSection calib={calib} setCalib={setCalib} pdfLoaded={pdfLoaded} />
        )}
      </div>

            {/* ピンスタイル */}
      <div className="section">
        <h4>ピンスタイル</h4>
        <div className="flex gap-2 mb-3">
          {PIN_COLORS.map(({ c, label }) => (
            <button key={c} title={label} className="w-6 h-6 rounded-full border-2 transition-all"
              style={{ background: c, borderColor: style.pinColor === c ? '#000' : 'transparent' }}
              onClick={() => setStyle({ ...style, pinColor: c })} />
          ))}
        </div>
        <div className="label">丸サイズ: {style.pinSize}</div>
        <input type="range" min={6} max={20} value={style.pinSize} className="w-full mb-2"
          onChange={e => setStyle({ ...style, pinSize: Number(e.target.value) })} />
        <div className="label">矢印の長さ: {style.arrowLength}</div>
        <input type="range" min={0} max={60} value={style.arrowLength} className="w-full"
          onChange={e => setStyle({ ...style, arrowLength: Number(e.target.value) })} />
      </div>

      {/* ストレージ設定（共通コンポーネントに移設。実装は StorageSettingsPanel に一元化）*/}
      <StorageSettingsPanel storageConfig={storageConfig} setStorageConfig={setStorageConfig} />
    </div>
  )
}



// ===== キャリブレーション基準点設定（useCalib=ON時のみ表示）=====
function CalibSection({ calib, setCalib, pdfLoaded }: {
  calib: import('../../types').CalibState
  setCalib: (c: import('../../types').CalibState | ((p: import('../../types').CalibState) => import('../../types').CalibState)) => void
  pdfLoaded: boolean
}) {
  const [ll1, setLl1] = useState('')
  const [ll2, setLl2] = useState('')

  function confirm(n: 1 | 2) {
    const val = n === 1 ? ll1 : ll2
    const parsed = parseLatLng(val)
    if (!parsed) { alert('緯度経度を正しく入力してください\n例: 35.1234, 135.5678'); return }
    const pts = calib.points
    if (!pts[n - 1]) { alert('先に図面上の基準点をクリックしてください（現在この機能は図面クリックに未対応のため、座標手入力で設定します）'); return }
    if (n === 1) {
      setCalib(prev => ({ ...prev, points: [{ ...prev.points[0], lat: parsed.lat, lng: parsed.lng }, ...prev.points.slice(1)], step: 2 as 1|2 }))
    } else {
      const a = { ...pts[0] }, b = { ...pts[1], lat: parsed.lat, lng: parsed.lng }
      setCalib({ points: [a, b], step: 2, ready: true })
    }
  }

  if (!pdfLoaded) {
    return <div className="info-warn text-xs">先に図面を読み込んでください</div>
  }

  return (
    <div className="p-2 rounded-lg bg-gray-50 border border-gray-200 text-xs space-y-2">
      <div className="text-gray-600">
        基準点1・2を設定するとGoogle Maps座標との変換が有効になります。
      </div>
      <div>
        <div className="label">基準点1 緯度経度</div>
        <input className="input mb-1" placeholder="35.1234, 135.5678"
          value={ll1} onChange={e => setLl1(e.target.value)} />
        <button className="btn btn-sm" onClick={() => confirm(1)}>確定</button>
      </div>
      <div>
        <div className="label">基準点2 緯度経度</div>
        <input className="input mb-1" placeholder="35.1240, 135.5690"
          value={ll2} onChange={e => setLl2(e.target.value)} />
        <button className="btn btn-sm" onClick={() => confirm(2)}>確定</button>
      </div>
      <div className={calib.ready ? 'text-green-600 font-semibold' : 'text-gray-400'}>
        {calib.ready ? '✓ キャリブレーション完了' : '未設定'}
      </div>
    </div>
  )
}
