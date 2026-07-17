/**
 * ファイルモード（Step1）— 写真取込・一覧表示
 *
 * 図面・地図への配置を行わず、写真名一覧のリンク付きPDFを出力するモード。
 * Step1: 取込・一覧（番号/サムネ/ファイル名/撮影時刻）・並替・削除
 * Step2: クラウド同期（名前マッチング。MapPage.syncCloudと同方式）
 * Step3: PDF出力 — 後続ステップで追加
 *
 * 図面未読込でも動作する（pins / calib / photoStore に依存しない）。
 */
import { useRef, useState } from 'react'
import { readExifDateTime } from '../../services/exifTime'
import { getStorageProvider } from '../../services/storage'
import type { StorageConfig, StorageFile } from '../../services/storage'
import type { GoogleDriveProvider } from '../../services/storage/GoogleDriveProvider'
import { getPinPdfLinkUrl } from '../../features/viewer/viewerTypes'
import {
  makeThumbnail, detectIs360, sortEntries, renumber,
  type FileEntry, type FileSortKey,
} from '../../features/fileList'

interface Props {
  storageConfig: StorageConfig
  fileEntries: FileEntry[]
  setFileEntries: (e: FileEntry[] | ((prev: FileEntry[]) => FileEntry[])) => void
  fileSiteName: string
  setFileSiteName: (n: string) => void
  setStatusMsg: (m: string) => void
}

