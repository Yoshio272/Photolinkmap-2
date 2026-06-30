/**
 * Box OAuth コールバックページ
 * /auth/box/callback
 *
 * Box認証後にリダイレクトされるページ。
 * URLから認証コードを取得し、親ウィンドウにpostMessageで送信。
 */
export function BoxCallbackPage() {
  const params = new URLSearchParams(window.location.search)
  const code  = params.get('code')
  const error = params.get('error')
  const desc  = params.get('error_description')

  if (code) {
    window.opener?.postMessage({ type: 'box-oauth-callback', code }, window.location.origin)
    window.close()
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="bg-white rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">✅</div>
          <div className="font-semibold text-gray-800">Box認証が完了しました</div>
          <div className="text-sm text-gray-500 mt-1">このウィンドウは自動的に閉じられます</div>
        </div>
      </div>
    )
  }

  if (error) {
    window.opener?.postMessage({
      type: 'box-oauth-callback',
      error: desc ?? error,
    }, window.location.origin)
    window.close()
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="bg-white rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">❌</div>
          <div className="font-semibold text-gray-800">Box認証に失敗しました</div>
          <div className="text-sm text-red-500 mt-1">{desc ?? error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="text-white text-sm">処理中...</div>
    </div>
  )
}
