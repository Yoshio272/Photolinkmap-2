/**
 * Viewer360ModalResolved
 * StorageProvider経由で画像URLを解決してからPSVを表示するラッパー
 *
 * Web内ビューワーもPDF経由（ViewerPage）と同じ解決ロジックを使う:
 *   fileId → resolve360ImageUrl → image-proxy → PSV
 */
import { useEffect, useState } from 'react'
import type { Pin } from '../../types'
import { Viewer360Modal } from './Viewer360Modal'
import { resolve360ImageUrl, logViewerDebug } from '../../features/viewer/imageResolver'

interface Props {
  pin: Pin
  provider: string
  onClose: () => void
}

export function Viewer360ModalResolved({ pin, provider, onClose }: Props) {
  const [imageUrl, setImageUrl] = useState('')
  const [fetchInit, setFetchInit] = useState<RequestInit | undefined>(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    // fileId を最優先で使用（URLからの抽出もフォールバックで実施）
    let fileId = pin.media?.driveFileId
    const rawUrl = pin.media?.url || pin.link

    // URLからfileId抽出（保存データが古い場合の救済）
    if (!fileId && rawUrl) {
      const boxMatch = rawUrl.match(/app\.box\.com\/file\/(\d+)/)
      if (boxMatch) fileId = boxMatch[1]
      const driveMatch = rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
      if (driveMatch) fileId = driveMatch[1]
    }

    console.log('[Viewer360ModalResolved] pin:', pin.name, 'fileId:', fileId ?? '(none)', 'provider:', provider)

    resolve360ImageUrl(fileId, rawUrl, provider)
      .then(resolved => {
        logViewerDebug({
          fileId,
          storageProvider: provider,
          resolvedImageUrl: resolved.url,
          viewerType: 'photosphere',
          method: resolved.method,
        })
        setImageUrl(resolved.url)
        setFetchInit(resolved.fetchInit)
      })
      .catch(err => {
        console.error('[Viewer360ModalResolved] resolve failed:', err)
        setError(err instanceof Error ? err.message : '画像URLの解決に失敗しました')
      })
  }, [pin, provider])

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="bg-white rounded-xl p-6 max-w-sm mx-4 text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="text-sm text-gray-700 whitespace-pre-line mb-3">{error}</div>
          <button onClick={onClose} className="px-4 py-2 bg-[#1565C0] text-white rounded-lg text-sm font-semibold">閉じる</button>
        </div>
      </div>
    )
  }

  if (!imageUrl) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="text-white text-sm animate-pulse">360度画像を読み込み中...</div>
      </div>
    )
  }

  return <Viewer360Modal imageUrl={imageUrl} title={pin.name || '360度写真'} onClose={onClose} fetchInit={fetchInit} />
}