// ファイルモード専用：通常写真をOpenSeadragonで開く /viewer?type=image URLを組み立てる
// （共通関数 getPinPdfLinkUrl は変更せず、表示先の切替をファイルモードに閉じ込める。
//  地図モードの buildMapImageViewerUrl と同方針）
function buildFileImageViewerUrl(
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

const SORT_LABELS: { key: FileSortKey; label: string }[] = [
  { key: 'imported', label: '取込順' },
  { key: 'name',     label: '名前順' },
  { key: 'takenAt',  label: '時刻順' },
]

export function FileTab({ storageConfig, fileEntries, setFileEntries, fileSiteName, setFileSiteName, setStatusMsg }: Props) {
  const [loading, setLoading]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [sortKey, setSortKey]   = useState<FileSortKey>('imported')
  const [syncing, setSyncing]     = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const seqRef  = useRef(0)

  // 取込済みの最大importSeqから続きの連番を振る（再取込・追加取込対応）
  function nextSeq(): number {
    const max = fileEntries.reduce((m, e) => Math.max(m, e.importSeq), 0)
    seqRef.current = Math.max(seqRef.current, max) + 1
    return seqRef.current
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (arr.length === 0) return
    setLoading(true); setProgress(0)
    const added: FileEntry[] = []
    let failed = 0
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i]
      try {
        const [thumb, takenAt, is360] = await Promise.all([
          makeThumbnail(f),
          readExifDateTime(f),
          detectIs360(f),
        ])
        const seq = nextSeq()
        added.push({
          id: `fe_${Date.now()}_${seq}`,
          no: 0,  // 直後のrenumberで確定
          importSeq: seq,
          fileName: f.name,
          thumbDataUrl: thumb,
          takenAt: takenAt ?? undefined,
          is360,
        })
      } catch { failed++ }
      setProgress(Math.round((i + 1) / arr.length * 100))
    }
    setFileEntries(prev => renumber([...prev, ...added]))
    setLoading(false)
    const failMsg = failed > 0 ? `（読込失敗:${failed}件）` : ''
    setStatusMsg(`ファイルモード: ${added.length}件取り込みました${failMsg}`)
    if (fileRef.current) fileRef.current.value = ''
  }

  function applySort(key: FileSortKey) {
    setSortKey(key)
    setFileEntries(prev => sortEntries(prev, key))
  }

  function moveEntry(id: string, dir: -1 | 1) {
    setFileEntries(prev => {
      const i = prev.findIndex(e => e.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const arr = [...prev]
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return renumber(arr)
    })
  }

  function removeEntry(id: string) {
    setFileEntries(prev => renumber(prev.filter(e => e.id !== id)))
  }

  function clearAll() {
    if (!window.confirm('一覧をすべて削除しますか？')) return
    setFileEntries([])
  }

  // ===== クラウド同期（地図モードsyncCloudと同じ名前マッチング方式。両クラウド対応）=====
  async function syncCloud() {
    const provider = getStorageProvider(storageConfig.provider)
    const err = provider.validateConfig(storageConfig)
    if (err) { setSyncStatus('❌ ' + err); return }
    if (fileEntries.length === 0) { setSyncStatus('先に写真を取り込んでください'); return }

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
      // ファイル名 → StorageFile のマップ（完全一致 → 拡張子除きの緩和一致）
      const fileMap: Record<string, StorageFile> = {}
      result.files.forEach(f => { fileMap[f.name.toLowerCase()] = f })

      const isBox = storageConfig.provider === 'box'
      const boxToken = isBox ? (localStorage.getItem('box_access_token') ?? '') : ''

      let matched = 0, unmatched = 0, linked360 = 0
      const updated: FileEntry[] = []
      for (const entry of fileEntries) {
        const fn = entry.fileName.toLowerCase()
        const base = fn.replace(/\.[^.]+$/, '')
        const hit = fileMap[fn]
          ?? Object.values(fileMap).find(f => f.name.toLowerCase().replace(/\.[^.]+$/, '') === base)
        if (!hit) { unmatched++; updated.push(entry); continue }
        matched++

        // Boxの場合、共有リンク(download_url)を取得（外部閲覧に必要。地図モードと同じ）
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
        if (entry.is360) {
          // 360度 → Photo Sphere Viewer（既存の共通関数。lat/lngは位置情報なしのため0,0）
          cloudUrl = getPinPdfLinkUrl(
            'photosphere', hit.fileId, hit.viewUrl, entry.fileName,
            0, 0, storageConfig.provider, sharedUrl,
          )
          linked360++
        } else {
          // 通常写真 → OpenSeadragon（/viewer?type=image）
          cloudUrl = buildFileImageViewerUrl(hit.fileId, entry.fileName, storageConfig.provider, sharedUrl)
        }
        updated.push({ ...entry, cloudUrl, fileId: hit.fileId })
      }
      setFileEntries(updated)
      const s360 = linked360 > 0 ? ` / 360°:${linked360}件` : ''
      setSyncStatus(`✓ ${result.files.length}件取得 / マッチ:${matched}件 / 未一致:${unmatched}件${s360}`)
      setStatusMsg(`ファイルモード: クラウド同期完了（マッチ:${matched}件）`)
    } catch (e: unknown) {
      setSyncStatus('❌ ' + (e instanceof Error ? e.message : '接続エラー'))
    } finally {
      setSyncing(false)
    }
  }

  const count360 = fileEntries.filter(e => e.is360).length

  return (
    <div className="overflow-y-auto flex-1">
      <div className="section">
        <h4>ファイルモード 写真取込</h4>
        <div className="info-blue mb-2 text-xs">
          図面への配置を行わず、写真名の一覧をリンク付きPDFにします。
          図面を読み込んでいなくても利用できます。
        </div>

        <label className="label">現場名（PDFヘッダーに表示）</label>
        <input className="input mb-2" value={fileSiteName}
          placeholder="例：○○ビル改修工事"
          onChange={e => setFileSiteName(e.target.value)} />

        <button className="btn-primary w-full justify-center mb-2"
          onClick={() => fileRef.current?.click()} disabled={loading}>
          📷 写真を取り込む（複数選択可）
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => handleFiles(e.target.files)} />

        {loading && (
          <div className="h-1.5 bg-gray-200 rounded overflow-hidden mb-2">
            <div className="h-full bg-[#1565C0] rounded transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {fileEntries.length > 0 && (
        <div className="section">
          <div className="flex items-center justify-between mb-2">
            <h4 className="!mb-0">一覧（{fileEntries.length}件{count360 > 0 ? ` / 360°:${count360}` : ''}）</h4>
            <button className="btn btn-sm text-red-500" onClick={clearAll}>全削除</button>
          </div>

          {/* 並び順 */}
          <div className="flex gap-1 mb-2">
            <span className="text-xs text-gray-400 self-center">並び順:</span>
            {SORT_LABELS.map(s => (
              <button key={s.key}
                className={`btn btn-sm ${sortKey === s.key ? '!bg-[#E3EDFB] !text-[#1565C0] !border-[#1565C0]' : ''}`}
                onClick={() => applySort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>

          <div className="border border-gray-100 rounded">
            {fileEntries.map((e, i) => (
              <div key={e.id}
                className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-50 last:border-0 text-xs">
                <span className="w-6 h-6 rounded-full bg-[#1565C0] text-white font-bold flex items-center justify-center flex-shrink-0 text-[10px]">
                  {e.no}
                </span>
                <img src={e.thumbDataUrl} alt="" className="w-9 h-9 object-cover rounded flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium" title={e.fileName}>
                    {e.cloudUrl
                      ? <a href={e.cloudUrl} target="_blank" rel="noopener noreferrer"
                          className="text-[#1565C0] hover:underline">
                          {e.is360 ? '🌐 ' : ''}{e.fileName}
                        </a>
                      : <>{e.is360 ? '🌐 ' : ''}{e.fileName}</>}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-gray-400">{e.takenAt ?? '撮影時刻なし'}</span>
                    {e.cloudUrl
                      ? <span className="badge badge-green text-[10px]">🔗同期済</span>
                      : <span className="badge badge-gray text-[10px]">未同期</span>}
                  </div>
                </div>
                <div className="flex flex-col flex-shrink-0">
                  <button className="text-gray-400 hover:text-[#1565C0] leading-none px-1 disabled:opacity-20"
                    onClick={() => moveEntry(e.id, -1)} disabled={i === 0} title="上へ">▲</button>
                  <button className="text-gray-400 hover:text-[#1565C0] leading-none px-1 disabled:opacity-20"
                    onClick={() => moveEntry(e.id, 1)} disabled={i === fileEntries.length - 1} title="下へ">▼</button>
                </div>
                <button className="text-gray-300 hover:text-red-500 flex-shrink-0 px-1"
                  onClick={() => removeEntry(e.id)} title="削除">✕</button>
              </div>
            ))}
          </div>

        </div>
      )}

      {fileEntries.length > 0 && (
        <div className="section">
          <h4>クラウド同期</h4>
          <div className="info-blue mb-2 text-xs">
            保存先設定（Drive/Box）のフォルダとファイル名でマッチングし、一覧の各行にリンクを付けます。
            同期後はファイル名クリックで写真が開きます。
          </div>
          <button className="btn-success w-full justify-center mb-2"
            onClick={syncCloud} disabled={syncing}>
            {syncing ? '同期中...' : '☁ クラウド同期'}
          </button>
          {syncStatus && <div className="text-xs text-gray-600 break-all mb-1">{syncStatus}</div>}
          <div className="info-box bg-gray-50 text-gray-400 mt-2">
            PDF出力（Step3）は次ステップで追加予定です。
          </div>
        </div>
      )}
    </div>
  )
}
