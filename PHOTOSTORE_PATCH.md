# Q-4: photoStore.ts への手動適用パッチ

対象ファイル: `src/features/photos/photoStore.ts`

## 修正内容: ObjectURL リーク対策

`REMOVE_PHOTO` アクション処理時に `revokeObjectURL` を呼ぶ。

```typescript
// photoStore.ts の reducer 内、REMOVE_PHOTO ケースを以下に修正:
case 'REMOVE_PHOTO': {
  const entry = state.find(e => e.id === action.id)
  // blob: URL の場合はメモリリークを防ぐために revoke する（Q-4）
  if (entry?.url?.startsWith('blob:')) {
    URL.revokeObjectURL(entry.url)
  }
  if (entry?.objectUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(entry.objectUrl)
  }
  return state.filter(e => e.id !== action.id)
}
```

## 注意
このファイルはプロジェクトファイルに含まれていないため、
GitHub リポジトリ上の src/features/photos/photoStore.ts を直接編集すること。
