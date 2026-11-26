
(function () {
    "use strict";

    /*
     * WHAT THIS DOES
     * YouTube hands its video player a "player response" object that describes the stream,
     * including whether live rewind (DVR) is allowed. We catch that object and flip a few
     * switches before the player reads it, so DVR-disabled live streams become seekable.
     *
     * WHERE WE CATCH IT (two sources, so every video is covered):
     *   1. First page load  -> the inline global `ytInitialPlayerResponse` (a plain object).
     *   2. Later navigations -> it arrives over the network and passes through `JSON.parse`.
     *
     * WHY WE DON'T TOUCH Object.prototype (this is the important part):
     * Old versions defined `Object.prototype.playerResponse`. That made
     * `"playerResponse" in <anything>` return true for EVERY object on the page. YouTube's
     * internal response router does exactly that check to decide what a response is, so it
     * mistook comment / feed responses for player data and threw their contents away
     * (comments stopped loading for everyone). Hooking the two real sources below avoids the
     * problem completely and also coexists cleanly with other player-response scripts.
     */

    // The default live DVR window is 12 hours (43200 s). We open it up to 7 days.
    const MAX_DVR_SECS = 43200 * 14; // 604800

    // ---- Core: adjust one live-stream player response, in place ------------------------
    function modifyPlayerResponse(pr) {
        const { streamingData, videoDetails, playerConfig, microformat } = pr;

        // Only live streams have DVR. Leave normal videos and finished VODs alone.
        if (!videoDetails || !videoDetails.isLive) return;

        // 1) Enable rewind even when the broadcaster turned DVR off.
        videoDetails.isLiveDvrEnabled = true;

        // 2) Turn off server-driven playback that blocks client-side seeking
        //    (server ABR, and "wait for the server before starting").
        //    https://greasyfork.org/en/scripts/485020-ytbetter-enable-rewind-dvr/discussions/295167
        const mc = playerConfig && playerConfig.mediaCommonConfig;
        if (mc) {
            mc.useServerDrivenAbr = false;
            // https://greasyfork.org/en/scripts/485020-ytbetter-enable-rewind-dvr/discussions/313024
            if (mc.serverPlaybackStartConfig) mc.serverPlaybackStartConfig.enable = false;
        }

        if (streamingData) {
            // 3) Drop the ad-carrying server-ABR stream URL when a clean manifest exists.
            if (streamingData.serverAbrStreamingUrl &&
                (streamingData.hlsManifestUrl || streamingData.dashManifestUrl)) {
                delete streamingData.serverAbrStreamingUrl;
            }

            // 4) For streams already running longer than 12 h, widen each format's DVR window.
            //    https://greasyfork.org/en/scripts/485020-ytbetter-enable-rewind-dvr/discussions/312558
            if (Array.isArray(streamingData.adaptiveFormats) && streamRunningOver12h(microformat)) {
                for (const format of streamingData.adaptiveFormats) {
                    format.maxDvrDurationSec = MAX_DVR_SECS;
                }
            }
        }
    }

    // How long has this live stream been running, based on its start timestamp?
    function streamRunningOver12h(microformat) {
        const live = microformat &&
            microformat.playerMicroformatRenderer &&
            microformat.playerMicroformatRenderer.liveBroadcastDetails;
        if (!live || !live.startTimestamp) return false;
        const seconds = (Date.now() - new Date(live.startTimestamp).getTime()) / 1000;
        return seconds > 43200; // 12 hours
    }

    // A player response can arrive on its own or wrapped under a `playerResponse` key.
    function patchResponse(data) {
        if (!data || typeof data !== "object") return false;
        if (data.videoDetails) modifyPlayerResponse(data);
        else if (data.playerResponse && data.playerResponse.videoDetails) modifyPlayerResponse(data.playerResponse);
        else return false;
        return true;
    }

    // ---- Source 1: the inline global set on first page load ----------------------------
    // Intercept only until the first real response, then release the global so uBO and other
    // scriptlets can keep editing `ytInitialPlayerResponse` normally.
    const previousInitialDescriptor = Object.getOwnPropertyDescriptor(window, "ytInitialPlayerResponse");
    const previousInitialSetter = previousInitialDescriptor && previousInitialDescriptor.set;
    let initialResponse = window.ytInitialPlayerResponse;
    if (!patchResponse(initialResponse)) {
        try {
            Object.defineProperty(window, "ytInitialPlayerResponse", {
                configurable: true,
                get() { return initialResponse; },
                set(value) {
                    if (previousInitialSetter) previousInitialSetter.call(this, value);
                    initialResponse = value;
                    if (patchResponse(value)) {
                        Object.defineProperty(window, "ytInitialPlayerResponse", {
                            configurable: true,
                            writable: true,
                            value,
                        });
                    }
                },
            });
        } catch (e) {
            patchResponse(window.ytInitialPlayerResponse);
        }
    }

    // ---- Source 2: player responses fetched on later in-site navigations ---------------
    const nativeParse = JSON.parse;
    JSON.parse = function (text, reviver) {
        const data = nativeParse.call(this, text, reviver);
        try { patchResponse(data); } catch (e) { /* never let our code break the page */ }
        return data;
    };

    /*
     * ---- Rewinding past ~13 hours -------------------------------------------------------
     * Seeking back further than ~13 h is capped by a player experiment flag
     * (html5_max_live_dvr_window_plus_margin_secs, default 46800 s). The player reads it from
     * a serialized "key=value&key=value..." string inside YouTube's `ytcfg` config. We rewrite
     * that one flag to 7 days as the config is set, before the player parses it. This is safe
     * for short streams: you can still only rewind as far as the stream has actually run.
     */
    const DVR_FLAG = "html5_max_live_dvr_window_plus_margin_secs";

    function liftDvrCap(ytcfg) {
        if (ytcfg.__dvrCapLifted) return;
        const store = typeof ytcfg.d === "function" && ytcfg.d();
        const players = store && store.WEB_PLAYER_CONTEXT_CONFIGS;
        if (!players) return; // config not loaded yet; try again on the next set()
        for (const id in players) {
            const cfg = players[id];
            if (cfg && typeof cfg.serializedExperimentFlags === "string") {
                cfg.serializedExperimentFlags = cfg.serializedExperimentFlags.replace(
                    new RegExp(DVR_FLAG + "=[\\d.]+"), DVR_FLAG + "=" + MAX_DVR_SECS);
            }
        }
        ytcfg.__dvrCapLifted = true;
    }

    function hookYtcfg(ytcfg) {
        if (!ytcfg || ytcfg.__dvrHooked) return ytcfg;
        ytcfg.__dvrHooked = true;
        const nativeSet = ytcfg.set;
        if (typeof nativeSet === "function") {
            // Re-check the cap after every config write (the player config may land in any one).
            ytcfg.set = function () {
                const result = nativeSet.apply(this, arguments);
                try { liftDvrCap(ytcfg); } catch (e) { /* ignore */ }
                return result;
            };
        }
        try { liftDvrCap(ytcfg); } catch (e) { /* config may already be present */ }
        return ytcfg;
    }

    // `ytcfg` is created by an inline page script that runs after us, so intercept its
    // creation to wrap `.set` early. If it already exists we wrap it here directly; the
    // try/catch guards the case where it was already defined as a non-configurable global.
    let cfgRef = hookYtcfg(window.ytcfg);
    try {
        Object.defineProperty(window, "ytcfg", {
            configurable: true,
            get() { return cfgRef; },
            set(value) { cfgRef = hookYtcfg(value); },
        });
    } catch (e) { /* already present and non-configurable — already hooked just above */ }
})();
