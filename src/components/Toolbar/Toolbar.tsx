import { useRef, useState } from 'react'
import {
  listProjectMetas, deleteProject, renameProject, deleteAllProjects,
  getStorageInfo, exportProjectJson, importProjectJson, loadProject,
} from '../../features/project'
import type { ProjectMeta } from '../../features/project'
import type { StorageConfig } from '../../services/storage'
import { StorageSettingsButton } from '../Storage/StorageSettingsButton'

interface ToolbarProps {
  pdfLoaded: boolean
  projectName: string
  pinCount: number
  gasConfigured: boolean
  zoomScale: number
  isDirty: boolean
  saveStatus: 'saved' | 'error' | null
  onZoom: (scale: number) => void
  onFit: () => void
  onSaveProject: (name?: string) => void   // 引数なし→上書き保存、あり→別名保存
  onLoadProject: (name: string) => void
  storageConfig: StorageConfig
  setStorageConfig: (c: StorageConfig) => void
}

export function Toolbar({
  pdfLoaded, projectName, pinCount, gasConfigured,
  zoomScale, isDirty, saveStatus,
  onZoom, onFit, onSaveProject, onLoadProject,
  storageConfig, setStorageConfig,
}: ToolbarProps) {
  const importRef = useRef<HTMLInputElement>(null)
  const [showManager, setShowManager] = useState(false)
  const [metas, setMetas] = useState<ProjectMeta[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [importError, setImportError] = useState('')

  function openManager() {
    setMetas(listProjectMetas())
    setShowManager(true)
    setImportError('')
  }
  function refreshMetas() { setMetas(listProjectMetas()) }

  function handleDelete(name: string) {
    if (!confirm(`「${name}」を削除しますか？`)) return
    deleteProject(name); refreshMetas()
  }
  function handleDeleteAll() {
    if (!confirm(`全プロジェクト（${metas.length}件）を削除しますか？`)) return
    deleteAllProjects(); refreshMetas()
  }
  function handleRename(oldName: string) {
    if (!newName.trim()) { alert('名前を入力してください'); return }
    if (newName === oldName) { setRenaming(null); return }
    if (!renameProject(oldName, newName.trim())) { alert('その名前はすでに使われています'); return }
    setRenaming(null); refreshMetas()
  }

  // 管理画面からJSONインポート
  async function handleImportJson(file: File) {
    try {
      const p = await importProjectJson(file)
      onLoadProject(p.name)
      setShowManager(false)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '読み込みに失敗しました')
    }
  }

  const info = getStorageInfo()
  const usedPct = Math.min(100, Math.round(info.usedKB / info.totalKB * 100))

  return (
    <>
      <div className="flex items-center gap-1.5 px-3 py-2 bg-white border-b border-gray-200 shadow-sm flex-wrap flex-shrink-0">
        {/* ロゴ */}
        <span className="text-sm font-bold text-[#1565C0] mr-1">PhotoLinkMap</span>

        {/* 地図モードへ */}
        <a href="/map"
          className="text-xs font-semibold px-2 py-1 rounded bg-[#1D9E75] text-white hover:bg-[#178a65] no-underline mr-1"
          style={{ textDecoration: 'none' }}>
          🗺 地図モード
        </a>

        {/* 保存先設定（共通コンポーネント）*/}
        <StorageSettingsButton storageConfig={storageConfig} setStorageConfig={setStorageConfig} variant="toolbar" />

        {/* GASバッジ */}
        <span className={`badge ${gasConfigured ? 'badge-green' : 'badge-warn'} text-xs`}>
          {gasConfigured ? '🔗 GAS接続済み' : '⚠ GAS未設定'}
        </span>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        {/* ズームコントロール */}
        {pdfLoaded && (
          <>
            <button className="btn btn-sm px-2 font-bold" onClick={() => onZoom(zoomScale - 0.25)}>−</button>
            <span className="text-xs text-gray-500 min-w-[40px] text-center tabular-nums">{Math.round(zoomScale * 100)}%</span>
            <button className="btn btn-sm px-2 font-bold" onClick={() => onZoom(zoomScale + 0.25)}>＋</button>
            <button className="btn btn-sm" onClick={onFit}>fit</button>
            <button className="btn btn-sm" onClick={() => onZoom(1)}>1:1</button>
            <div className="w-px h-5 bg-gray-200 mx-1" />
          </>
        )}

        {/* 上書き保存 */}
        <button className="btn" onClick={() => onSaveProject()}>
          💾 上書き保存
        </button>

        {/* 別名保存 */}
        <button className="btn btn-sm" onClick={() => {
          const name = prompt('プロジェクト名を入力', projectName)
          if (name) onSaveProject(name)
        }}>
          📋 別名保存
        </button>

        {/* 管理 */}
        <button className="btn" onClick={openManager}>
          📂 管理 {info.projectCount > 0 && <span className="badge badge-blue ml-1">{info.projectCount}</span>}
        </button>

        {/* 新規プロジェクト */}
        <span className="text-xs text-gray-400 hidden md:block truncate max-w-[100px]">{projectName}</span>

        {/* 未保存インジケーター */}
        {isDirty && (
          <span className="text-xs text-orange-500 font-semibold animate-pulse">● 未保存</span>
        )}

        {/* 保存フィードバック */}
        {saveStatus === 'saved' && (
          <span className="text-xs text-green-600 font-semibold">✓ 保存しました</span>
        )}
        {saveStatus === 'error' && (
          <span className="text-xs text-red-500 font-semibold">⚠ 保存できませんでした</span>
        )}

        {pdfLoaded && <span className="ml-auto badge badge-blue">📍 {pinCount}件</span>}
      </div>

      {/* プロジェクト管理モーダル */}
      {showManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-base font-bold text-gray-800">プロジェクト管理</h2>
                <p className="text-xs text-gray-500">{info.projectCount}件 / 使用容量 {info.usedKB}KB ({usedPct}%)</p>
              </div>
              <button onClick={() => setShowManager(false)} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>

            {/* 容量バー */}
            <div className="px-5 pt-2 pb-1 flex-shrink-0">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${usedPct}%`, background: usedPct > 80 ? '#E53935' : '#1565C0' }} />
              </div>
              {usedPct > 80 && (
                <p className="text-xs text-red-500 mt-1">⚠ 容量が不足しています。不要な案件を削除するかJSONで書き出してください。</p>
              )}
            </div>

            {/* 案件一覧 */}
            <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
              {metas.length === 0 ? (
                <div className="text-center text-gray-400 py-12 text-sm">保存済みプロジェクトはありません</div>
              ) : metas.map(m => (
                <div key={m.name} className="border border-gray-100 rounded-xl p-3 mb-2 hover:border-gray-200">
                  {renaming === m.name ? (
                    <div className="flex gap-2 items-center">
                      <input autoFocus className="flex-1 px-2 py-1 text-sm border border-[#1565C0] rounded-lg focus:outline-none"
                        value={newName} onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(m.name); if (e.key === 'Escape') setRenaming(null) }} />
                      <button className="px-3 py-1 text-xs bg-[#1565C0] text-white rounded-lg" onClick={() => handleRename(m.name)}>確定</button>
                      <button className="px-3 py-1 text-xs border border-gray-300 rounded-lg" onClick={() => setRenaming(null)}>取消</button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm text-gray-800 truncate">{m.name}</div>
                        <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-3">
                          <span>更新: {new Date(m.updatedAt).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                          <span>📍 {m.pinCount}件</span>
                          <span>📷 {m.photoCount}件</span>
                          {m.bgFileName && <span className="truncate max-w-[100px]" title={m.bgFileName}>📄 {m.bgFileName}</span>}
                          <span className="text-gray-300">~{m.sizeEstimateKB}KB</span>
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
                        <button className="px-2.5 py-1 text-xs bg-[#1565C0] text-white rounded-lg hover:bg-[#0D47A1] font-semibold"
                          onClick={() => { onLoadProject(m.name); setShowManager(false) }}>開く</button>
                        <button className="px-2.5 py-1 text-xs border border-gray-300 rounded-lg hover:bg-gray-50"
                          onClick={() => { setRenaming(m.name); setNewName(m.name) }}>名前変更</button>
                        <button className="px-2.5 py-1 text-xs border border-blue-200 text-blue-500 rounded-lg hover:bg-blue-50"
                          onClick={() => {
                            const p = loadProject(m.name)
                            if (p) exportProjectJson(p)
                          }}>📤 書き出し</button>
                        <button className="px-2.5 py-1 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50"
                          onClick={() => handleDelete(m.name)}>削除</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* フッター: JSONインポート + 全削除 */}
            <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 space-y-2">
              {/* JSONファイルから読み込む */}
              <div>
                <button
                  className="w-full px-4 py-2 text-sm border-2 border-dashed border-gray-300 rounded-xl hover:border-[#1565C0] hover:text-[#1565C0] text-gray-500 transition-colors"
                  onClick={() => importRef.current?.click()}>
                  📥 JSONファイルから読み込む（他端末から受け取った .json）
                </button>
                <input ref={importRef} type="file" accept=".json" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) { handleImportJson(f) } e.target.value = '' }} />
                {importError && <p className="text-xs text-red-500 mt-1">{importError}</p>}
              </div>

              <div className="flex justify-between items-center">
                {metas.length > 0 && (
                  <button className="text-xs text-red-400 hover:text-red-600" onClick={handleDeleteAll}>全削除</button>
                )}
                <button className="ml-auto px-4 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  onClick={() => setShowManager(false)}>閉じる</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
