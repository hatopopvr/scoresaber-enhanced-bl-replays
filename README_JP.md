[English version of this README](README.md)

# About

[Score Saber](https://scoresaber.com) のウェブサイトでアンランクのスコアにACCを追加するスクリプト scoresaber-unranked-acc の改造版です。このバージョンでは、[BeatLeader](https://www.beatleader.xyz/) API からBeatLeaderのReplayIdを含むスコアデータを取得し、リプレイリンクを生成します。[オリジナルのスクリプト](https://github.com/motzel/scoresaber-unranked-acc) は [motzel](https://github.com/motzel) 氏によって作成され、この改造版は hatopopvr が作成しています。


## インストール方法

まず、[Chrome/Edge Chromium 用の Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) を入手します。次に、[こちら](https://github.com/hatopopvr/scoresaber-enhanced-bl-replays/raw/master/scoresaber-enhanced-bl-replays.user.js) からスクリプトをインストールします。

**注意:** この改造版のスクリプトは Chrome でのみテストされています。他のブラウザでも動作するかもしれませんが、予期しない問題が発生する可能性があります。

## 既知の問題

このスクリプトは、CORS (Cross-Origin Resource Sharing) ポリシーの制約により、BeatLeader API からデータを取得できない問題があります。[CORS Unblock for Chrome](https://chrome.google.com/webstore/detail/cors-unblock/lfhmikememgdcahcdlaciloancbhjino) などのCORSを許可するブラウザ拡張機能を使用するなどして、この問題の回避する必要があります。

## データ保存について

本スクリプトは、Tampermonkeyが提供するローカルストレージ機能を利用し、各スコアのBeatLeaderから取得したスコアデータをキャッシュとして保存します。これは、BeatLeader APIへのリクエスト数を減らし、スクリプトのパフォーマンスを向上させるためのものです。保存されるデータには以下の項目が含まれます：

- Left hand accuracy (accLeft)
- Right hand accuracy (accRight)
- Replay id (id)
- Accuracy (accuracy)
- Full combo accuracy (fcAccuracy)
- Number of bad cuts (badCuts)
- Number of missed notes (missedNotes)
- Number of bomb cuts (bombCuts)
- Number of wall hits (wallHit)
- Number of pauses (pauses)
- Score improvement (scoreImprovement)

さらに、各スコアのplayerId、hash、difficulty、modifiedScore、modeも保存されます。これらのデータは、本スクリプトの機能を実現するためだけに使用され、他のスクリプトやサービスと共有されることはありません。