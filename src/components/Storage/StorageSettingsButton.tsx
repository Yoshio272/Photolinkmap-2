/**
 * StorageSettingsButton - 「保存先設定」ボタン＋モーダルの共通コンポーネント
 *
 * 図面モード（Toolbar）と地図モード（ヘッダー）の両方で使用する。
 * モーダルの中身は StorageSettingsPanel（Box/Drive/OneDrive/Dropbox・OAuth・接続確認など）。
 * ストレージ設定の実装は StorageSettingsPanel に一元化されており、ここはその表示器。
 */
import { useState } from 'react'
import type { StorageConfig } from '../../services/storage'
import { StorageSettingsPanel } from './StorageSettingsPanel'

interface Props {
  storageConfig: StorageConfig
  setStorageConfig: (c: StorageConfig) => void
  variant?: 'map' | 'toolbar'   // ヘッダーのデザインに合わせる（map=地図モード / toolbar=図面モード）
}

export function StorageSettingsButton({ storageConfig, setStorageConfig, variant = 'map' }: Props) {
  const [open, setOpen] = useState(false)

  // ヘッダーごとにボタンの見た目を合わせる（高さ・余白の統一）
  const buttonNode = variant === 'toolbar' ? (
    // 図面モード：既存の btn クラスに揃える（px-3 py-1.5 相当）
    <button onClick={() => setOpen(true)} className="btn" style={{ borderColor: '#1D9E75', color: '#0F6E56' }}>
      📁 保存先設定
    </button>
  ) : (
    // 地図モード：インラインstyle（padding 4px 10px）
    <button
      onClick={() => setOpen(true)}
      style={{
        fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
        border: '1px solid #1D9E75', background: 'white', color: '#0F6E56', cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}>
      📁 保存先設定
    </button>
  )

  return (
    <>
      {buttonNode}

      {/* モーダル */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 10, padding: 20, width: 440, maxWidth: '92vw',
              boxShadow: '0 8px 32px rgba(0,0,0,0.25)', maxHeight: '85vh', overflow: 'auto',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>📁 保存先設定</h3>
              <button onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666', lineHeight: 1 }}>×</button>
            </div>

            {/* ストレージ設定の共通コンポーネント（フル機能）*/}
            <StorageSettingsPanel storageConfig={storageConfig} setStorageConfig={setStorageConfig} />

            <button onClick={() => setOpen(false)}
              style={{
                width: '100%', marginTop: 12, padding: 10, fontSize: 14, fontWeight: 600,
                background: '#1D9E75', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer',
              }}>
              完了
            </button>
          </div>
        </div>
      )}
    </>
  )
}
