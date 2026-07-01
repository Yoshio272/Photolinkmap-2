/**
 * Google Drive 連携用の GAS コード（gas-drive-api.gs）
 * WelcomeScreen のセットアップ手順から表示・コピーできるようにするための定数。
 * コードを更新する場合はこの文字列を差し替える。
 */
export const GAS_DRIVE_API_CODE = String.raw`/**
 * 現場調査ツール - Google Drive写真リンク取得API
 * Google Apps Script (GAS) - CORS対応版
 *
 * 【更新手順】
 * 1. script.google.com でプロジェクトを開く
 * 2. このコード全体を貼り替えて保存
 * 3. 「デプロイ」→「デプロイを管理」
 * 4. 鉛筆アイコンで編集 → バージョンを「新バージョン」に変更
 * 5. 「デプロイ」→ URLは変わらないのでそのまま使えます
 */

function doGet(e) {
  const callback = e.parameter.callback;
  const folderId = e.parameter.folderId;

  let result;

  try {
    if (!folderId) {
      result = { success: false, error: 'フォルダIDが指定されていません' };
    } else {
      let folder;
      try {
        folder = DriveApp.getFolderById(folderId);
      } catch (err) {
        result = { success: false, error: 'フォルダが見つかりません。IDを確認してください。' };
      }

      if (folder) {
        const files = [];
        const fileIterator = folder.getFiles();

        while (fileIterator.hasNext()) {
          const file = fileIterator.next();
          const mime = file.getMimeType();

          if (mime.startsWith('image/')) {
            // 共有設定：リンクを知っている全員が閲覧可能に
            try {
              file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            } catch (shareErr) {
              // 共有設定変更失敗は無視
            }

            files.push({
              name: file.getName(),
              url: 'https://drive.google.com/file/d/' + file.getId() + '/view',
              id: file.getId()
            });
          }
        }

        // ファイル名でソート
        files.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

        result = {
          success: true,
          folderName: folder.getName(),
          count: files.length,
          files: files
        };
      }
    }
  } catch (err) {
    result = { success: false, error: 'エラー: ' + err.message };
  }

  const json = JSON.stringify(result);

  // JSONP（callbackあり）またはJSON（なし）で返す
  // どちらもContent-Typeを適切に設定
  if (callback) {
    // JSONP形式 → CORSを回避できる
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    // JSON形式
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// テスト用
function testGetFiles() {
  const testFolderId = 'ここにフォルダIDを入力';
  const e = { parameter: { folderId: testFolderId, callback: 'test' } };
  const result = doGet(e);
  Logger.log(result.getContent());
}
`
