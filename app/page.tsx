import SmokingMap from "./components/SmokingMap";

export default function Home() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return (
      <main style={{ padding: 24 }}>
        <h1>設定エラー</h1>
        <p>
          環境変数 <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> が設定されていません。
        </p>
        <p>
          プロジェクト直下の <code>.env.local</code> ファイルにAPIキーを記入してください。
        </p>
      </main>
    );
  }

  return <SmokingMap apiKey={apiKey} />;
}
