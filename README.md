[README(日本語)](README_JP.md)

# About

This is a modified version of the script that adds ACC to unranked scores on [Score Saber](https://scoresaber.com) website. This version additionally fetches replay IDs from the BeatLeader API. The [original script](https://github.com/motzel/scoresaber-unranked-acc) was created by [motzel](https://github.com/motzel), and this modified version was created by hatopopvr.

## Installation

Get Tampermonkey for [Chrome/Edge Chromium](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo). Then install the script from [here](https://github.com/hatopopvr/scoresaber-enhanced-bl-replays/raw/master/scoresaber-enhanced-bl-replays.user.js).

**Note:** This modified version of the script has only been tested in Chrome. While it may work in other browsers, there may be unexpected issues.

## Known Issues

This script may encounter issues with CORS (Cross-Origin Resource Sharing) policy, preventing it from fetching data from the BeatLeader API. A possible workaround for this issue is to use a browser extension that allows CORS, such as [CORS Unblock for Chrome](https://chrome.google.com/webstore/detail/cors-unblock/lfhmikememgdcahcdlaciloancbhjino).

## Data Storage

This script uses the local storage feature provided by Tampermonkey to cache the ReplayId for each score. The purpose of this caching is to reduce the number of requests made to the BeatLeader API and improve the performance of the script. The stored data includes the playerId, hash, difficulty, and modifiedScore of each score, and the corresponding ReplayId. This data is used only for the functionality of this script and is not shared with any other scripts or services.