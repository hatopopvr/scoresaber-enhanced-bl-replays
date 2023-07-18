/*
  This script is a modified version of the "ScoreSaber unranked ACC" UserScript.
  Original script by motzel can be found at:
  https://github.com/motzel/scoresaber-unranked-acc

  Modifications by hatopopvr:
  - Added feature to fetch and display BeatLeader Replay IDs

*/

/*
  This script has a known issue with CORS (Cross-Origin Resource Sharing) policy, which may prevent it from fetching data from the BeatLeader API.
  A possible workaround for this is to use a browser extension that allows CORS, such as 'CORS Unblock' for Chrome.

  Additionally, this script implements a caching feature for ReplayId.
  Using Tampermonkey's built-in local storage functionality, it stores the ReplayId of each score as a cache.
  This helps in reducing the number of requests made to the BeatLeader API, thereby enhancing the script's performance.
  The data stored includes the playerId, hash, difficulty, modifiedScore, and corresponding ReplayId for each score.
  This data is solely used for facilitating the functionalities of this script and is not shared with any other scripts or services.
*/


// ==UserScript==
// @name         ScoreSaber Enhanced BL Replays (Modified by hatopopvr)
// @namespace    hatopopvr
// @version      0.3.0
// @description  ScoreSaber Enhancements with additional features (Based on version 0.4 of the original script)
// @author       hatopopvr (Original author: motzel)
// @icon         https://scoresaber.com/favicon-32x32.png
// @updateURL    https://github.com/hatopopvr/scoresaber-enhanced-bl-replays/raw/master/scoresaber-enhanced-bl-replays.user.js
// @downloadURL  https://github.com/hatopopvr/scoresaber-enhanced-bl-replays/raw/master/scoresaber-enhanced-bl-replays.user.js
// @supportURL   https://github.com/hatopopvr/scoresaber-enhanced-bl-replays/issues
// @match        https://scoresaber.com/u/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function (window) {
  "use strict";

  if (window.XMLHttpRequest.prototype.interceptorApplied) return;

  const AFTER_RESPONSE_DELAY = 800;
  const AFTER_HISTORY_DELAY = 1000;
  const LOCAL_STORAGE_KEY = 'beatSaverCache';
  const LOCAL_STORAGE_SAVE_DELAY = 1000;

  const difficulties = {
    1: 'Easy',
    3: 'Normal',
    5: 'Hard',
    7: 'Expert',
    9: 'ExpertPlus',
  };

  const modes = {
      'SoloStandard': 'Standard',
      'SoloLawless': 'Lawless',
  };

  let lastParams = null;
  const scoresCache = {};

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const getParamsHash = params => JSON.stringify(params);

  const matchSiteUrl = url => url.match(/\/u\/(\d+)(?:\?page=(\d+)&sort=(.*))?$/);
  const matchApiUrl = url => url.match(/\/api\/player\/(\d+)\/scores(?:\?page=(\d+)&sort=(.*))?$/);
  const getUrlData = (url, matcher) => {
    const match = matcher(url);
    if (!match) return null;

    const playerId = match[1];
    let page = parseInt(match[2], 10);
    if (isNaN(page)) page = 1;
    const sort = match[3] === 'recent' ? 'recent' : 'top';

    return {playerId, page, sort};
  }

  function fallbackCopyTextToClipboard(text) {
    const textArea = window.document.createElement("textarea");
    textArea.value = text;

    // Avoid scrolling to bottom
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";

    window.document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      window.document.execCommand('copy');
    } catch (err) {
      console.error('Fallback: Oops, unable to copy to clipboard', err);
    }

    window.document.body.removeChild(textArea);
  }

  function copyToClipboard(text) {
    window.navigator.permissions.query({name: 'clipboard-write'})
      .then(result => {
        if (result.state === 'granted' || result.state === 'prompt') {
          window.navigator.clipboard.writeText(text);
        } else {
          fallbackCopyTextToClipboard(text);
        }
      })
      .catch(() => fallbackCopyTextToClipboard(text))
    ;
  }

  const getMaxScore = (blocks, maxScorePerBlock = 115) =>
    Math.floor(
      (blocks >= 14 ? 8 * maxScorePerBlock * (blocks - 13) : 0) +
      (blocks >= 6
        ? 4 * maxScorePerBlock * (Math.min(blocks, 13) - 5)
        : 0) +
      (blocks >= 2
        ? 2 * maxScorePerBlock * (Math.min(blocks, 5) - 1)
        : 0) +
      Math.min(blocks, 1) * maxScorePerBlock
    );

  const beatSaverService = (() => {
    let inProgress = {};

    const cache = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY)) ?? {};

    let cacheSaveTimeoutId = null;
    const getCached = hash => cache[hash];
    const setCache = (hash, value) => {
      cache[hash] = value;

      if (cacheSaveTimeoutId) clearTimeout(cacheSaveTimeoutId);
      cacheSaveTimeoutId = setTimeout(() => window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cache)), LOCAL_STORAGE_SAVE_DELAY);

      return value;
    }

    const fetchData = async hash => fetch(`https://api.beatsaver.com/maps/hash/${hash}`).then(async r => ({response: r, body: await r.json()}));

    const byHash = async hash => {
      if (!hash?.length) return null;

      hash = hash.toUpperCase();

      try {
        const cachedData = getCached(hash);
        if (cachedData !== undefined) return cachedData;

        if (!inProgress[hash]) {
          inProgress[hash] = fetchData(hash);
        }

        const promise = await inProgress[hash];
        if (promise.response.status === 404) {
          // store null so that this hash is never retrieved again
          return setCache(hash, null);
        }

        if (!promise.response.ok) throw `HTTP ${promise.response.status} error`;

        const data = promise.body;

        const id = data?.id ?? null;
        const bpm = data?.metadata?.bpm ?? null;
        const versions = data?.versions ?? null;

        if (!id || !bpm || !versions?.length || !versions?.[versions.length - 1]?.diffs) throw `API returned invalid data`;

        return setCache(hash, {hash, id, bpm, diffs: versions?.[versions.length - 1]?.diffs});
      } catch (e) {
        console.error(`An error occurred while downloading song data (${hash}) from Beat Saver: ${e.toString()}`);

        return null;
      } finally {
        delete (inProgress[hash]);
      }
    }

    return {
      byHash,
    }
  })();

  const enhance = async params => {
    const paramsHash = getParamsHash(params);
    const scores = scoresCache[paramsHash];

      // 表示制御ボタンがクリックされたときに実行する関数
      function hiddenButtonClick(buttonId, className) {
          // console.log("hidden Button clicked");
          let elements = document.getElementsByClassName(className);
          let displayState = GM_getValue(buttonId, "inline");
          displayState = (displayState === "none") ? "inline" : "none";

          for(let i = 0; i < elements.length; i++){
              elements[i].style.display = displayState;
          }

          GM_setValue(buttonId, displayState);
          return displayState;
      }

      // 幅制御ボタンがクリックされたときに実行する関数
      function widthButtonClick(buttonId, className) {
        // console.log("width Button clicked");
        let elements = document.getElementsByClassName(className);
        let displayState = GM_getValue(buttonId, "inline");
        displayState = (displayState === "none") ? "inline" : "none";

        // 取得した各要素に対してスタイルを適用する
        for (let i = 0; i < elements.length; i++) {
          if (displayState === "none") {
            // もし現在がautoなら、130pxに設定する
            elements[i].style.width = '130px';
            elements[i].style.textAlign = 'center';
            elements[i].style.margin = '2px 2px';
            elements[i].style.padding = '5px 0px';

          } else {
            // もし現在が130pxなら、autoに設定する
            elements[i].style.width = 'auto';
            elements[i].style.margin = '4px 5px';
            elements[i].style.padding = '5px 7px';
          }
        }
        GM_setValue(buttonId, displayState);
        return displayState;

      }


      // infoボタンにclass付与
      function addClassToInfoButton(){
          // 指定した要素を全て取得します。
          let elements = document.querySelectorAll('span.stat.clickable.svelte-1hsacpa > i.fas.fa-info-circle');

          // それぞれの要素について、親要素のclass属性を更新します。
          for(let i = 0; i < elements.length; i++) {
              let parentSpan = elements[i].parentNode;
              parentSpan.className = "stat clickable svelte-1hsacpa info-c";
          }
      }

      addClassToInfoButton();

      // アイコンに対応するHTMLを返す関数
      function getIconHTML(displayState, buttonText, buttonActive="fa-eye", buttonInActive="fa-eye-slash") {
        const iconClass = displayState === "none" ? buttonInActive : buttonActive;
        return `<span class="icon"><i class="fas ${iconClass} svelte-15752pe"></i></span> <span>${buttonText}</span>`;
      }

      // 新たなボタンを作成し設定する関数
      function createAndConfigureButton(btn, displayState, className="button btn-setting svelte-15752pe", buttonActive="fa-eye", buttonInActive="fa-eye-slash") {
        let newButton = document.createElement("button");
        newButton.id = btn.id; // idを設定
        newButton.className = `${className}`; // クラス名を設定　// ←ここが原因でセッティングボタン消えてる
        //newButton.innerHTML = getIconHTML(displayState, btn.buttonText, buttonActive, buttonInActive); // ボタンの中身を設定
        newButton.innerHTML = getIconHTML(displayState, btn.buttonText, btn.active, btn.inActive); // ボタンの中身を設定
        newButton.onclick = function() {

          if (btn.type === "hidden") {
            let newDisplayState = hiddenButtonClick(btn.id, btn.className);
            newButton.innerHTML = getIconHTML(newDisplayState, btn.buttonText, btn.active, btn.inActive);
          }
          if (btn.type === "width") {
            let newDisplayState = widthButtonClick(btn.id, btn.className);
            newButton.innerHTML = getIconHTML(newDisplayState, btn.buttonText, btn.active, btn.inActive);
          }
            // let newDisplayState = hiddenButtonClick(btn.id, btn.className);
            // newButton.innerHTML = getIconHTML(newDisplayState, btn.buttonText, buttonActive, buttonInActive);
        };
        return newButton;
      }

      // ボタンを生成する関数
      function createButton(buttonContainer, btn, className="button btn-setting svelte-15752pe", buttonActive="fa-eye", buttonInActive="fa-eye-slash") {
        let existingButton = document.querySelector("#" + btn.id);

        if (!existingButton) {
            let displayState = GM_getValue(btn.id, "inline");
            let newButton = createAndConfigureButton(btn, displayState, className, buttonActive, buttonInActive);
            // 新たなボタンをコンテナに追加する
            buttonContainer.appendChild(newButton);
        }
      }

      // スタイルを適用する関数
      function applyStyle(targetBtn){
        if (targetBtn.type === "hidden") {
          let elements = document.getElementsByClassName(targetBtn.className);
          for(let i = 0; i < elements.length; i++){
              elements[i].style.display = GM_getValue(targetBtn.id, "inline");
          }
        }
        if (targetBtn.type === "width") {
          let displayState = GM_getValue(targetBtn.id, "inline");
          let elements = document.getElementsByClassName(targetBtn.className);
          // 取得した各要素に対してスタイルを適用する
          for (let i = 0; i < elements.length; i++) {
            if (displayState === "none") {
              // もし現在がautoなら、130pxに設定する
              elements[i].style.width = '130px';
              elements[i].style.textAlign = 'center';
              elements[i].style.margin = '2px 2px';
              elements[i].style.padding = '5px 0px';

            } else {
              // もし現在が130pxなら、autoに設定する
              elements[i].style.width = 'auto';
              elements[i].style.margin = '4px 5px';
              elements[i].style.padding = '5px 7px';
            }
          }
        }
      }

      // ボタンの生成とスタイルの適用を行う関数
      function generateAndApplyButtons(buttonContainer, buttons, className="button btn-setting svelte-15752pe", buttonActive="fa-eye", buttonInActive="fa-eye-slash") {
        for(let btn of buttons) {
          createButton(buttonContainer, btn, className, buttonActive, buttonInActive);
          applyStyle(btn);
        }
      }


      // 表示制御ボタンのリスト
      let buttons = [
          { id: "toggleButtonId1", className: "lr-acc", buttonText: "LR", type: "hidden", active:"fa-eye", inActive:"fa-eye-slash" },
          { id: "toggleButtonId2", className: "hide-details", buttonText: "detail", type: "hidden", active:"fa-eye", inActive:"fa-eye-slash" },
          { id: "toggleButtonId3", className: "imprv", buttonText: "+", type: "hidden", active:"fa-eye", inActive:"fa-eye-slash" },
          { id: "toggleButtonId4", className: "info-c", buttonText: "info", type: "hidden", active:"fa-eye", inActive:"fa-eye-slash" },
          { id: "toggleButtonId5", className: "bsr", buttonText: "!bsr", type: "hidden", active:"fa-eye", inActive:"fa-eye-slash" },
          { id: "toggleButtonId6", className: "beatsaver", buttonText: "BeatSaver", type: "hidden", active:"fa-eye", inActive:"fa-eye-slash" },
          { id: "toggleButtonId7", className: "replay", buttonText: "▶", type: "hidden", active:"fa-eye", inActive:"fa-eye-slash" },
          { id: "toggleButtonId8", className: "stat", buttonText: "width", type: "width", active:"fa-compress", inActive:"fa-expand" },
      ];

    if (!scores || paramsHash !== getParamsHash(getUrlData(window.location.href, matchSiteUrl))) return;

    [...document.querySelectorAll('.ranking.songs .table-item')]
      .forEach((el, idx) => {

        if (!scores?.[idx]?.maxScore || !scores?.[idx]?.baseScore) return;

        const songImage = el.querySelector('.song-image');
        if (!songImage) return;

        const imageMatch = songImage.src.match(/covers\/(.*?)\..*?$/);
        if (!imageMatch?.[1]?.length) return;

        // check the hash to be sure
        const hash = imageMatch[1].toUpperCase();
        if (hash !== scores[idx]?.hash) return;

        const scoreInfoChilds = [...el.querySelectorAll('.scoreInfo > div')];

        const firstEl = scoreInfoChilds?.[0]; //

        const lastEl = scoreInfoChilds?.[scoreInfoChilds?.length - 1];

        if (!scoreInfoChilds?.length || lastEl.querySelector('.bsr')) return;

        const existingElClassName = scoreInfoChilds[0].className;

        if (scores?.[idx]?.beatSaver?.id) {
          const bsrBtn = window.document.createElement('span');
          bsrBtn.title = `!bsr ${scores[idx].beatSaver.id}`;
          bsrBtn.className = `stat clickable bsr ${existingElClassName}`;

          const icon = window.document.createElement('i');
          icon.className = 'fas fa-exclamation';
          bsrBtn.append(icon);

          lastEl.append(bsrBtn);

          bsrBtn.addEventListener('click', () => copyToClipboard(bsrBtn.title));
        }

        // skip adding the beatSaverButton if it's already in there
        if (!lastEl.querySelector('.beatsaver')){
          if (scores?.[idx]?.beatSaver.id) {
            const beatSaverMaplink = `https://beatsaver.com/maps/${scores[idx].beatSaver.id}`

            const beatSaverButton = window.document.createElement('button');
            beatSaverButton.title = 'BeatSaver';
            //beatSaverButton.className = `stat clickable ${existingElClassName}`;
            beatSaverButton.className = `stat clickable beatsaver ${existingElClassName}`;
            beatSaverButton.innerHTML = "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 200 200' version='1.1'><g fill='none' stroke='#000000' stroke-width='10'> <path d='M 100,7 189,47 100,87 12,47 Z' stroke-linejoin='round'/> <path d='M 189,47 189,155 100,196 12,155 12,47' stroke-linejoin='round'/> <path d='M 100,87 100,196' stroke-linejoin='round'/> <path d='M 26,77 85,106 53,130 Z' stroke-linejoin='round'/> </g> </svg>";
            beatSaverButton.style.width = '30px';
            beatSaverButton.style.height = '30px';
            beatSaverButton.style.padding = '3.2px 0px';

            const beatSaverButtonLink = window.document.createElement('a');
            beatSaverButtonLink.href = beatSaverMaplink;
            beatSaverButtonLink.target = "_blank";
            beatSaverButtonLink.prepend(beatSaverButton);

            lastEl.append(beatSaverButtonLink);
          }
        }

        // skip if replayBtn is already added
        if (lastEl.querySelector('.replay')) return;


        // Function to extract necessary information from the provided data and create a new object
        function extractRequiredData(data) {
            return {
                accLeft: data.accLeft,
                accRight: data.accRight,
                id: data.id,
                accuracy: data.accuracy,
                fcAccuracy: data.fcAccuracy,
                badCuts: data.badCuts,
                missedNotes: data.missedNotes,
                bombCuts: data.bombCuts,
                wallHit: data.wallHit,
                pauses: data.pauses,
                scoreImprovement: data.scoreImprovement
            };
        }

        // Function to generate a key using the playerId, hash, difficulty, modifiedScore, and mode as arguments
        function generateKey(playerId, hash, difficulty, modifiedScore, mode) {
            return playerId + hash + difficulty + modifiedScore + mode;
        }

        /**
         * This function is aimed to retrieve the score data including ReplayId from the BeatLeader API.
         * Note: This script has a known issue with CORS (Cross-Origin Resource Sharing) policy,
         * which may prevent it from fetching data from the BeatLeader API.
         * A possible workaround for this is to use a browser extension that allows CORS, such as 'CORS Unblock' for Chrome.
         *
         * Additionally, this script implements a caching feature for the retrieved BeatLeader score data.
         * Using Tampermonkey's built-in local storage functionality, it stores the retrieved BeatLeader score data as a cache.
         * This helps in reducing the number of requests made to the BeatLeader API, thereby enhancing the script's performance.
         * The data stored includes the playerId, hash, difficulty, modifiedScore, and relevant score data including ReplayId.
         * This data is solely used for facilitating the functionalities of this script and is not shared with any other scripts or services.
         *
         * Function to retrieve BeatLeader score data for a given key.
         * If the data specified by the key does not exist in the storage, it retrieves it from the API.
         *
         * @param {string} playerId - The unique identifier of the player.
         * @param {string} hash - The unique hash of the song.
         * @param {string} difficulty - The difficulty level of the song.
         * @param {number} modifiedScore - The modified score of the player for the song.
         * @param {string} mode - The game mode (default: "Standard").
         * @returns {object|null} The BeatLeader score data if available; null otherwise.
         */
        async function fetchOrGetBeatLeaderScoreData(playerId, hash, difficulty, modifiedScore, mode = "Standard") {
            const key = generateKey(playerId, hash, difficulty, modifiedScore, mode);
            let beatLeaderScoreData = GM_getValue(key);

            if (!beatLeaderScoreData) {
                const url = `https://api.beatleader.xyz/player/${playerId}/scores?sortBy=date&page=1&count=5000&search=${hash}&diff=${difficulty}&mode=${mode}`;
                console.log(url);
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                if (!data.data[0]) {
                    return null; // return null if no data is available
                }
                beatLeaderScoreData = extractRequiredData(data.data[0]);
                GM_setValue(key, beatLeaderScoreData);
            }

            return beatLeaderScoreData;
        }

        if (scores[idx].modifiedScore) {
            const playerId = params.playerId;
            const hash = scores[idx].hash;
            const difficulty = scores[idx].beatSaver.diff.difficulty;
            const modifiedScore = scores[idx].modifiedScore;
            const gameMode = scores[idx].difficulty.gameMode;
            const mode = modes[gameMode] || 'Standard';

            console.log(scores[idx]);

            // Replayボタンの作成と設定
            function createReplayButton(existingElClassName, fcAccText, accLeftText, accRightText, pausesText, link) {
              const replayButton = window.document.createElement('button');
              replayButton.title = `BL-Replay\nFcAcc: ${fcAccText}%\nAccLeft: ${accLeftText}\nAccRight: ${accRightText}\nPauses: ${pausesText}`;
              //replayButton.className = `stat clickable bsr replay ${existingElClassName}`;
              replayButton.className = `stat clickable replay ${existingElClassName}`;
              replayButton.style.color = "#FFFFFF";
              const icon = window.document.createElement('i');
              icon.className = 'fas fa-play';
              replayButton.append(icon);
              const replayLink = window.document.createElement('a');
              replayLink.href = link;
              replayLink.target = "_blank";
              replayLink.prepend(replayButton);

              //const songImage = el.querySelector('.song-image');

              // Replayボタンと同様のリンクを作成
              const imageLink = document.createElement('a');
              imageLink.href = link; // ここにリンク先のURLを設定します。
              imageLink.target = "_blank";
              imageLink.title = `BL-Replay\nFcAcc: ${fcAccText}%\nAccLeft: ${accLeftText}\nAccRight: ${accRightText}\nPauses: ${pausesText}`;

              // 画像をリンクに包む
              imageLink.appendChild(songImage.cloneNode(true)); // 画像要素をクローンしてリンクの子要素として追加

              // 元の画像要素をリンクで置き換え
              songImage.parentNode.replaceChild(imageLink, songImage);

              return replayLink;
            }

            // LeftとRightのスコア表示エレメントの作成
            function createScoreElements(accLeftText, accRightText) {
              const leftDiv = createScoreElement('stat acc lr-acc svelte-1hsacpa', '#f14668', 'AccLeft', accLeftText);
              const rightDiv = createScoreElement('stat acc lr-acc svelte-1hsacpa', '#192dfb', 'AccRight', accRightText);

              return { leftDiv, rightDiv };
            }

            function createScoreElement(className, bgColor, title, text) {
              const div = window.document.createElement('span');
              div.className = className;
              div.style.backgroundColor = bgColor;
              const span = window.document.createElement('span');
              //span.className = 'info svelte-1hsacpa imprv';
              span.className = 'info svelte-1hsacpa';
              span.style.color = 'white';
              span.textContent = text;
              span.title = title;
              div.append(span);

              return div;
            }

            // Improvement情報の追加
            function addImprovementInformation(firstEl, lastEl, leftDiv, rightDiv, beatLeaderScoreData) {
              // Add improvement information
              if (beatLeaderScoreData.scoreImprovement.accuracy !== 0) {
                  addAccuracyImprovement(firstEl, beatLeaderScoreData);
                  addAccLeftImprovement(leftDiv, beatLeaderScoreData);
                  addAccRightImprovement(rightDiv, beatLeaderScoreData);
                  addMissedBadCutImprovement(lastEl, beatLeaderScoreData);
              }
            }

            // Accuracy improvementの追加
            function addAccuracyImprovement(firstEl, beatLeaderScoreData) {
              const accSpan = firstEl.querySelector('span[title="Accuracy"]');

              if (accSpan && beatLeaderScoreData.scoreImprovement !== undefined) {
                  const accImprovementPercent = (beatLeaderScoreData.scoreImprovement.accuracy * 100).toFixed(2);
                  const accImprovementSpan = document.createElement('span');
                  accImprovementSpan.textContent = ` +${accImprovementPercent}%`;
                  accImprovementSpan.className = "small info svelte-1hsacpa imprv";
                  accSpan.appendChild(accImprovementSpan);
              }
            }

            // AccLeft improvementの追加
            function addAccLeftImprovement(leftDiv, beatLeaderScoreData) {
              const accLeftImprovementPercent = (beatLeaderScoreData.scoreImprovement.accLeft).toFixed(2);
              const accLeftImprovementSpan = document.createElement('span');
              accLeftImprovementSpan.textContent = ` ${accLeftImprovementPercent > 0 ? "+" : ""}${accLeftImprovementPercent}`;
              accLeftImprovementSpan.className = "small info svelte-1hsacpa imprv";
              leftDiv.appendChild(accLeftImprovementSpan);
            }

            // AccRight improvementの追加
            function addAccRightImprovement(rightDiv, beatLeaderScoreData) {
              const accRightImprovementPercent = (beatLeaderScoreData.scoreImprovement.accRight).toFixed(2);
              const accRightImprovementSpan = document.createElement('span');
              accRightImprovementSpan.textContent = ` ${accRightImprovementPercent > 0 ? "+" : ""}${accRightImprovementPercent}`;
              accRightImprovementSpan.className = "small info svelte-1hsacpa imprv";
              rightDiv.appendChild(accRightImprovementSpan);
            }

            // Missed & Bad Cut improvementの追加
            function addMissedBadCutImprovement(lastEl, beatLeaderScoreData) {
              const elements = [...lastEl.querySelectorAll('[title*="Missed"], [title*="Full Combo"]')];

              elements.forEach(element => {
                  let missedValue = 0;
                  let badCutValue = 0;

                  // Only extract values if title contains 'Missed'
                  if (element.title.includes("Missed")) {
                      const { missedValue: extractedMissed, badCutValue: extractedBadCut } = extractValuesFromTitle(element.title);
                      missedValue = extractedMissed;
                      badCutValue = extractedBadCut;
                  }

                  const totalNotesImprovement = beatLeaderScoreData.scoreImprovement.missedNotes + beatLeaderScoreData.scoreImprovement.badCuts;
                  const missImprovement = missedValue + badCutValue - totalNotesImprovement;
                  const missImprovementSpan = document.createElement('span');
                  if (missImprovement === 0) {
                      missImprovementSpan.textContent = ' vs FC';
                  } else {
                      missImprovementSpan.textContent = ` vs ${missImprovement}`;
                  }
                  //missImprovementSpan.className = "small info svelte-1hsacpa imprv";
                  missImprovementSpan.className = "small svelte-1hsacpa imprv";
                  element.appendChild(missImprovementSpan);
                  //console.log(element);
              });
            }

            // Missed & Bad Cut valuesの抽出
            function extractValuesFromTitle(title) {
              const missedMatch = title.match(/Missed: (\d+)/);
              const missedValue = missedMatch ? Number(missedMatch[1]) : 0;

              const badCutMatch = title.match(/Bad Cut: (\d+)/);
              const badCutValue = badCutMatch ? Number(badCutMatch[1]) : 0;

              return { missedValue, badCutValue };
            }



            fetchOrGetBeatLeaderScoreData(playerId, hash, difficulty, modifiedScore, mode).then(beatLeaderScoreData => {
                if (beatLeaderScoreData !== null) {
                    // console.log(beatLeaderScoreData);

                    const link = `https://replay.beatleader.xyz/?scoreId=${beatLeaderScoreData.id}`;
                    // Ensure that accLeft, accRight, and pauses are defined, else display 'N/A'
                    const fcAccText = beatLeaderScoreData.fcAccuracy !== undefined ? (beatLeaderScoreData.fcAccuracy * 100).toFixed(2) : 'N/A';
                    const accLeftText = beatLeaderScoreData.accLeft !== undefined ? beatLeaderScoreData.accLeft.toFixed(2) : 'N/A';
                    const accRightText = beatLeaderScoreData.accRight !== undefined ? beatLeaderScoreData.accRight.toFixed(2) : 'N/A';
                    const pausesText = beatLeaderScoreData.pauses !== undefined ? beatLeaderScoreData.pauses : 'N/A';

                    // createReplayButton
                    const replayLink = createReplayButton(existingElClassName, fcAccText, accLeftText, accRightText, pausesText, link)
                    lastEl.append(replayLink);
                    //newDiv.append(replayLink);

                    // create nextEL & Left Right Acc Element
                    const nextDiv = document.createElement('div');
                    nextDiv.className = "svelte-1hsacpa nextEl";
                    const nextEl = firstEl.nextSibling;
                    const parentEl = firstEl.parentNode;
                    parentEl.insertBefore(nextDiv, nextEl);

                    const { leftDiv, rightDiv } = createScoreElements(accLeftText, accRightText)
                    nextDiv.append(leftDiv, rightDiv);

                    // addImprovementInformation
                    addImprovementInformation(firstEl, lastEl, leftDiv, rightDiv, beatLeaderScoreData);

                    console.log(link);

                } else {
                    if (scores[idx].pp && scores[idx].rank <= 500) {
                        const link = `https://www.replay.beatleader.xyz/?id=${scores[idx].beatSaver.id}&difficulty=${scores[idx].beatSaver.diff.difficulty}&playerID=${params.playerId}`

                        const replayButton = window.document.createElement('button');
                        replayButton.title = 'SS-Replay';
                        replayButton.className = `stat clickable bsr ${existingElClassName}`;
                        replayButton.style.color = "#FFDE18";

                        const icon = window.document.createElement('i');
                        icon.className = 'fas fa-play';
                        replayButton.append(icon);

                        const replayLink = window.document.createElement('a');
                        replayLink.href = link;
                        replayLink.target = "_blank";
                        replayLink.prepend(replayButton);
                        lastEl.append(replayLink);
                        console.log(link);
                    }
                }
                // apply style
                generateAndApplyButtons(buttonContainer, buttons)
            });

        }

        // skip if acc stat is already added
        if (scoreInfoChilds?.length !== 1 || scoreInfoChilds[0].querySelector('.stat.acc')) return;

        const acc = (scores[idx].baseScore / scores[idx].maxScore * 100) / (scores[idx]?.multiplier ?? 1);

        const newSpanEl = window.document.createElement('span');
        newSpanEl.title = 'Accuracy';
        newSpanEl.className = `stat acc ${existingElClassName}`;
        newSpanEl.innerText = acc.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }) + '%';

        scoreInfoChilds[0].prepend(newSpanEl);
      });

      // button-containerを取得
      let buttonContainerOrg = document.querySelector('.button-container');
      // button-containerを取得
      let buttonGroupOrg = document.querySelector('.button-container .btn-group');

      let buttonContainer = document.createElement('div');

      // 重複回避
      let exsistingButtonContainer = document.querySelector('.button-container.btn-group.settings.svelte-1fr0rvk');
      if (!exsistingButtonContainer){
        buttonContainer.className = 'button-container btn-group settings svelte-1fr0rvk'; // クラス名を設定します
        // button-containerの後に新しいdiv要素を挿入
        buttonContainerOrg.parentNode.insertBefore(buttonContainer, buttonContainerOrg.nextSibling);
      }

      // settingボタンの作成
      let settingBtn = { id: "btnSettingParent", className: "btn-setting", buttonText: "Setting", type: "hidden", active:"fa-cog", inActive:"fa-cog" };
      createButton(buttonGroupOrg, settingBtn, "button svelte-15752pe", "fa-cog", "fa-cog")

      // 表示制御などの各種ボタンの作成
      generateAndApplyButtons(buttonContainer, buttons) // , buttonActive="fa-eye", buttonInActive="fa-eye-slash") {

      applyStyle(settingBtn);

  }

  const fetchBeatSaverData = async (scores, params) => {
    const hashes = [...new Set(scores.map(s => s?.hash).filter(h => h))];
    if (!hashes.length) return;

    const beatSaverData = (await Promise.all(
      hashes
        .map(hash => beatSaverService.byHash(hash))
        .concat([delay(AFTER_RESPONSE_DELAY)])
    ))
      .filter(bs => bs);
    if (!beatSaverData.length) return;

    const beatSaverObj = beatSaverData.reduce((obj, bs) => ({...obj, ...{[bs.hash]: bs}}), {});

    scoresCache[getParamsHash(params)] = scores.map(s => {
      const hash = s?.hash?.toUpperCase();

      if (!beatSaverObj[hash]) return;

      const beatSaver = {id: beatSaverObj[hash].id, bpm: beatSaverObj[hash].bpm};

      const characteristic = s?.difficulty?.gameMode
        ?.replace('Solo', '')
        ?.replace('OldDots', ''); // Support for https://github.com/PulseLane/FuckNewDots
      const difficulty = difficulties[s?.difficulty?.difficulty] ?? null;

      if (characteristic && difficulty) {
        beatSaver.diff = (beatSaverObj[hash]?.diffs ?? []).find(d => d.characteristic === characteristic && d.difficulty === difficulty) ?? null;
      }

      const maxScore = s.maxScore ? s.maxScore : getMaxScore(beatSaver?.diff?.notes ?? 0);

      return {
        ...s,
        maxScore,
        beatSaver
      }
    });

    enhance(params);
  }

  const pushState = window.history.pushState;
  const triggerHistoryEnhance = () => {
    const params = getUrlData(window.location.href, matchSiteUrl);
    if (!params) return;

    delay(AFTER_HISTORY_DELAY).then(_ => {
      // checking if the request is in progress or if data is being taken from the cache
      if (getParamsHash(params) !== getParamsHash(lastParams)) {
        lastParams = params;
        enhance(params);
      }
    })
  }
  window.history.pushState = function (state, title, url) {
    setTimeout(() => triggerHistoryEnhance(), 0);

    return pushState.apply(history, arguments);
  };
  window.addEventListener('popstate', () => triggerHistoryEnhance());

  const open = window.XMLHttpRequest.prototype.open;
  const send = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.interceptorApplied = true;
  window.XMLHttpRequest.prototype.open = function (method, url, async, user, pass) {
    const params = getUrlData(url, matchApiUrl);
    if (params) lastParams = params;
    this._url = url;
    open.call(this, method, url, async, user, pass);
  };
  window.XMLHttpRequest.prototype.send = function (data) {
    let self = this;
    let oldOnReadyStateChange;

    function onReadyStateChange() {
      if (self.readyState === 4) {
        const params = getUrlData(self._url, matchApiUrl);
        if (params) {
          try {
            const scores = (JSON.parse(self.responseText)?.playerScores ?? [])
              .map((s, idx) => {
                const hash = s?.leaderboard?.songHash ?? null;
                const difficulty = s?.leaderboard?.difficulty ?? null;
                const maxScore = s?.leaderboard?.maxScore ?? null;
                const baseScore = s?.score?.baseScore ?? null;
                const modifiedScore = s?.score?.modifiedScore ?? null;
                const multiplier = s?.score?.multiplier ?? null;
                const pp = s?.score?.pp ?? null;
                const rank = s?.score?.rank ?? null;

                if (!hash || !difficulty || !baseScore || !modifiedScore || !multiplier) return null;

                return {idx, hash, difficulty, baseScore, modifiedScore, maxScore, multiplier, pp, rank};
              })
              .filter(u => u)

            fetchBeatSaverData(scores, params);
          } catch (e) {
            // swallow error
          }
        }
      }

      if (oldOnReadyStateChange) {
        oldOnReadyStateChange();
      }
    }

    if (this.addEventListener) {
      this.addEventListener("readystatechange", onReadyStateChange, false);
    } else {
      oldOnReadyStateChange = this.onreadystatechange;
      this.onreadystatechange = onReadyStateChange;
    }

    send.call(this, data);
  }

  // trigger visibilitychange to refresh the data on first page load
  setTimeout(() => window.dispatchEvent( new Event('visibilitychange') ), 500);
})(window);
