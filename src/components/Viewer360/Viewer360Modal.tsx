/**
 * 360度写真ビューワー モーダル - @photo-sphere-viewer/core v5
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Viewer } from '@photo-sphere-viewer/core'
import '@photo-sphere-viewer/core/index.css'

interface Props {
  imageUrl: string
  title: string
  onClose: () => void
  /** 画像取得時のfetchオプション（POSTでトークンを渡す場合等） */
  fetchInit?: RequestInit
}

export function Viewer360Modal({ imageUrl, title, onClose, fetchInit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<Viewer | null>(null)
  const objectUrlRef  = useRef<string | null>(null)
  const fetchInitRef   = useRef<RequestInit | undefined>(fetchInit)
  const [loading, setLoading]   = useState(true)
  const [loadingInfo, setLoadingInfo] = useState('360度写真を読み込み中...')
  const [error,   setError]     = useState<string | null>(null)
  const [isFull,  setIsFull]    = useState(false)

  // fetchInit が変わるたびに ref を更新（依存配列問題を回避）
  fetchInitRef.current = fetchInit

  useEffect(() => {
    if (!containerRef.current) return
    let viewer: Viewer | null = null
    let cancelled = false
    const activeFetchInit = fetchInitRef.current  // useEffect実行時点の値を取得

    console.log('FETCH METHOD', activeFetchInit?.method ?? 'GET')
    console.log('PSV URL', imageUrl)

    // ===== ② 事前fetch検証（Content-Type / サイズ / ステータス確認）=====
    fetch(imageUrl, activeFetchInit ?? { method: 'GET' })
      .then(async response => {
        console.log('FETCH STATUS', response.status)
        console.log('FETCH CONTENT TYPE', response.headers.get('content-type'))
        console.log('FETCH CONTENT LENGTH', response.headers.get('content-length'))

        if (!response.ok) {
          const text = await response.text().catch(() => '')
          console.error('FETCH ERROR BODY', text.slice(0, 300))
          throw new Error(`画像取得失敗: HTTP ${response.status}\n${text.slice(0, 200)}`)
        }

        const ct = response.headers.get('content-type') ?? ''
        if (ct.includes('text/html') || ct.includes('application/json')) {
          const text = await response.text().catch(() => '')
          console.error('NON-IMAGE RESPONSE', ct, text.slice(0, 300))
          throw new Error(`画像でないレスポンス: ${ct}\n${text.slice(0, 200)}`)
        }

        // Blobとして取得してobjectURLでPSVに渡す（確実に画像バイナリを渡す）
        setLoadingInfo('360度写真をダウンロード中...')
        const blob = await response.blob()
        console.log('BLOB SIZE', blob.size)
        setLoadingInfo(`画像サイズ：${(blob.size / 1024 / 1024).toFixed(1)}MB を展開中...`)
        console.log('BLOB TYPE', blob.type)
        if (cancelled) return null
        const objectUrl = URL.createObjectURL(blob)
        objectUrlRef.current = objectUrl   // cleanup で revoke するため保持
        console.log('OBJECT URL', objectUrl)

        // 画像サイズ・アスペクト比判定（equirectangular = 2:1 を確認）
        await new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            const aspect = img.width / img.height
            console.log('IMAGE WIDTH', img.width)
            console.log('IMAGE HEIGHT', img.height)
            console.log('ASPECT', aspect.toFixed(3))
            // アスペクト比が2:1から大きく外れる場合は警告のみ（PSVは起動してみる）
            if (Math.abs(aspect - 2.0) > 0.3) {
              console.warn(`⚠ アスペクト比が2:1でない (${aspect.toFixed(2)}) - PSVを起動しますが表示が崩れる可能性があります`)
            } else {
              console.log(`✓ アスペクト比OK (${aspect.toFixed(2)})`)
            }
            resolve()
          }
          img.onerror = () => {
            console.error('IMAGE LOAD ERROR - 画像のデコードに失敗')
            resolve()
          }
          img.src = objectUrl
        })

        return objectUrl
      })
      .then(objectUrl => {
        if (!objectUrl || cancelled || !containerRef.current) return

        try {
          viewer = new Viewer({
            container: containerRef.current,
            panorama: objectUrl,
            caption: title,
            touchmoveTwoFingers: false,
            mousewheelCtrlKey: false,
            defaultZoomLvl: 50,
            navbar: false,
          })
          // ===== ④ PSV error イベント =====
          viewer.addEventListener('ready', () => {
            console.log('PSV READY')
            setLoading(false)
          })
          viewer.addEventListener('error' as never, (e: unknown) => {
            console.error('PSV ERROR', e)
            setError('Photo Sphere Viewerエラー:\n' + String((e as { message?: string })?.message ?? e))
            setLoading(false)
          })
          // panorama-error イベント（PSV v5）
          viewer.addEventListener('panorama-error' as never, (e: unknown) => {
            console.error('PSV PANORAMA-ERROR', e)
            setError('パノラマ読込エラー:\n画像が破損しているか、equirectangular形式でない可能性があります。')
            setLoading(false)
          })
          viewerRef.current = viewer
        } catch (e) {
          console.error('PSV INIT ERROR', e)
          setError('360度ビューワーの初期化に失敗しました: ' + String(e))
          setLoading(false)
        }
      })
      .catch(err => {
        if (cancelled) return
        console.error('IMAGE FETCH/INIT ERROR', err)
        setError(err instanceof Error ? err.message : '画像の取得に失敗しました')
        setLoading(false)
      })

    // タイムアウト（30秒: 大きい画像対応）
    const timeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          console.error('PSV TIMEOUT after 60s')
          setError('360度画像の読み込みがタイムアウトしました（60秒）。\n画像サイズが非常に大きい場合は時間がかかります。\nしばらく待ってから再度お試しください。')
        }
        return false
      })
    }, 60000)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      try { viewerRef.current?.destroy() } catch { /* ignore */ }
      viewerRef.current = null
      // ObjectURL 解放（メモリリーク防止）
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [imageUrl, title])

  const toggleFull = useCallback(() => {
    const el = document.getElementById('psv-modal')
    if (!el) return
    if (!document.fullscreenElement) el.requestFullscreen().then(() => setIsFull(true)).catch(() => {})
    else document.exitFullscreen().then(() => setIsFull(false)).catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'f') toggleFull() }
    const onFull = () => setIsFull(!!document.fullscreenElement)
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFull)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFull) }
  }, [onClose, toggleFull])


  return (
    <div id="psv-modal" className="fixed inset-0 z-50 flex flex-col bg-black" style={{ touchAction: 'none' }}>
      <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4 py-2 bg-black/60">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌐</span>
          <span className="text-white text-sm font-semibold truncate max-w-[200px]">{title}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={toggleFull}
            className="text-white/70 hover:text-white px-2 py-1 text-xs border border-white/20 hover:border-white/50 rounded transition-colors">
            {isFull ? '⊡ 解除' : '⊞ 全画面'}
          </button>
          <button onClick={onClose}
            className="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center border border-white/20 hover:border-white/50 rounded-full text-lg transition-colors"
            title="Esc">✕</button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 w-full" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-center">
            <div className="text-5xl mb-4 animate-pulse">🌐</div>
            <div className="text-white text-sm font-semibold mb-2">{loadingInfo}</div>
            <div className="text-white/50 text-xs">しばらくお待ちください</div>
            <div className="mt-4 w-48 h-1 bg-white/20 rounded-full overflow-hidden mx-auto">
              <div className="h-full bg-[#1D9E75] rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <div className="text-sm text-gray-700 whitespace-pre-line mb-3">{error}</div>
            <button onClick={onClose} className="px-4 py-2 bg-[#1565C0] text-white rounded-lg text-sm font-semibold">閉じる</button>
          </div>
        </div>
      )}
      {!error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
          {['🖱️ ドラッグで回転', '🔍 ホイールでズーム', '📱 スワイプ対応'].map(h => (
            <div key={h} className="bg-black/50 rounded-full px-3 py-1 text-white/70 text-xs">{h}</div>
          ))}
        </div>
      )}
    </div>
  )
}
