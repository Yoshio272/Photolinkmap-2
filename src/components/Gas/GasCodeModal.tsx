/**
 * GasCodeModal - gas-drive-api.gs のコードを表示・コピーするモーダル
 * WelcomeScreen のセットアップ手順「gas-drive-api.gs」クリックで開く。
 */
import { useState } from 'react'
import { GAS_DRIVE_API_CODE } from '../../features/gas/gasDriveApiCode'

interface Props {
  onClose: () => void
}

export function GasCodeModal({ onClose }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(GAS_DRIVE_API_CODE)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard APIが使えない場合は選択を促す
      alert('コピーに失敗しました。コード内をドラッグして手動でコピーしてください。')
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 10, width: 760, maxWidth: '95vw', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}>
        {/* ヘッダー */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid #e5e7eb',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111' }}>gas-drive-api.gs</h3>
            <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
              このコードを script.google.com に貼り付けてデプロイしてください
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#666', lineHeight: 1 }}>×</button>
        </div>

        {/* コピーボタン */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={handleCopy}
            style={{
              fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6,
              background: copied ? '#1D9E75' : '#1565C0', color: 'white', border: 'none', cursor: 'pointer',
            }}>
            {copied ? '✓ コピーしました' : '📋 コード全体をコピー'}
          </button>
          <span style={{ fontSize: 11, color: '#999' }}>
            コピー後、GASエディタに貼り付けて保存 → デプロイ
          </span>
        </div>

        {/* コード本文 */}
        <div style={{ overflow: 'auto', flex: 1, padding: '14px 18px' }}>
          <pre style={{
            margin: 0, fontSize: 12, lineHeight: 1.5, fontFamily: 'monospace',
            whiteSpace: 'pre', color: '#1e293b', background: '#f8fafc',
            padding: 14, borderRadius: 6, border: '1px solid #e5e7eb',
          }}>{GAS_DRIVE_API_CODE}</pre>
        </div>

        {/* フッター */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid #e5e7eb', textAlign: 'right' }}>
          <button onClick={onClose}
            style={{
              fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 6,
              background: '#f0f0f0', color: '#555', border: '1px solid #ccc', cursor: 'pointer',
            }}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
