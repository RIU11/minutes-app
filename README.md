# 議事録アプリ（デモ版）

講義や会議を録音して、**話者の分け → 文字起こし → 要約 → 質問の提案** までを行うWebアプリ（PWA）です。

- 公開ページ：https://riu11.github.io/minutes-app/
- スマホ・パソコンのブラウザで動きます。ホーム画面に追加して使えます。

## できること

- **録音**：マイクで録音して、端末の中に保存します。「いま先生が話している」ボタンで、残したい人の声に印をつけられます。音声ファイルの読み込みもできます。
- **話者の分け**：声の特徴で A・B・C… に分けます。声を聞いて名前をつけ、関係ない人を「オフ」にすると、まとめ・質問・書き出しから外せます。
- **文字起こし**：端末の中の Whisper で文字にします。タップで手直し、一括置き換え、話者の付け替え、その部分の再生ができます。
- **要約**：概要・要点・大事な用語・決まったこと・宿題・次回を、見やすくまとめます。
- **質問の提案**：「理解を深める」「具体例」「試験対策」などの系統や、自由に書いた希望に合わせて質問を考えます。
- **書き出し**：テキスト（.txt）・Markdown（.md）・PDF。宿題はカレンダー（.ics）に追加できます。

## 部外秘と外部サービス

記録ごとに「部外秘」か「部外秘ではない」を選びます。

| | 部外秘 | 部外秘ではない |
|---|---|---|
| 文字起こし | 端末の中（Whisper） | Groq（Whisper large-v3）または Google Gemini |
| 要約・質問 | 端末の中のAI（WebLLM） | Google Gemini |
| 外部への送信 | **しない** | オンにした人の声と文字だけ |

- **部外秘にした記録はロックされ、二度と「部外秘ではない」に戻せません。** 送信の直前にも毎回確かめて、部外秘なら止めます。
- 外部サービスのキーは、その端末のブラウザの中にだけ保存します。キーの準備は、アプリの中の案内画面で進められます。
- 無料のサービスでは、送った内容がサービスの改善に使われることがあります。

## データの保存

録音・文字起こし・まとめは、すべて端末のブラウザの中（IndexedDB）に保存します。サーバーには保存しません。別の端末に移すときは、設定のバックアップか、記録ごとの「音声を書き出す」を使ってください。

## 使っているもの

- [Transformers.js](https://github.com/huggingface/transformers.js)（Apache-2.0）
  - Whisper（MIT）
  - pyannote segmentation-3.0（MIT）
  - WeSpeaker ResNet34（CC BY 4.0）
- [WebLLM](https://github.com/mlc-ai/web-llm)（Apache-2.0）
  - Gemma 2 2B JPN（Gemma Terms of Use）
  - Qwen3.5（Apache-2.0）
- [pdf-lib](https://github.com/Hopding/pdf-lib)、[fontkit](https://github.com/Hopding/fontkit)（MIT）
- フォント：[M PLUS 1p](https://fonts.google.com/specimen/M+PLUS+1p)（SIL Open Font License、`fonts/OFL.txt`）
- 外部サービス（部外秘ではない記録のみ）：Google Gemini API、Groq API

## 動かし方（開発）

ビルドは不要です。静的なファイルをそのまま配信します。

```
python3 -m http.server 8000
```

マイクと Service Worker は、`https://` か `http://localhost` でだけ動きます。

GitHub Pages では COOP/COEP ヘッダーを付けられないため、`sw.js` がヘッダーを足して crossOriginIsolated にしています。初回は自動で1回だけ読み込み直します。
