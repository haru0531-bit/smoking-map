# 喫煙所マップ 🚬

現在地周辺の喫煙所を地図で探せるWebアプリ。

## セットアップ

1. `.env.local.example` をコピーして `.env.local` にリネーム
2. `.env.local` の `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` に自分のGoogle Maps APIキーを記入
3. 依存関係インストール: `npm install`
4. 開発サーバー起動: `npm run dev`
5. ブラウザで http://localhost:3000 を開く

## 必要なGoogle Cloud API

- Maps JavaScript API
- Places API

## デプロイ

Vercelに連携してデプロイ。環境変数 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` をVercelの設定画面で登録すること。
