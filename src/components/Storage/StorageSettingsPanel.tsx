/**
 * StorageSettingsPanel - ストレージ保存先設定の共通コンポーネント
 *
 * 図面モード（SettingsTab）と地図モード（保存先設定モーダル）の両方から利用する。
 * 実装は SettingsTab から移設したもので、Box OAuth・Google Drive などの
 * 認証・保存処理は一切変更していない（UIの置き場所を共通化しただけ）。
 */
import { useState } from 'react'
import type { StorageConfig, StorageProviderType } from '../../services/storage'
import { STORAGE_PROVIDER_LABELS, STORAGE_PROVIDER_AVAILABLE } from '../../services/storage'
import {
  startBoxOAuth, exchangeCodeForTokens, saveBoxTokens, purgeLegacySecret,
  clearBoxTokens, loadBoxTokens, isTokenExpired,
} from '../../services/storage/BoxAuth'
import { BoxApi } from '../../services/storage/BoxApi'

const PROVIDER_ORDER: StorageProviderType[] = ['google-drive', 'box', 'onedrive', 'dropbox']

interface Props {
  storageConfig: StorageConfig
  setStorageConfig: (c: StorageConfig) => void
}

export function StorageSettingsPanel({ storageConfig, setStorageConfig }: Props) {
  const [boxStatus, setBoxStatus] = useState<'idle'|'signing'|'testing'|'ok'|'error'>('idle')
  const [boxMsg, setBoxMsg] = useState('')
  const [boxUserInfo, setBoxUserInfo] = useState<{name:string;spaceUsed:number;spaceAmount:number}|null>(null)

  const gd  = storageConfig.googleDrive
  const box = storageConfig.box
  const isGD  = storageConfig.provider === 'google-drive'
  const isBox = storageConfig.provider === 'box'
  const isGDConfigured = !!(gd.webAppUrl && gd.folderId)

  const boxTokens = loadBoxTokens()
  const isBoxAuthed = !!boxTokens && !isTokenExpired(boxTokens)

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
  )
}
