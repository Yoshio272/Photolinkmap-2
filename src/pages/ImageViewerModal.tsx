/**
 * ImageViewerModal - 通常画像（JPEG/PNG）をOpenSeadragonでズーム・パン表示
 *
 * 設計方針（B案）:
 *   - 認証構造には関与しない。既存の画像取得経路（image-proxyのURL）をそのまま表示するだけ。
 *   - imageUrl は image-proxy 経由のURL（Box認証はサーバー側で解決済み、ブラウザは匿名）。
 *   - OpenSeadragon は CDN動的読み込み（package.json 不変）。
 */
import { useEffect, useRef, useState } from 'react'

interface Props {
  imageUrl: string
  title?: string
  onClose: () => void
}

// OpenSeadragon を CDN から動的読み込み
function loadOpenSeadragon(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any
    if (w.OpenSeadragon) return resolve(w.OpenSeadragon)
    const src = 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/openseadragon.min.js'
    if (document.querySelector(`script[src="${src}"]`)) {
      const check = () => w.OpenSeadragon ? resolve(w.OpenSeadragon) : setTimeout(check, 50)
      return check()
    }
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve(w.OpenSeadragon)
    s.onerror = () => reject(new Error('OpenSeadragon の読み込みに失敗しました'))
    document.head.appendChild(s)
  })
}

export function ImageViewerModal({ imageUrl, title, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<any>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const OpenSeadragon = await loadOpenSeadragon()
        if (cancelled || !containerRef.current) return
        // コンテナのレイアウト確定を待つ（高さ0での初期化を防ぐ）
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        if (cancelled || !containerRef.current) return
        // 通常画像は simple image 形式で表示（DZIタイル化なし・単一画像をOSDが扱う）
        const viewer = OpenSeadragon({
          element: containerRef.current,
          prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/',
          tileSources: { type: 'image', url: imageUrl },
          showNavigationControl: true,
          navigationControlAnchor: 'BOTTOM_RIGHT',
          gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
          minZoomImageRatio: 0.5,
          maxZoomPixelRatio: 4,
          visibilityRatio: 1,
          constrainDuringPan: true,
        })
        viewerRef.current = viewer
        viewer.addHandler('open', () => {
          if (cancelled) return
          setStatus('ready')
          // 画像を中央にフィット表示
          try { viewer.viewport.goHome(true) } catch { /* ignore */ }
        })
        viewer.addHandler('open-failed', () => {
          if (!cancelled) { setStatus('error'); setErrorMsg('画像の読み込みに失敗しました') }
        })
      } catch (e: unknown) {
        if (!cancelled) { setStatus('error'); setErrorMsg(e instanceof Error ? e.message : '表示エラー') }
      }
    })()
    return () => {
      cancelled = true
      if (viewerRef.current) { viewerRef.current.destroy(); viewerRef.current = null }
    }
  }, [imageUrl])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', zIndex: 9999 }}>
      {/* ヘッダー */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 48, zIndex: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', background: 'rgba(0,0,0,0.6)', color: 'white',
        fontFamily: 'sans-serif',
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title || '画像'}
        </span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer', lineHeight: 1,
        }}>×</button>
      </div>

      {/* OpenSeadragon コンテナ（ヘッダー48pxの下に確実に配置）*/}
      <div ref={containerRef} style={{ position: 'absolute', top: 48, left: 0, right: 0, bottom: 0 }} />

      {status === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontFamily: 'sans-serif', pointerEvents: 'none',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🖼</div>
            <div>画像を読み込み中...</div>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontFamily: 'sans-serif',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
            <div>{errorMsg}</div>
          </div>
        </div>
      )}
    </div>
  )
}
