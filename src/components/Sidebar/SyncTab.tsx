/**
 * SyncTab - クラウド同期タブ
 * 配置済みピンにクラウドストレージの写真リンクを自動設定する。
 * 写真タブで取り込み → 配置タブで配置 → 同期タブで紐付け の3ステップ最終工程。
 */
import { useState } from 'react'
import type { Pin } from '../../types'
import type { StorageConfig, StorageFile } from '../../services/storage'
import { getStorageProvider } from '../../services/storage'
import type { GoogleDriveProvider } from '../../services/storage/GoogleDriveProvider'

interface Props {
  pins: Pin[]
  setPins: (p: Pin[] | ((prev: Pin[]) => Pin[])) => void
  storageConfig: StorageConfig
  setStatusMsg: (m: string) => void
}

export function SyncTab({ pins, setPins, storageConfig, setStatusMsg }: Props) {
  const [driveStatus,    setDriveStatus]    = useState('')
  const [driveMatched,   setDriveMatched]   = useState(0)
  const [driveUnmatched, setDriveUnmatched] = useState(0)
  const [bulkLinks,      setBulkLinks]      = useState('')
  const [loading,        setLoading]        = useState(false)

  const isBoxConnected   = !!localStorage.getItem('box_access_token')
  const isDriveConnected = !!(storageConfig.googleDrive.webAppUrl && storageConfig.googleDrive.folderId)

  async function syncCloud() {
    const provider = getStorageProvider(storageConfig.provider)
    const validationError = provider.validateConfig(storageConfig)
    if (validationError) { alert(validationError); return }
    const placedPins = pins.filter(p => p.px > 0 || p.py > 0)
    if (!placedPins.length) {
      alert('先に写真タブで写真を取り込み、図面上に配置してください。')
      return
    }
    const folderId = storageConfig.provider === 'google-drive'
      ? storageConfig.googleDrive.folderId
      : (storageConfig.box.folderId ?? '')
    setDriveStatus('📂 ストレージフォルダを取得中...')
    setLoading(true)
    try {
      const result = await (provider as GoogleDriveProvider).listFiles(folderId, storageConfig)
      if (!result.success || !result.files?.length) {
        setDriveStatus('❌ ' + (result.error || 'ファイル取得失敗'))
        setLoading(false)
        return
      }
      const fileMap: Record<string, StorageFile> = {}
      result.files?.forEach(f => { fileMap[f.name.toLowerCase()] = f })
      let m = 0, u = 0
      setPins(prev => prev.map(pin => {
        const fn = (pin.photoFileName || pin.name || '').toLowerCase()
        const base = fn.replace(/\.[^.]+$/, '')
        const matched = fileMap[fn]
          ?? Object.values(fileMap).find(f => f.name.toLowerCase().replace(/\.[^.]+$/, '') === base)
        if (matched) {
          m++
          return {
            ...pin,
            link: matched.viewUrl,
            media: { ...(pin.media ?? { type: 'photo' as const }), driveFileId: matched.fileId, url: matched.viewUrl },
          }
        }
        u++; return pin
      }))
      setDriveMatched(m); setDriveUnmatched(u)
      setDriveStatus(`✓ ${result.files?.length ?? 0}件取得 | マッチ:${m}件 / 未一致:${u}件`)
      setStatusMsg(`クラウド同期完了: ${m}件にリンクを設定しました`)
    } catch (e: unknown) {
      setDriveStatus('❌ ' + (e instanceof Error ? e.message : '接続エラー'))
    } finally {
      setLoading(false)
    }
  }

  function applyBulk() {
    const links = bulkLinks.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (!links.length) { alert('URLを入力してください'); return }
    let i = 0
    setPins(prev => prev.map(p => !p.link && i < links.length
      ? { ...p, link: links[i++], media: { ...(p.media ?? { type: 'photo' as const }), url: links[i - 1] } }
      : p))
    setStatusMsg(`${i}件のリンクを割り当てました`)
    setBulkLinks('')
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="section">
        <h4>クラウドサービス自動連携</h4>

        {/* 操作説明 */}
        <div className="info-blue text-xs mb-3 space-y-1">
          <div>① 写真タブで写真を取り込む</div>
          <div>② 配置タブでピンを図面上に配置する</div>
          <div>③ ここで同期してリンクを自動設定する</div>
        </div>

        {/* 同期先 */}
        <div className="mb-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
          <div className="label mb-2">同期先</div>
          {storageConfig.provider === 'google-drive' ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">Google Drive</span>
              <span className={isDriveConnected ? 'text-green-600' : 'text-gray-400'}>
                {isDriveConnected ? '🟢 接続済み' : '⚪ 未設定（設定タブへ）'}
              </span>
            </div>
          ) : storageConfig.provider === 'box' ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">Box</span>
              <span className={isBoxConnected ? 'text-green-600' : 'text-gray-400'}>
                {isBoxConnected ? '🟢 接続済み' : '⚪ 未サインイン（設定タブへ）'}
              </span>
            </div>
          ) : (
            <div className="text-xs text-gray-400">未選択（設定タブでストレージを選択してください）</div>
          )}
        </div>

        {/* 配置済みピン数 */}
        <div className="text-xs text-gray-500 mb-3">
          配置済みピン: <span className="font-semibold text-gray-800">{pins.length}件</span>
          {pins.length === 0 && <span className="text-orange-500 ml-1">（先に配置タブでピンを配置してください）</span>}
        </div>

        {/* 同期ボタン */}
        <button
          className="btn w-full justify-center mb-3 font-semibold text-sm py-2.5"
          style={{ background: '#E0F5EC', color: '#0F6E56', borderColor: '#5DCAA5' }}
          onClick={syncCloud}
          disabled={loading || pins.length === 0}>
          {loading ? '⏳ 同期中...' : '🔄 クラウドから写真リンクを取得して自動設定'}
        </button>

        {/* 同期結果 */}
        {driveStatus && (
          <div className={`text-xs mb-2 ${driveStatus.startsWith('✓') ? 'text-green-600 font-semibold' : driveStatus.startsWith('❌') ? 'text-red-500' : 'text-gray-500'}`}>
            {driveStatus}
          </div>
        )}
        {(driveMatched > 0 || driveUnmatched > 0) && (
          <div className="flex gap-2 mb-3">
            <span className="badge badge-green">一致:{driveMatched}件</span>
            <span className="badge badge-gray">未一致:{driveUnmatched}件</span>
          </div>
        )}
      </div>

      {/* 一括リンク貼り付け（手動）*/}
      <div className="section">
        <h4>リンク一括貼り付け（手動）</h4>
        <div className="text-xs text-gray-400 mb-2">
          URLを1行ずつ貼り付けると、リンク未設定のピンに順番に割り当てます。
        </div>
        <textarea
          className="input font-mono text-xs resize-y mb-2" rows={5}
          placeholder={"https://drive.google.com/file/d/.../view\nhttps://..."}
          value={bulkLinks} onChange={e => setBulkLinks(e.target.value)} />
        <button className="btn w-full justify-center" onClick={applyBulk}>
          順番に割り当てる
        </button>
      </div>
    </div>
  )
}
