import type { Pin } from '../../types'
import { getPinType, PIN_TYPE_LABELS, PIN_TYPE_ICONS, PIN_TYPE_DEFAULT_COLORS } from '../../types'
import type { PinType } from '../../types'
import { ARROW_DIRS, NO_ARROW } from '../../features/arrow'

interface Props {
  pins: Pin[]; selectedPinId: string | null
  onSelectPin: (id: string) => void
  onUpdatePin: (id: string, u: Partial<Pin>) => void
  onDeletePin: (id: string) => void
  setPins: (p: Pin[] | ((prev: Pin[]) => Pin[])) => void
  onOpen360: (pin: Pin) => void
}

const PIN_TYPES: PinType[] = ['photo', '360', 'location']

export function PlacementTab({ pins, selectedPinId, onSelectPin, onUpdatePin, onDeletePin, setPins, onOpen360 }: Props) {
  const selected = pins.find(p => p.id === selectedPinId)
  const selType = selected ? getPinType(selected) : 'photo'

  function setType(pin: Pin, type: PinType) {
    const m3 = { ...(pin.media ?? {}), type }
    onUpdatePin(pin.id, { color: PIN_TYPE_DEFAULT_COLORS[type], media: m3 })
  }

  function setMediaUrl(pin: Pin, url: string) {
    const m = { ...(pin.media ?? {}), type: (pin.media?.type ?? 'photo') as PinType, url }
    onUpdatePin(pin.id, { link: url, media: m })
  }

  function setMediaTitle(pin: Pin, title: string) {
    const m2 = { ...(pin.media ?? {}), type: (pin.media?.type ?? 'photo') as PinType, title }
    onUpdatePin(pin.id, { name: title, media: m2 })
  }

  return (
    <div className="flex flex-col overflow-hidden flex-1 min-h-0">
      {/* ヘッダー */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <span className="text-sm font-semibold">STEP4 配置調整</span>
        <span className="badge badge-blue">{pins.length}件</span>
        <div className="flex gap-1 ml-1">
          {PIN_TYPES.map(t => (
            <span key={t} className="text-xs text-gray-400">{PIN_TYPE_ICONS[t]}{pins.filter(p => getPinType(p) === t).length}</span>
          ))}
        </div>
        <button className="ml-auto text-xs text-red-400 hover:text-red-600"
          onClick={() => { if (confirm('全ピンを削除しますか？')) setPins([]) }}>全削除</button>
      </div>

      {/* ピン一覧 */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2">
        {!pins.length ? (
          <div className="text-xs text-gray-400 text-center py-8">
            配置データなし<br />写真取込またはクリックで追加
          </div>
        ) : pins.map((p, i) => {
          const type = getPinType(p)
          return (
            <div key={p.id}
              className={`p-2 rounded-lg border mb-1.5 text-xs cursor-pointer transition-colors ${selectedPinId === p.id ? 'border-[#1565C0] bg-[#E3EDFB]' : 'border-gray-200 hover:border-[#1565C0]'}`}
              onClick={() => onSelectPin(p.id)}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-base">{PIN_TYPE_ICONS[type]}</span>
                <span className="text-gray-400 min-w-[18px]">{i + 1}</span>
                <span className="font-semibold flex-1 truncate">{p.name}</span>
                <span className={`badge text-xs ${type === '360' ? 'badge-green' : type === 'location' ? '' : p.src === 'gps' ? 'badge-green' : 'badge-gray'}`}>
                  {PIN_TYPE_LABELS[type]}
                </span>
                {p.link && type !== 'location' && <span className="badge badge-blue">🔗</span>}
              </div>
              <div className="text-gray-400">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</div>
              {type === '360' && p.link && (
                <button
                  className="text-[#1D9E75] hover:underline flex items-center gap-1 mt-0.5 text-xs font-semibold"
                  onClick={e => { e.stopPropagation(); onOpen360(p) }}>
                  🌐 360度ビューワーで開く
                </button>
              )}
              {type === 'photo' && p.link && (
                <a href={p.link} target="_blank" rel="noopener noreferrer"
                  className="text-[#1565C0] hover:underline flex items-center gap-1 mt-0.5 text-xs"
                  onClick={e => e.stopPropagation()}>📷 写真を開く</a>
              )}
            </div>
          )
        })}
      </div>

      {/* 詳細編集 */}
      {selected && (
        <div className="border-t border-gray-200 bg-gray-50 p-3 flex-shrink-0 overflow-y-auto max-h-[55vh]">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">詳細編集</div>

          {/* ピン種別 */}
          <div className="label mb-1">ピン種別</div>
          <div className="flex gap-1 mb-3">
            {PIN_TYPES.map(t => (
              <button key={t} onClick={() => setType(selected, t)}
                className={`flex-1 py-1.5 text-xs rounded-lg border transition-all font-semibold flex items-center justify-center gap-1 ${
                  selType === t ? 'border-[#1565C0] bg-[#1565C0] text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-[#1565C0]'
                }`}>
                <span>{PIN_TYPE_ICONS[t]}</span>
                <span className="hidden sm:inline">{PIN_TYPE_LABELS[t]}</span>
              </button>
            ))}
          </div>

          {/* 名称 */}
          <div className="label">名称・タイトル</div>
          <input className="input mb-2" value={selected.name}
            onChange={e => setMediaTitle(selected, e.target.value)} />

          {/* メモ */}
          <div className="label">メモ</div>
          <textarea className="input mb-2 resize-none" rows={2} value={selected.memo}
            onChange={e => onUpdatePin(selected.id, { memo: e.target.value })} />

          {/* URLリンク */}
          {selType !== 'location' && (
            <>
              <div className="label">
                {selType === '360' ? '🌐 360度写真 URL' : '📷 写真 URL'}
              </div>
              <input className="input mb-1 font-mono text-xs" value={selected.link}
                placeholder="https://drive.google.com/file/d/.../view"
                onChange={e => setMediaUrl(selected, e.target.value)} />
              {selType === '360' && selected.link && (
                <button className="btn w-full justify-center mb-2 text-xs font-semibold"
                  style={{ background: '#E0F5EC', color: '#0F6E56', borderColor: '#5DCAA5' }}
                  onClick={() => onOpen360(selected)}>
                  🌐 360度ビューワーで確認
                </button>
              )}
              {selType === 'photo' && selected.link && (
                <a href={selected.link} target="_blank" rel="noopener noreferrer"
                  className="block text-center btn btn-sm w-full justify-center mb-2 text-[#1565C0]">
                  📷 写真をブラウザで確認
                </a>
              )}
            </>
          )}

          {/* 矢印表示トグル */}
          <div className="label mb-1">矢印</div>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input type="checkbox"
              checked={selected.showArrow === true}
              onChange={e => onUpdatePin(selected.id, {
                showArrow: e.target.checked,
                al: e.target.checked ? Math.max(selected.al, 20) : selected.al,
              })}
              className="accent-[#1565C0] w-4 h-4" />
            <span className="text-xs text-gray-700">矢印を表示する</span>
          </label>

          {selected.showArrow && (
            <>
              <div className="label mb-1">矢印方向</div>
              <div className="grid grid-cols-3 gap-1 mb-2 w-[90px]">
                {ARROW_DIRS.map(({ deg, label }) => {
                  const isActive = selected.deg === deg
                  const isNone = deg === NO_ARROW
                  return (
                    <button key={deg}
                      onClick={() => onUpdatePin(selected.id, { deg, al: deg === NO_ARROW ? 0 : Math.max(selected.al, 20) })}
                      title={deg === NO_ARROW ? '矢印なし' : `${deg}°`}
                      className={`w-8 h-8 rounded text-sm border transition-all font-bold ${
                        isActive ? 'bg-[#1565C0] text-white border-[#1565C0] shadow-sm'
                        : isNone ? 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-[#1565C0] hover:text-[#1565C0]'
                      }`}>{label}</button>
                  )
                })}
              </div>
              <div className="label">矢印の長さ: {selected.al}</div>
              <input type="range" min={0} max={60} value={selected.al} className="w-full mb-2"
                onChange={e => onUpdatePin(selected.id, { al: Number(e.target.value) })} />
            </>
          )}

          {/* サイズ */}
          <div className="label">丸サイズ: {selected.r}</div>
          <input type="range" min={6} max={20} value={selected.r} className="w-full mb-2"
            onChange={e => onUpdatePin(selected.id, { r: Number(e.target.value) })} />

          {/* 削除 */}
          <div className="flex gap-2">
            <button className="btn flex-1 justify-center text-xs text-red-500 border-red-200"
              onClick={() => onDeletePin(selected.id)}>🗑 削除</button>
            <div className="text-xs text-gray-400 flex items-center flex-1">
              {selected.lat.toFixed(5)},{selected.lng.toFixed(5)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
