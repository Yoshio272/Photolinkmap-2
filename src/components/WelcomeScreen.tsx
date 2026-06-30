import { useState } from 'react'

export function WelcomeScreen() {
  const [gasOpen, setGasOpen] = useState(false)

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-stone-200 z-10">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full mx-4">
        <div className="text-center mb-6">
          <div className="text-3xl font-bold text-[#1565C0] mb-1">PhotoLinkMap</div>
          <div className="text-sm text-gray-500">PDF図面から現場写真へ直接アクセス</div>
        </div>

        {/* 操作ステップ */}
        <div className="space-y-2 mb-6">
          {[
            { step: 1, label: '図面読込',    desc: '右カラム「設定」タブからPDF/JPG/PNGを選択', color: '#1565C0' },
            { step: 2, label: '基準点設定',  desc: '図面上の2点クリック → 緯度経度を入力',      color: '#1565C0' },
            { step: 3, label: '写真取込',    desc: '「写真」タブからiPhoneの写真を選択（GPS自動配置）', color: '#1565C0' },
            { step: 4, label: '配置調整',    desc: '「配置」タブでピンの向き・サイズを調整',    color: '#1565C0' },
            { step: 5, label: 'PDF出力',     desc: '「出力」タブからリンク付きPDFを生成',       color: '#1D9E75' },
          ].map(({ step, label, desc, color }) => (
            <div key={step} className="flex items-start gap-3 p-2.5 rounded-lg bg-gray-50">
              <div className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: color }}>{step}</div>
              <div>
                <div className="text-sm font-semibold text-gray-700">{label}</div>
                <div className="text-xs text-gray-500">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* GAS説明 折りたたみ */}
        <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 text-sm font-semibold text-gray-700 hover:bg-gray-100"
            onClick={() => setGasOpen(v => !v)}>
            <span>⚙ Google Drive連携 (GAS) セットアップ</span>
            <span className="text-gray-400 text-xs">{gasOpen ? '▲ 閉じる' : '▼ 開く'}</span>
          </button>
          {gasOpen && (
            <div className="px-4 py-3 text-xs text-gray-600 space-y-2 border-t border-gray-200">
              {[
                { s: 1, t: 'Google Driveに写真フォルダを作成',      d: '現場ごとにフォルダを作り写真をアップ' },
                { s: 2, t: 'Google Apps Scriptをデプロイ',          d: 'script.google.comでgas-drive-api.gsを貼付 → デプロイ（アクセス：全員）' },
                { s: 3, t: '設定タブにWebApp URLを登録',            d: 'URLとフォルダIDを右パネル設定タブへ（自動保存）' },
                { s: 4, t: '写真取込後に「Driveリンク取得」を実行', d: 'ファイル名マッチング → ピンにリンク自動設定' },
              ].map(({ s, t, d }) => (
                <div key={s} className="flex gap-2">
                  <span className="text-[#1565C0] font-bold w-12 flex-shrink-0">STEP{s}</span>
                  <div><div className="font-semibold text-gray-700">{t}</div><div className="text-gray-500">{d}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-center text-xs text-gray-400">
          → 右カラム「設定」タブの「図面を読み込む」から開始
        </div>
      </div>
    </div>
  )
}
