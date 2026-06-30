import { useState, useRef } from 'react'
import type { StyleConfig } from '../../types'
import type { StorageConfig, StorageProviderType } from '../../services/storage'
import { STORAGE_PROVIDER_LABELS, STORAGE_PROVIDER_AVAILABLE } from '../../services/storage'
import type { BackgroundSource } from '../../services/background'
import { loadBackgroundFile } from '../../services/background'
import { parseLatLng } from '../../features/calibration/transform'
import {
  startBoxOAuth, exchangeCodeForTokens, saveBoxTokens, purgeLegacySecret,
  clearBoxTokens, loadBoxTokens, isTokenExpired,
} from '../../services/storage/BoxAuth'
import { BoxApi } from '../../services/storage/BoxApi'

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
const PROVIDER_ORDER: StorageProviderType[] = ['google-drive', 'box', 'onedrive', 'sharepoint', 'dropbox']

export function SettingsTab({
  style, setStyle, storageConfig, setStorageConfig, pdfLoaded, onBgLoaded,
  useCalib, setUseCalib, calib, setCalib,
}: Props) {
  const [bgLoading, setBgLoading] = useState(false)
  const [boxStatus, setBoxStatus] = useState<'idle'|'signing'|'testing'|'ok'|'error'>('idle')
  const [boxMsg, setBoxMsg] = useState('')
  const [boxUserInfo, setBoxUserInfo] = useState<{name:string;spaceUsed:number;spaceAmount:number}|null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const gd  = storageConfig.googleDrive
  const box = storageConfig.box
  const isGD  = storageConfig.provider === 'google-drive'
  const isBox = storageConfig.provider === 'box'
  const isGDConfigured = !!(gd.webAppUrl && gd.folderId)

  const boxTokens = loadBoxTokens()
  const isBoxAuthed = !!boxTokens && !isTokenExpired(boxTokens)

  // ===== 図面読込 =====
  async function handleBgFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setBgLoading(true)
    try { onBgLoaded(await loadBackgroundFile(file)) }
    catch (err: unknown) { alert(err instanceof Error ? err.message : '読み込みに失敗しました') }
    finally { setBgLoading(false); e.target.value = '' }
  }

  // ===== キャリブレーション =====
  // ===== Box 認証 =====
  async function handleBoxSignIn() {
    if (!box.clientId?.trim()) { alert('Client IDを入力してください'); return }
    const clientSecret = (document.getElementById('box-client-secret') as HTMLInputElement)?.value?.trim()
    if (!clientSecret) { alert('Client Secretを入力してください'); return }

    setBoxStatus('signing'); setBoxMsg('Box認証ウィンドウを開いています...')
    try {
      const code = await startBoxOAuth(box.clientId)
      setBoxMsg('アクセストークンを取得中...')
      const tokens = await exchangeCodeForTokens(code, box.clientId, clientSecret)
      saveBoxTokens(tokens, box.clientId)
      purgeLegacySecret()  // 旧バージョンが保存したsecretを削除
      setStorageConfig({ ...storageConfig, box: { ...box, accessToken: tokens.accessToken } })
      setBoxStatus('ok')
      setBoxMsg('Box認証が完了しました')
      // ユーザー情報取得
      loadBoxUserInfo(tokens.accessToken)
    } catch (e: unknown) {
      setBoxStatus('error')
      setBoxMsg(e instanceof Error ? e.message : 'Box認証に失敗しました')
    }
  }

  async function loadBoxUserInfo(token: string) {
    try {
      const info = await BoxApi.getUserInfo(token)
      setBoxUserInfo({ name: info.name, spaceUsed: info.space_used, spaceAmount: info.space_amount })
    } catch { /* ignore */ }
  }

  async function handleBoxTest() {
    const tokens = loadBoxTokens()
    if (!tokens) { setBoxStatus('error'); setBoxMsg('未認証です'); return }
    setBoxStatus('testing'); setBoxMsg('接続確認中...')
    try {
      const info = await BoxApi.getUserInfo(tokens.accessToken)
      setBoxUserInfo({ name: info.name, spaceUsed: info.space_used, spaceAmount: info.space_amount })
      setBoxStatus('ok')
      setBoxMsg(`✓ 接続OK: ${info.name} (${info.login})`)
    } catch (e: unknown) {
      setBoxStatus('error')
      setBoxMsg(e instanceof Error ? e.message : '接続テストに失敗しました')
    }
  }

  function handleBoxSignOut() {
    if (!confirm('Boxのサインアウトを実行しますか？')) return
    clearBoxTokens()
    setStorageConfig({ ...storageConfig, box: { ...box, accessToken: undefined } })
    setBoxStatus('idle'); setBoxMsg(''); setBoxUserInfo(null)
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1048576) return `${(bytes/1024).toFixed(1)}KB`
    if (bytes < 1073741824) return `${(bytes/1048576).toFixed(1)}MB`
    return `${(bytes/1073741824).toFixed(2)}GB`
  }


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

      {/* ストレージ設定 */}
      <div className="section">
        <h4>ストレージ設定</h4>
        <div className="label mb-2">保存先</div>
        <div className="space-y-1 mb-3">
          {PROVIDER_ORDER.map(type => {
            const available = STORAGE_PROVIDER_AVAILABLE[type]
            const isSelected = storageConfig.provider === type
            return (
              <label key={type}
                className={`flex items-center gap-2 p-2 rounded-lg border text-xs transition-colors cursor-pointer ${isSelected ? 'border-[#1565C0] bg-[#E3EDFB]' : 'border-gray-200 hover:border-gray-300'} ${!available ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <input type="radio" name="provider" disabled={!available} checked={isSelected}
                  onChange={() => available && setStorageConfig({ ...storageConfig, provider: type })}
                  className="accent-[#1565C0]" />
                <span className={`font-semibold ${isSelected ? 'text-[#1565C0]' : 'text-gray-700'}`}>
                  {STORAGE_PROVIDER_LABELS[type]}
                </span>
                {isSelected && available && type === 'google-drive' && (
                  <span className={`badge ${isGDConfigured ? 'badge-green' : 'badge-warn'} ml-auto text-xs`}>
                    {isGDConfigured ? '● 接続済み' : '○ 未設定'}
                  </span>
                )}
                {isSelected && available && type === 'box' && (
                  <span className={`badge ${isBoxAuthed ? 'badge-green' : 'badge-warn'} ml-auto text-xs`}>
                    {isBoxAuthed ? '● Connected' : '○ 未認証'}
                  </span>
                )}
                {!available && <span className="ml-auto text-gray-400 text-xs">準備中</span>}
              </label>
            )
          })}
        </div>

        {/* Google Drive 設定パネル */}
        {isGD && (
          <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Google Drive (GAS)</span>
              <span className={`badge ${isGDConfigured ? 'badge-green' : 'badge-warn'} ml-auto`}>
                {isGDConfigured ? '● 接続済み' : '○ 未設定'}
              </span>
            </div>
            <div>
              <div className="label">GAS WebApp URL</div>
              <input className="input font-mono text-xs" placeholder="https://script.google.com/macros/s/.../exec"
                value={gd.webAppUrl} onChange={e => setStorageConfig({ ...storageConfig, googleDrive: { ...gd, webAppUrl: e.target.value } })} />
            </div>
            <div>
              <div className="label">DriveフォルダID</div>
              <input className="input font-mono text-xs" placeholder="1aBcDeFgHiJkLmNoPqRsTuVwXyZ"
                value={gd.folderId} onChange={e => setStorageConfig({ ...storageConfig, googleDrive: { ...gd, folderId: e.target.value } })} />
            </div>
            <button className="btn btn-sm text-gray-500" onClick={() => {
              const url = prompt('DriveフォルダURLを貼り付けてください')
              if (!url) return
              const m = url.match(/folders\/([a-zA-Z0-9_-]+)/)
              if (m) setStorageConfig({ ...storageConfig, googleDrive: { ...gd, folderId: m[1] } })
              else alert('フォルダIDを抽出できませんでした')
            }}>URL→ID自動抽出</button>
          </div>
        )}

        {/* Box 設定パネル */}
        {isBox && (
          <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Box OAuth 2.0</span>
              <span className={`badge ${isBoxAuthed ? 'badge-green' : 'badge-warn'} ml-auto`}>
                {isBoxAuthed ? '● Connected' : '○ 未認証'}
              </span>
            </div>

            {/* ユーザー情報・容量表示 */}
            {boxUserInfo && (
              <div className="p-2 rounded-lg bg-[#E0F5EC] border border-green-200">
                <div className="font-semibold text-green-700">{boxUserInfo.name}</div>
                <div className="text-gray-600 mt-1">
                  使用容量: {formatBytes(boxUserInfo.spaceUsed)}
                  {boxUserInfo.spaceAmount > 0 && ` / ${formatBytes(boxUserInfo.spaceAmount)}`}
                </div>
                {boxUserInfo.spaceAmount > 0 && (
                  <div className="h-1.5 bg-green-100 rounded mt-1 overflow-hidden">
                    <div className="h-full bg-green-500 rounded"
                      style={{ width: `${Math.min(100, boxUserInfo.spaceUsed / boxUserInfo.spaceAmount * 100).toFixed(1)}%` }} />
                  </div>
                )}
              </div>
            )}

            {/* 認証情報入力 */}
            {!isBoxAuthed && (
              <>
                <div>
                  <div className="label">Box App Client ID</div>
                  <input className="input font-mono text-xs" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={box.clientId ?? ''}
                    onChange={e => setStorageConfig({ ...storageConfig, box: { ...box, clientId: e.target.value } })} />
                </div>
                <div>
                  <div className="label">Box App Client Secret</div>
                  <input id="box-client-secret" type="password" className="input font-mono text-xs" placeholder="••••••••••••••••••••••••••••••••" />
                  <div className="text-gray-400 mt-0.5">
                    <a href="https://app.box.com/developers/console" target="_blank" rel="noopener noreferrer" className="text-[#1565C0] hover:underline">
                      Box Developer Console
                    </a>でアプリを作成してください
                  </div>
                </div>
              </>
            )}

            <div>
              <div className="label">ルートフォルダID（案件フォルダの作成先）</div>
              <input className="input font-mono text-xs" placeholder="0 (ルート) or フォルダID"
                value={box.folderId ?? '0'}
                onChange={e => setStorageConfig({ ...storageConfig, box: { ...box, folderId: e.target.value } })} />
            </div>

            {/* ステータスメッセージ */}
            {boxMsg && (
              <div className={`text-xs p-2 rounded ${boxStatus === 'ok' ? 'bg-green-50 text-green-700' : boxStatus === 'error' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'}`}>
                {boxStatus === 'signing' || boxStatus === 'testing' ? '⏳ ' : ''}{boxMsg}
              </div>
            )}

            {/* ボタン群 */}
            <div className="flex gap-2">
              {!isBoxAuthed ? (
                <button
                  className="btn flex-1 justify-center font-semibold"
                  style={{ background: '#0061d5', color: '#fff', borderColor: '#0061d5' }}
                  onClick={handleBoxSignIn}
                  disabled={boxStatus === 'signing'}>
                  🔐 Boxにサインイン
                </button>
              ) : (
                <>
                  <button className="btn flex-1 justify-center" onClick={handleBoxTest} disabled={boxStatus === 'testing'}>
                    🔌 接続確認
                  </button>
                  <button className="btn flex-1 justify-center text-red-500 border-red-200" onClick={handleBoxSignOut}>
                    サインアウト
                  </button>
                </>
              )}
            </div>

            {isBoxAuthed && (
              <div className="info-blue text-xs">
                <b>Redirect URI設定:</b><br />
                <code className="text-xs bg-white px-1 py-0.5 rounded border border-blue-200">
                  {window.location.origin}/auth/box/callback
                </code><br />
                Box Developer ConsoleのRedirect URIsに上記URLを追加してください。
              </div>
            )}
          </div>
        )}
      </div>
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
