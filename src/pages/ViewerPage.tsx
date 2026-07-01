/**
 * /viewer ページ - 段階的デバッグ版
 *
 * Phase 1: provider/fileId の確認
 * Phase 2: Box API接続確認（ファイル情報取得）
 * Phase 3: 実画像URL取得
 * Phase 4: JPEG表示確認
 * Phase 5: Photo Sphere Viewer（最後）
 */
import { useEffect, useState } from 'react'
import { Viewer360Modal } from '../components/Viewer360/Viewer360Modal'
import { ImageViewerModal } from './ImageViewerModal'

interface FileInfo {
  id: string
  name: string
  size: number
  extension: string
}

export function ViewerPage() {
  const params   = new URLSearchParams(window.location.search)
  const type     = params.get('type') ?? 'photosphere'
  const fileId   = params.get('fileId') ?? params.get('id') ?? ''
  const provider = params.get('storageProvider') ?? params.get('provider') ?? 'google-drive'
  const sharedUrl = params.get('shared') ?? ''
  const title    = params.get('title') ?? '360度写真'

  const [phase,    setPhase]    = useState(1)
  const [showPSV,  setShowPSV]  = useState(false)
  const debugMode = params.get('debug') === '1'
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [error,    setError]    = useState('')
  const [log,      setLog]      = useState<string[]>([])

  function addLog(msg: string) {
    console.log('[ViewerPage]', msg)
    setLog(prev => [...prev, msg])
  }

  // Phase 1: URLパラメータ確認
  useEffect(() => {
    console.log('provider', provider)
    console.log('fileId', fileId)
    console.log('type', type)
    addLog(`Phase 1: provider=${provider}, fileId=${fileId || '(none)'}, type=${type}`)

    if (!fileId) {
      setError('fileIdが設定されていません。\nDrive連携ボタンで写真リンクを取得してください。')
      return
    }
    if (type !== 'photosphere' && type !== 'image') {
      setError(`ビューワー種別 "${type}" は未対応です。`)
      return
    }
    setPhase(2)
  }, [])

  // Phase 2: Box API接続 → ファイル情報取得
  useEffect(() => {
    if (phase !== 2 || !fileId || provider !== 'box') {
      if (phase === 2 && provider === 'google-drive') {
        addLog('Phase 2: Google Drive → Phase 3へスキップ')
        setPhase(3)
      }
      return
    }
    // 共有リンクがある場合はBox認証不要 → Phase 3へ直行
    if (sharedUrl) {
      addLog('Phase 2: 共有リンクあり → Box認証スキップ')
      setPhase(3)
      return
    }
    const token = localStorage.getItem('box_access_token') ?? ''
    if (!token) {
      setError('Box未認証です。設定タブからサインインしてください。\n\n※このPDFが共有リンクなしで出力されている場合は、\n作成者に最新版での再出力を依頼してください。')
      return
    }
    addLog('Phase 2: Box API接続中...')
    fetch('/.netlify/functions/box-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_user_info', token }),
    })
      .then(r => r.json())
      .then((data: { name?: string; login?: string; error?: string }) => {
        if (data.error) throw new Error(data.error)
        addLog(`Phase 2: Box接続OK - ${data.name} (${data.login})`)
        // ファイル情報取得
        return fetch('/.netlify/functions/box-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list_files', token, folderId: '0' }),
        })
      })
      .then(() => {
        // box-proxy 経由でファイルメタデータ取得（CORS回避）
        const token2 = localStorage.getItem('box_access_token') ?? ''
        return fetch('/.netlify/functions/box-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_file_info', token: token2, fileId }),
        })
      })
      .then(r => r.json())
      .then((data: FileInfo & { error?: string }) => {
        if (data.error) throw new Error(data.error)
        if (data.name) {
          const info: FileInfo = { id: data.id, name: data.name, size: data.size ?? 0, extension: data.extension ?? data.name.split('.').pop() ?? '' }
          setFileInfo(info)
          addLog(`Phase 2: ファイル情報取得OK - ${info.name} (${(info.size/1024/1024).toFixed(1)}MB)`)
        } else {
          addLog('Phase 2: ファイル情報は取得できませんでしたが続行します')
        }
        setPhase(3)
      })
      .catch(err => {
        addLog(`Phase 2 ERROR: ${err.message}`)
        setError('Box API接続エラー: ' + err.message)
      })
  }, [phase])

  // Phase 3: 実画像URL取得
  useEffect(() => {
    if (phase !== 3 || !fileId) return
    addLog('Phase 3: 実画像URL取得中...')

    // 1位: 共有リンク（トークン不要・第三者閲覧可能）
    if (sharedUrl) {
      const url = `/image-proxy?url=${encodeURIComponent(sharedUrl)}`
      addLog(`Phase 3: 共有リンク使用 = ${url.slice(0, 80)}...`)
      setImageUrl(url)
      setPhase(4)
      return
    }
    // 2位: 従来方式（box_access_token）
    if (provider === 'box') {
      const token = localStorage.getItem('box_access_token') ?? ''
      const url = `/image-proxy?provider=box&fileId=${encodeURIComponent(fileId)}&token=${encodeURIComponent(token)}`
      addLog(`Phase 3: image-proxy URL = ${url.replace(token, '[TOKEN]')}`)
      setImageUrl(url)
      setPhase(4)
    } else {
      // Google Drive: lh3 経由
      const url = `/image-proxy?url=${encodeURIComponent(`https://lh3.googleusercontent.com/d/${fileId}`)}`
      addLog(`Phase 3: Google Drive proxy URL = ${url}`)
      setImageUrl(url)
      setPhase(4)
    }
  }, [phase])

  // Phase 4: JPEG表示確認（HEADリクエスト）
  useEffect(() => {
    if (phase !== 4 || !imageUrl) return
    addLog('Phase 4: 画像アクセス確認中...')

    fetch(imageUrl, { method: 'GET' })
      .then(async res => {
        const ct = res.headers.get('content-type') ?? 'unknown'
        const cl = res.headers.get('content-length') ?? 'unknown'
        console.log('FETCH STATUS', res.status)
        console.log('FETCH CONTENT TYPE', ct)
        console.log('FETCH CONTENT LENGTH', cl)
        addLog(`Phase 4: status=${res.status}, type=${ct}, size=${cl}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        if (ct.includes('text/html') || ct.includes('application/json')) {
          const body = await res.text()
          throw new Error(`画像でないレスポンス: ${ct}\n${body.slice(0, 200)}`)
        }
        addLog('Phase 4: 画像取得OK → Phase 5 (PSV) 準備完了')
        setPhase(5)
        // 本番モード: 自動でPSV起動
        if (!debugMode) setShowPSV(true)
      })
      .catch(err => {
        addLog(`Phase 4 ERROR: ${err.message}`)
        setError('画像取得エラー: ' + err.message)
      })
  }, [phase])

  // 本番モード: type=image は OpenSeadragon で表示
  if (!debugMode && showPSV && imageUrl && type === 'image') {
    return (
      <ImageViewerModal
        imageUrl={imageUrl}
        title={title}
        onClose={() => {
          if (window.history.length > 1) window.history.back()
          else window.close()
        }}
      />
    )
  }

  // 本番モード: PSV表示中またはロード中はデバッグUIを出さない
  if (!debugMode && showPSV && imageUrl) {
    return (
      <Viewer360Modal
        imageUrl={imageUrl}
        title={title}
        onClose={() => {
          if (window.history.length > 1) window.history.back()
          else window.close()
        }}
      />
    )
  }

  // 本番モード: エラーなしでロード中はシンプルなローディング表示
  if (!debugMode && !error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🌐</div>
          <div className="text-white text-sm animate-pulse">360度写真を読み込んでいます...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-xl mx-auto">
        {/* タイトル */}
        <h1 className="text-xl font-bold mb-4">📍 PhotoLinkMap Viewer</h1>

        {/* Phase 1: パラメータ表示 */}
        <div className="bg-gray-800 rounded-xl p-4 mb-4">
          <h2 className="text-sm font-bold text-gray-400 mb-2">Phase 1: URLパラメータ</h2>
          <div className="space-y-1 text-sm font-mono">
            <div><span className="text-gray-400">Provider: </span><span className="text-green-400">{provider}</span></div>
            <div><span className="text-gray-400">File ID: </span><span className="text-green-400">{fileId || '(none ❌)'}</span></div>
            <div><span className="text-gray-400">Type: </span><span className="text-blue-400">{type}</span></div>
            <div><span className="text-gray-400">Title: </span><span className="text-white">{title}</span></div>
          </div>
        </div>

        {/* Phase 2: ファイル情報 */}
        {fileInfo && (
          <div className="bg-gray-800 rounded-xl p-4 mb-4">
            <h2 className="text-sm font-bold text-gray-400 mb-2">Phase 2: Box ファイル情報</h2>
            <div className="space-y-1 text-sm font-mono">
              <div><span className="text-gray-400">File Name: </span><span className="text-white">{fileInfo.name}</span></div>
              <div><span className="text-gray-400">File Size: </span><span className="text-white">{(fileInfo.size/1024/1024).toFixed(2)} MB</span></div>
              <div><span className="text-gray-400">File Type: </span><span className="text-white">.{fileInfo.extension}</span></div>
            </div>
          </div>
        )}

        {/* Phase 3: 解決URL */}
        {imageUrl && (
          <div className="bg-gray-800 rounded-xl p-4 mb-4">
            <h2 className="text-sm font-bold text-gray-400 mb-2">Phase 3: 解決済みURL</h2>
            <div className="text-xs font-mono text-blue-400 break-all">
              {imageUrl.replace(localStorage.getItem('box_access_token') ?? 'TOKEN', '[TOKEN]')}
            </div>
            <a href={imageUrl} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-block px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
              Phase 4: 新しいタブで画像を開く →
            </a>
          </div>
        )}

        {/* Phase 5: PSV起動ボタン */}
        {phase === 5 && !showPSV && (
          <div className="bg-green-900 rounded-xl p-4 mb-4">
            <h2 className="text-sm font-bold text-green-400 mb-2">Phase 5: Photo Sphere Viewer 準備完了</h2>
            <p className="text-sm text-gray-300 mb-2">JPEG取得確認済み。PSVを起動しますか？</p>
            <button
              onClick={() => setShowPSV(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700">
              🌐 360度ビューワーを起動
            </button>
          </div>
        )}

        {/* エラー */}
        {error && (
          <div className="bg-red-900 rounded-xl p-4 mb-4">
            <h2 className="text-sm font-bold text-red-400 mb-2">❌ エラー</h2>
            <div className="text-sm whitespace-pre-line">{error}</div>
          </div>
        )}

        {/* ログ */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-400 mb-2">ログ</h2>
          <div className="space-y-1">
            {log.map((l, i) => (
              <div key={i} className="text-xs font-mono text-gray-300">{l}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Phase 5: ビューアモーダル（typeで分岐）*/}
      {showPSV && imageUrl && type === 'image' && (
        <ImageViewerModal
          imageUrl={imageUrl}
          title={title}
          onClose={() => setShowPSV(false)}
        />
      )}
      {showPSV && imageUrl && type !== 'image' && (
        <Viewer360Modal
          imageUrl={imageUrl}
          title={title}
          onClose={() => setShowPSV(false)}
        />
      )}
    </div>
  )
}
