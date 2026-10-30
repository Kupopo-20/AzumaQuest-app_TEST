(() => {
  "use strict";

  // 動画・音楽は Cloudflare R2 から配信する（URLは assets/ 以下と同じ構成）。
  // 読み込めなかったときは、アプリと同じ場所の assets/ から再生する。
  const MEDIA_BASE = "https://pub-a26835c4a8e243ceaad959bc528d4ee2.r2.dev/";
  function media(path) {
    return MEDIA_BASE + path;
  }
  // 動画・音声の読み込みに失敗したら、一度だけ同梱の assets/ に切りかえる。切りかえたら true
  function fallbackToLocalMedia(el) {
    const cur = el.getAttribute("src") || "";
    if (cur.indexOf(MEDIA_BASE) !== 0) return false;
    el.src = cur.slice(MEDIA_BASE.length);
    return true;
  }

  const LEVEL_MAX = 20;
  const STATE_KEY = "azumaQuestState";

  const LEVEL_CODE_RE = /^Azuma_event_level(\d{2})$/;
  const MEDAL_CODE_RE = /^Azuma_event_Medal(\d{2})$/;
  const LAST_QUEST_PASS_CODE = "Azuma_event_LastQuestPass";
  const ENDING_CODE = "Azuma_event_Ending";
  const RECOVERY_DURATION_MS = 90 * 1000;
  const MEDAL_UNLOCK_LEVEL_STEP = 5; // レベル5ごとに勲章クエストを1つ受けられるようになる

  // レベル5で1つ、10で2つ、15で3つ、20で4つ、というように
  // 受注できる勲章クエストの数をレベルに応じて返す。
  function allowedMedalCount(levelCount) {
    return Math.min(4, Math.floor(levelCount / MEDAL_UNLOCK_LEVEL_STEP));
  }

  const PERSONAL_TREASURE_ORDER_COUNT = 5; // 参加者ごとに順番を指定するたからばこの数（開始時の混雑防止）

  // 参加者ごとに、開始位置をランダムに1つ選び、そこから増える方向／減る方向を
  // ランダムに決めて連番で5個ぶんのたからばこ番号（0始まり）を並べる。
  // これにより、スタート直後に全員が同じたからばこへ殺到するのを防ぐ。
  function generatePersonalTreasureOrder() {
    const start = Math.floor(Math.random() * LEVEL_MAX);
    const direction = Math.random() < 0.5 ? 1 : -1;
    const order = [];
    for (let i = 0; i < PERSONAL_TREASURE_ORDER_COUNT; i++) {
      order.push(((start + direction * i) % LEVEL_MAX + LEVEL_MAX) % LEVEL_MAX);
    }
    return order;
  }

  const CHARACTER_IMAGE = {
    braver: "assets/braver.png",
    wizard: "assets/wizard.png",
  };
  // レベルアップで出るオーラの色。プレイヤーごとにランダムで1色選ばれ、以後固定される。
  const AURA_COLORS = [
    "#f5c518", // ゴールド
    "#ff4d4d", // 赤
    "#3d9dff", // 青
    "#3ddc84", // 緑
    "#ff5fc4", // ピンク
    "#b06bff", // 紫
    "#39e0e0", // 水色
    "#ff9a3d", // オレンジ
    "#caff4d", // 黄緑
    "#ffffff", // 白（聖なる光）
  ];
  const LEVELUP_VIDEO = {
    braver: media("assets/levelup-braver.mp4"),
    wizard: media("assets/levelup-wizard.mp4"),
  };

  // ------------------------------------------------------------------
  // 状態管理（localStorageに保存し、次回起動時も引き継ぐ）
  // ------------------------------------------------------------------
  function defaultState() {
    return {
      character: null,
      playerName: "",
      levelCount: 0,
      eventLevel: new Array(LEVEL_MAX).fill(false),
      treasureOrder: generatePersonalTreasureOrder(),
      auraColor: AURA_COLORS[Math.floor(Math.random() * AURA_COLORS.length)],
      eventMedal: new Array(4).fill(false),
      eventLastQuestPass: false,
      eventLastMedal: false,
      keyRevealed: false,
      quizIntroPlayed: false,
      quizWon: false,
      eventEnding: false,
      recoveryEndsAt: null,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return Object.assign(base, parsed, {
        eventLevel:
          Array.isArray(parsed.eventLevel) && parsed.eventLevel.length === LEVEL_MAX
            ? parsed.eventLevel
            : base.eventLevel,
        eventMedal:
          Array.isArray(parsed.eventMedal) && parsed.eventMedal.length === 4
            ? parsed.eventMedal
            : base.eventMedal,
        treasureOrder:
          Array.isArray(parsed.treasureOrder) && parsed.treasureOrder.length === PERSONAL_TREASURE_ORDER_COUNT
            ? parsed.treasureOrder
            : base.treasureOrder,
      });
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  let state = loadState();

  // ------------------------------------------------------------------
  // 画面遷移
  // ------------------------------------------------------------------
  const screens = document.querySelectorAll(".screen");
  const bottomNav = document.getElementById("bottom-nav");
  const navButtons = document.querySelectorAll(".nav-btn");
  const openingVideo = document.getElementById("opening-video");
  openingVideo.addEventListener("error", () => {
    if (fallbackToLocalMedia(openingVideo)) openingVideo.play().catch(() => {});
  });
  openingVideo.src = media("assets/Opening.mp4");

  function showScreen(name) {
    screens.forEach((el) => el.classList.toggle("active", el.id === `screen-${name}`));
    navButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.screen === name));
    bottomNav.classList.toggle("visible", ["status", "treasure", "map", "camera", "gallery"].includes(name));
    if (name === "gallery") renderGallery();

    if (name === "map") showMapScreen();
    else stopMapLocation();

    // 音楽（オープニング動画）は最初の画面にいる間だけ流す
    if (name === "opening") {
      openingVideo.play().catch(() => {});
    } else {
      openingVideo.pause();
    }

    if (name === "status") renderStatus();
    else {
      stopMedalShineRandomizer();
      stopCrownSparkle();
      finishThiefKeyDrop();
      finishStatusClearFadeIn();
      finishLevelUpGlow();
    }
    if (name === "status") restartIdleCount();
    else stopIdle();
    if (name === "treasure") renderTreasureList();
    if (name === "camera") startCamera();
    else stopCamera();
    if (name === "recovery") startRecoveryCountdown();
    else stopRecoveryCountdown();
    if (name === "bossdoor") retriggerBossdoorFadeIn();
    if (name === "quiz") startQuizBgm();
    else stopQuizBgm();
  }

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.screen));
  });

  // ------------------------------------------------------------------
  // ステータス画面の寛ぎ動画：30秒間（?idle=秒 で変更可）なにも触らないと、キャラが寛ぐ動画に切りかわる。
  // 画面のどこかに触れると元のキャラ画像にもどる（寛ぎ中の最初のタッチは、ボタンなどを押さない）。
  // ------------------------------------------------------------------
  const IDLE_MS = (parseInt(new URLSearchParams(location.search).get("idle"), 10) || 30) * 1000;
  const IDLE_VIDEO = { braver: "assets/idle-braver.mp4", wizard: "assets/idle-wizard.mp4" };
  const idleVideo = document.getElementById("status-idle-video");
  const idleCharacterImage = document.getElementById("status-character-image");
  let idleTimer = null;
  let idleWanted = false; // 寛ぎ動画を出したい状態（読み込み中を含む）
  let idleShown = false; // 動画が実際に映っている状態
  let swallowClick = false;

  function statusScreenActive() {
    return document.getElementById("screen-status").classList.contains("active");
  }

  let idleLastActivity = Date.now(); // 最後に触れた（ステータス画面を開いた）時刻

  // 待ち時間を数えはじめる。remainingMs を渡すと、その残り時間だけ待つ（画面が消えていた時間の続き）
  function startIdleTimer(remainingMs = IDLE_MS) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(enterIdle, Math.max(0, remainingMs));
  }

  // 触れた／画面を開いた時刻を記録して、0秒から数えなおす
  function restartIdleCount() {
    idleLastActivity = Date.now();
    startIdleTimer();
  }

  function enterIdle() {
    if (!statusScreenActive() || document.hidden) return;
    idleWanted = true;
    idleVideo.src = media(IDLE_VIDEO[state.character || "braver"]);
    idleVideo.currentTime = 0;
    idleVideo.play().catch(() => {});
  }

  function exitIdle() {
    idleWanted = false;
    idleShown = false;
    idleVideo.pause();
    idleVideo.hidden = true;
    idleCharacterImage.classList.remove("is-idle-hidden");
  }

  function stopIdle() {
    clearTimeout(idleTimer);
    exitIdle();
  }

  // 映り始めてから切りかえる（読み込み中に画像が消えて空白になるのを防ぐ）
  idleVideo.addEventListener("playing", () => {
    if (!idleWanted) return;
    idleShown = true;
    idleVideo.hidden = false;
    idleCharacterImage.classList.add("is-idle-hidden");
  });
  idleVideo.addEventListener("error", () => {
    if (idleWanted && fallbackToLocalMedia(idleVideo)) idleVideo.play().catch(() => {});
  });

  function onUserActivity(e) {
    if (!statusScreenActive()) return;
    if (idleWanted && e.type === "pointerdown") {
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 600);
    }
    if (idleWanted) exitIdle();
    restartIdleCount();
  }
  ["pointerdown", "keydown", "wheel", "scroll"].forEach((type) => {
    document.addEventListener(type, onUserActivity, { capture: true, passive: true });
  });
  document.addEventListener(
    "click",
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true
  );
  // 画面が消えている間は、時間を止める。復帰したときは、消える直前に残っていた時間の続きから数える
  // （画面を点けるためのタッチはアプリには届かず、「触れた」には数えない）
  let idleRemainingAtHide = IDLE_MS;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (statusScreenActive()) {
        // すでに寛ぎ動画に入っていたなら、復帰してすぐ動画にもどす（残り0）
        idleRemainingAtHide = idleWanted ? 0 : Math.max(0, IDLE_MS - (Date.now() - idleLastActivity));
      }
      stopIdle();
    } else if (statusScreenActive()) {
      idleLastActivity = Date.now() - (IDLE_MS - idleRemainingAtHide);
      startIdleTimer(idleRemainingAtHide);
    }
  });

  // ------------------------------------------------------------------
  // ちず画面：絵の地図（あずまガルド_Map）の上に、たからばこ・クエスト・現在地を表示する。
  // 取得したたからばこは開いた宝箱＋チェック、勲章をとったクエストは薄い表示＋チェックにする。
  // 位置は map-data.js の緯度・経度から、同じ場所を結んだ変換式で絵の座標に直して置く。
  // 操作は Googleマップに近づけてある（ドラッグ、ピンチ、ダブルタップ拡大、慣性、現在地ボタン）。
  // ------------------------------------------------------------------
  // クエストのモンスター → 勲章の番号（ステータス画面の並び：あか・あお・みどり・ピンク）
  const QUEST_INFO = {
    ガーゴイル: { medal: 0, image: "assets/quest-gargoyle.png" },
    ピラニアン: { medal: 1, image: "assets/quest-piranian.png" },
    サーペント: { medal: 2, image: "assets/quest-serpent.png" },
    アビスバイク: { medal: 3, image: "assets/quest-abyssbike.png" },
  };
  const QUEST_DESCRIPTION = "レベル５ごとに１つクエストをうけれるよ。\n（どれからうけてもいいよ）";
  const mapInfoEl = document.getElementById("map-info");
  const mapToastEl = document.getElementById("map-toast");
  const btnMapLocate = document.getElementById("btn-map-locate");
  let leafletMap = null;
  let mapFitZoom = 0;
  let mapToastTimeout = null;
  const mapMarkers = []; // { marker, icon() }
  let myMarker = null;
  let myAccuracyCircle = null;
  let geoWatchId = null;
  let recenterOnNextFix = false;
  let outsideNoticeShown = false;

  function toFullWidthDigits(n) {
    return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
  }

  // 緯度・経度 → 国土地理院 zoom17 の画像座標 → 絵の座標（左上が原点・下向きがy）
  function geoToImage(lat, lng) {
    const cfg = window.MAP_IMAGE;
    const n = Math.pow(2, cfg.geo.zoom);
    const mx = ((lng + 180) / 360 * n - cfg.geo.originTileX) * 256;
    const r = (lat * Math.PI) / 180;
    const my = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n - cfg.geo.originTileY) * 256;
    const t = cfg.affine;
    return { x: t.a * mx + t.b * my + t.c, y: t.d * mx + t.e * my + t.f };
  }

  // 絵の座標 → Leafletの座標（CRS.Simple は上向きがy）
  function imageToLatLng(p) {
    return L.latLng(window.MAP_IMAGE.height - p.y, p.x);
  }

  function treasurePinIcon(n) {
    const opened = !!state.eventLevel[n - 1];
    const src = opened ? TREASURE_ICON.open : TREASURE_ICON.closed;
    return L.divIcon({
      className: "map-pin-icon",
      html: `<div class="map-pin"><img class="map-pin-image" src="${src}" alt=""><span class="map-pin-label">${toFullWidthDigits(n)}</span>${opened ? '<span class="map-pin-check">✓</span>' : ""}</div>`,
      iconSize: [44, 50],
      iconAnchor: [22, 15],
    });
  }

  function questPinIcon(monster) {
    const info = QUEST_INFO[monster];
    const done = !!state.eventMedal[info.medal];
    return L.divIcon({
      className: "map-pin-icon",
      html: `<div class="map-pin map-pin-quest${done ? " is-done" : ""}"><img class="map-pin-image" src="${info.image}" alt=""><span class="map-pin-label">${monster}</span>${done ? '<span class="map-pin-check">✓</span>' : ""}</div>`,
      iconSize: [96, 74],
      iconAnchor: [48, 28],
    });
  }

  let mapInfoTimer = null;

  // すでに説明が出ているときに別のマークを押すと、中身が入れ替わるだけで変化に気づきにくい。
  // そのため、いったん消してから、少しあとに新しい説明を出し直す（出るときは、ふわっと表示）。
  function openMapInfo(image, title, text) {
    clearTimeout(mapInfoTimer);
    const show = () => {
      document.getElementById("map-info-image").src = image;
      document.getElementById("map-info-title").textContent = title;
      const textEl = document.getElementById("map-info-text");
      textEl.textContent = text;
      textEl.hidden = !text;
      mapInfoEl.hidden = false;
    };
    if (mapInfoEl.hidden) {
      show();
    } else {
      mapInfoEl.hidden = true;
      mapInfoTimer = setTimeout(show, 180);
    }
  }

  function closeMapInfo() {
    clearTimeout(mapInfoTimer);
    mapInfoEl.hidden = true;
  }

  function showMapToast(message) {
    mapToastEl.textContent = message;
    mapToastEl.hidden = false;
    clearTimeout(mapToastTimeout);
    mapToastTimeout = setTimeout(() => {
      mapToastEl.hidden = true;
    }, 3500);
  }

  function buildMap() {
    const cfg = window.MAP_IMAGE;
    const bounds = L.latLngBounds([0, 0], [cfg.height, cfg.width]);
    leafletMap = L.map("map-canvas", {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0, // ピンチでなめらかに拡大・縮小
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      minZoom: -6, // 仮の下限。あとで「画面に全体が入る倍率」に置き換える（0のままだと全体が入らない）
      maxZoom: 1.2,
      inertia: true,
      bounceAtZoomLimits: false,
      maxBoundsViscosity: 1,
    });
    L.control.zoom({ position: "bottomleft", zoomInText: "+", zoomOutText: "−" }).addTo(leafletMap);
    L.imageOverlay(cfg.src, bounds).addTo(leafletMap);
    leafletMap.setMaxBounds(bounds.pad(0.02));

    window.MAP_TREASURES.forEach((t) => {
      const marker = L.marker(imageToLatLng(geoToImage(t.lat, t.lng)), { icon: treasurePinIcon(t.n) }).addTo(leafletMap);
      marker.on("click", () => {
        const opened = !!state.eventLevel[t.n - 1];
        openMapInfo(
          opened ? TREASURE_ICON.open : TREASURE_ICON.closed,
          `${t.n}ばん のたからばこ`,
          opened ? "みつけたよ！" : "まだ みつけていないよ。"
        );
      });
      mapMarkers.push({ marker, icon: () => treasurePinIcon(t.n) });
    });
    window.MAP_QUESTS.forEach((q) => {
      const info = QUEST_INFO[q.monster];
      const marker = L.marker(imageToLatLng(geoToImage(q.lat, q.lng)), {
        icon: questPinIcon(q.monster),
        zIndexOffset: 500,
      }).addTo(leafletMap);
      marker.on("click", () => {
        const done = !!state.eventMedal[info.medal];
        openMapInfo(info.image, `クエスト【${q.monster}】`, done ? "クリアしたよ！" : QUEST_DESCRIPTION);
      });
      mapMarkers.push({ marker, icon: () => questPinIcon(q.monster) });
    });
    // 集合場所：クエストと同じ大きさのアイコンで、名前だけを説明パネルに出す
    if (window.MAP_MEETING) {
      const meeting = window.MAP_MEETING;
      const meetingIcon = L.divIcon({
        className: "map-pin-icon",
        html: `<div class="map-pin map-pin-quest map-pin-meeting"><img class="map-pin-image" src="assets/meeting-point.png" alt=""><span class="map-pin-label">${meeting.name}</span></div>`,
        iconSize: [96, 74],
        iconAnchor: [48, 42], // 名前をアイコンの上に出すので、アイコンの中心は上から42px
      });
      // 近くのたからばこ（1番）に重なったとき、たからばこのマークが隠れないよう後ろに回す
      L.marker(imageToLatLng(geoToImage(meeting.lat, meeting.lng)), { icon: meetingIcon, zIndexOffset: -1000 })
        .addTo(leafletMap)
        .on("click", () => openMapInfo("assets/meeting-point.png", meeting.name, ""));
    }
    leafletMap.on("click", closeMapInfo);

    // 画面にちょうど全体が入る倍率を、これ以上は縮小できない倍率にする（Googleマップと同じ感覚）
    updateMapFitZoom();
    leafletMap.on("zoom", updateMapPinScale);
    // ブラウザのバーの出入りや画面の回転で表示の大きさが変わったら、「全体が入る倍率」も計算し直す
    leafletMap.on("resize", () => {
      updateMapFitZoom();
      updateMapPinScale();
    });
  }

  function mapImageBounds() {
    const cfg = window.MAP_IMAGE;
    return L.latLngBounds([0, 0], [cfg.height, cfg.width]);
  }

  // いまの表示の大きさで「全体がちょうど入る倍率」を求め、それより縮小できないようにする
  function updateMapFitZoom() {
    // getBoundsZoom は「いま設定されている縮小の限界」より小さい値を返せない。
    // 画面が小さくなったときに全体の倍率まで下げられるよう、計算の前に限界をいったん下げる。
    leafletMap.options.minZoom = -6;
    mapFitZoom = leafletMap.getBoundsZoom(mapImageBounds(), false);
    leafletMap.setMinZoom(mapFitZoom);
  }

  // 全体を見ているときはマークを小さく、拡大するほど元の大きさに戻す
  function updateMapPinScale() {
    const container = leafletMap.getContainer();
    const z = leafletMap.getZoom();
    const scale = Math.min(1, 0.65 + (0.35 * (z - mapFitZoom)) / 1.6);
    container.style.setProperty("--pin-s", scale.toFixed(3));
    container.classList.toggle("map-zoomed-out", z < mapFitZoom + 0.7);
  }

  function fitMapToImage() {
    // 先にいまの表示の大きさを読み直してから、全体が入る倍率で中央に合わせる
    leafletMap.invalidateSize();
    updateMapFitZoom();
    leafletMap.setView(mapImageBounds().getCenter(), mapFitZoom, { animate: false });
    updateMapPinScale();
  }

  // 画面を開くたびに、取得状況をマークへ反映する（初回だけ地図を作る）
  function showMapScreen() {
    if (typeof L === "undefined" || !window.MAP_IMAGE) return;
    const firstTime = !leafletMap;
    if (firstTime) buildMap();
    leafletMap.invalidateSize();
    updateMapFitZoom();
    mapMarkers.forEach((m) => m.marker.setIcon(m.icon()));
    closeMapInfo();
    if (firstTime) fitMapToImage();
  }

  // 現在地：ボタンを押すと位置情報の許可を求め、青い点を表示して、その場所へ地図を寄せる
  function onMapPosition(pos) {
    const cfg = window.MAP_IMAGE;
    const p = geoToImage(pos.coords.latitude, pos.coords.longitude);
    const margin = 120;
    const inside = p.x > -margin && p.x < cfg.width + margin && p.y > -margin && p.y < cfg.height + margin;
    if (!inside) {
      if (myMarker) {
        leafletMap.removeLayer(myMarker);
        leafletMap.removeLayer(myAccuracyCircle);
        myMarker = null;
        myAccuracyCircle = null;
      }
      // 位置が更新されるたびに出し続けないよう、範囲外に出たときに一度だけ知らせる
      if (!outsideNoticeShown) {
        outsideNoticeShown = true;
        showMapToast("ちずの はんいの そとに いるよ。");
      }
      return;
    }
    outsideNoticeShown = false;
    const ll = imageToLatLng(p);
    const accuracyPx = Math.max(pos.coords.accuracy / cfg.metersPerPixel, 0);
    if (!myMarker) {
      myAccuracyCircle = L.circle(ll, {
        radius: accuracyPx,
        stroke: false,
        fillColor: "#4285f4",
        fillOpacity: 0.16,
        interactive: false,
      }).addTo(leafletMap);
      myMarker = L.marker(ll, {
        icon: L.divIcon({ className: "map-me-icon", html: '<div class="map-me-dot"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }),
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(leafletMap);
    } else {
      myMarker.setLatLng(ll);
      myAccuracyCircle.setLatLng(ll);
      myAccuracyCircle.setRadius(accuracyPx);
    }
    if (recenterOnNextFix) {
      recenterOnNextFix = false;
      leafletMap.setView(ll, Math.max(leafletMap.getZoom(), mapFitZoom + 1.2), { animate: true });
    }
  }

  function onMapPositionError(err) {
    showMapToast(err && err.code === 1 ? "いちじょうほうの きょかが ひつようです。" : "げんざいちを とれませんでした。");
  }

  function startMapLocation() {
    if (!navigator.geolocation) {
      showMapToast("この たんまつでは げんざいちを つかえません。");
      return;
    }
    // 取得中にもう一度押したら、位置情報の取得をやめる
    if (geoWatchId !== null) {
      stopMapLocation();
      return;
    }
    recenterOnNextFix = true;
    outsideNoticeShown = false;
    btnMapLocate.classList.add("is-on");
    geoWatchId = navigator.geolocation.watchPosition(onMapPosition, onMapPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000,
    });
  }

  function stopMapLocation() {
    if (geoWatchId !== null) {
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
    }
    recenterOnNextFix = false;
    outsideNoticeShown = false;
    clearTimeout(mapToastTimeout);
    mapToastEl.hidden = true;
    btnMapLocate.classList.remove("is-on");
    if (leafletMap && myMarker) {
      leafletMap.removeLayer(myMarker);
      leafletMap.removeLayer(myAccuracyCircle);
      myMarker = null;
      myAccuracyCircle = null;
    }
  }

  document.getElementById("btn-map-reset").addEventListener("click", () => {
    closeMapInfo();
    fitMapToImage();
  });
  document.getElementById("btn-map-info-close").addEventListener("click", closeMapInfo);
  btnMapLocate.addEventListener("click", startMapLocation);

  // ------------------------------------------------------------------
  // オープニング → なまえ入力 → キャラ選択 / ステータス
  // ------------------------------------------------------------------
  function goAfterStart() {
    showScreen(state.character ? "status" : "select");
  }

  document.getElementById("btn-start").addEventListener("click", () => {
    if (!state.playerName) showScreen("name");
    else goAfterStart();
  });

  const NAME_CHAR_RE = /^[ぁ-んァ-ヶーa-zA-Zａ-ｚＡ-Ｚ　 ]+$/;
  const nameInput = document.getElementById("name-input");
  const nameInputMessage = document.getElementById("name-input-message");

  function filterToAllowedNameChars(value) {
    return value.replace(/[^ぁ-んァ-ヶーa-zA-Zａ-ｚＡ-Ｚ　 ]/g, "");
  }

  nameInput.addEventListener("input", (ev) => {
    if (ev.isComposing) return;
    const filtered = filterToAllowedNameChars(nameInput.value);
    if (filtered !== nameInput.value) nameInput.value = filtered;
  });
  nameInput.addEventListener("compositionend", () => {
    const filtered = filterToAllowedNameChars(nameInput.value);
    if (filtered !== nameInput.value) nameInput.value = filtered;
  });

  function confirmName() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInputMessage.textContent = "なまえを　にゅうりょくしてね";
      return;
    }
    if (!NAME_CHAR_RE.test(name)) {
      nameInputMessage.textContent = "つかえない　もじが　あります";
      return;
    }
    state.playerName = name;
    saveState();
    nameInputMessage.textContent = "";
    goAfterStart();
  }

  document.getElementById("btn-name-confirm").addEventListener("click", confirmName);
  nameInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") confirmName();
  });

  const btnSoundOn = document.getElementById("btn-sound-on");
  btnSoundOn.addEventListener("click", () => {
    openingVideo.muted = !openingVideo.muted;
    if (openingVideo.muted) {
      btnSoundOn.textContent = "🔇 音声ON";
      btnSoundOn.classList.remove("is-on");
    } else {
      btnSoundOn.textContent = "🔊 音声OFF";
      btnSoundOn.classList.add("is-on");
    }
  });

  // キャラ選択は誤タップ防止のため「選択」→「決定」の2段構え。
  // カードタップではハイライトが移動するだけで、決定ボタンを押すまで確定しない。
  let pendingCharacter = null;
  const btnSelectConfirm = document.getElementById("btn-select-confirm");
  document.querySelectorAll(".select-card").forEach((card) => {
    card.addEventListener("click", () => {
      pendingCharacter = card.dataset.character;
      document.querySelectorAll(".select-card").forEach((c) => {
        c.classList.toggle("is-selected", c === card);
      });
      btnSelectConfirm.disabled = false;
    });
  });
  btnSelectConfirm.addEventListener("click", () => {
    if (!pendingCharacter) return;
    state.character = pendingCharacter;
    saveState();
    showScreen("status");
  });

  // ------------------------------------------------------------------
  // キャラ選択のやり直し（裏メニュー：ステータス画面でキャラ画像を10秒長押しすると選択画面に戻れる）
  // ------------------------------------------------------------------
  const statusCharacterImageEl = document.getElementById("status-character-image");
  let characterHoldTimeout = null;

  function startCharacterHold() {
    characterHoldTimeout = setTimeout(() => {
      pendingCharacter = null;
      document.querySelectorAll(".select-card").forEach((c) => c.classList.remove("is-selected"));
      btnSelectConfirm.disabled = true;
      showScreen("select");
    }, 10000);
  }

  function cancelCharacterHold() {
    clearTimeout(characterHoldTimeout);
  }

  statusCharacterImageEl.addEventListener("pointerdown", startCharacterHold);
  statusCharacterImageEl.addEventListener("pointerup", cancelCharacterHold);
  statusCharacterImageEl.addEventListener("pointerleave", cancelCharacterHold);
  statusCharacterImageEl.addEventListener("pointercancel", cancelCharacterHold);
  statusCharacterImageEl.addEventListener("contextmenu", (e) => e.preventDefault());

  // ------------------------------------------------------------------
  // なまえの修正（裏メニュー：ステータス画面でなまえを10秒長押しすると入力しなおせる）
  // ------------------------------------------------------------------
  const statusPlayerNameEl = document.getElementById("status-player-name-value");
  let nameHoldTimeout = null;

  function startNameHold() {
    nameHoldTimeout = setTimeout(() => {
      nameInput.value = state.playerName;
      nameInputMessage.textContent = "";
      showScreen("name");
    }, 10000);
  }

  function cancelNameHold() {
    clearTimeout(nameHoldTimeout);
  }

  statusPlayerNameEl.addEventListener("pointerdown", startNameHold);
  statusPlayerNameEl.addEventListener("pointerup", cancelNameHold);
  statusPlayerNameEl.addEventListener("pointerleave", cancelNameHold);
  statusPlayerNameEl.addEventListener("pointercancel", cancelNameHold);

  // ------------------------------------------------------------------
  // ステータス画面の描画
  // ------------------------------------------------------------------
  const statusClearFadeWrap = document.getElementById("status-clear-fade-wrap");
  function retriggerStatusClearFadeIn() {
    statusClearFadeWrap.classList.remove("fade-in-play");
    void statusClearFadeWrap.offsetWidth; // reflow でアニメーションを再トリガー
    statusClearFadeWrap.classList.add("fade-in-play");
  }
  // クラスを付けたままだと、画面を切り替えるたびにフェードインが再生されてしまうため、
  // 終わったとき（または途中で別の画面へ移ったとき）に外す。
  function finishStatusClearFadeIn() {
    statusClearFadeWrap.classList.remove("fade-in-play");
  }
  statusClearFadeWrap.addEventListener("animationend", finishStatusClearFadeIn);

  function renderStatus() {
    const charKey = state.character || "braver";
    const characterImageEl = document.getElementById("status-character-image");
    characterImageEl.src = CHARACTER_IMAGE[charKey];
    characterImageEl.style.setProperty("--aura-color", state.auraColor || AURA_COLORS[0]);
    document.getElementById("status-player-name-value").textContent = state.playerName;
    document.getElementById("status-level-value").textContent = state.levelCount;

    // レベル5ごとにオーラを一段ずつ強くする（最大4段階＝レベル20）。
    const auraStage = Math.min(4, Math.floor(state.levelCount / MEDAL_UNLOCK_LEVEL_STEP));
    for (let s = 1; s <= 4; s++) characterImageEl.classList.toggle(`aura-${s}`, s === auraStage);

    const collectedMedalCount = state.eventMedal.filter(Boolean).length;
    const availableQuestCount = Math.max(0, allowedMedalCount(state.levelCount) - collectedMedalCount);
    for (let i = 0; i < 4; i++) {
      const locked = !state.eventMedal[i];
      const medalItem = document.getElementById(`medal-${i}`);
      medalItem.classList.toggle("is-locked", locked);
      medalItem.classList.toggle("is-available", locked && availableQuestCount > 0);
    }
    const questAvailableMessage = document.getElementById("status-quest-available-message");
    const nextTreasureIndex = getNextRequiredTreasureIndex();
    const guidanceLines = [];
    if (state.levelCount < PERSONAL_TREASURE_ORDER_COUNT) {
      guidanceLines.push(`・${nextTreasureIndex + 1}ばん のたからばこをさがそう！`);
    } else {
      if (state.levelCount < LEVEL_MAX) {
        guidanceLines.push("・どの たからばこ をさがしてもいいよ。");
      }
      if (availableQuestCount > 0) {
        const fullWidthCount = String(availableQuestCount).replace(/[0-9]/g, (d) =>
          String.fromCharCode(d.charCodeAt(0) + 0xfee0)
        );
        guidanceLines.push(`・${fullWidthCount}つクエストへチャレンジできるよ。`);
        guidanceLines.push("（どれからうけてもいいよ。）");
      }
    }
    questAvailableMessage.hidden = guidanceLines.length === 0;
    if (!questAvailableMessage.hidden) {
      // 「（」で始まる補足行は、「・」のぶら下げ位置にそろえて表示する
      questAvailableMessage.innerHTML = guidanceLines
        .map((line) => `<span class="guidance-line${line.startsWith("（") ? " guidance-sub" : ""}">${line}</span>`)
        .join("");
    }
    document.getElementById("btn-status-enter-bossroom").hidden = !(state.eventLastQuestPass && !state.quizWon);
    // まおうを倒したら、まず「そんちょうへみせて」だけ表示。エンディングのQRを読んだあとに勲章とクリアを表示する
    document.getElementById("status-boss-defeated-message").hidden = !(state.quizWon && !state.eventEnding);
    document.getElementById("status-boss-defeated-banner").hidden = !(state.quizWon && state.eventEnding);
    document.getElementById("status-key-reveal").hidden = !(state.keyRevealed && !state.quizWon);
    if (state.keyRevealed && !state.quizWon) {
      const keyImg = document.getElementById("key-reveal-image");
      if (!keyImg.classList.contains("drop-in-play")) keyImg.classList.add("key-glowing");
    }
    stopMedalShineRandomizer();
    if (state.quizWon && state.eventEnding) startCrownSparkle();
    else stopCrownSparkle();
    if (pendingMedalSparkleIndex !== null) {
      const newMedalIndex = pendingMedalSparkleIndex;
      pendingMedalSparkleIndex = null;
      highlightNewMedal(newMedalIndex);
    } else {
      startMedalShineRandomizer();
      maybeRevealThiefKey();
    }
  }

  // 4色の勲章をすべて集めた直後（まだまおうは倒していない）、まおうの部屋の
  // 先にある「とうぞくのカギ」を一度だけ演出付きで出現させる。
  function maybeRevealThiefKey() {
    if (state.eventMedal.every(Boolean) && !state.keyRevealed && !state.quizWon) {
      state.keyRevealed = true;
      saveState();
      revealThiefKey();
    }
  }

  function revealThiefKey() {
    const wrap = document.getElementById("status-key-reveal");
    wrap.hidden = false;
    const img = document.getElementById("key-reveal-image");
    const echo1 = document.getElementById("key-reveal-echo-1");
    const echo2 = document.getElementById("key-reveal-echo-2");
    [img, echo1, echo2].forEach((el) => el.classList.remove("drop-in-play"));
    void img.offsetWidth; // reflow でアニメーションを再トリガー
    [img, echo1, echo2].forEach((el) => el.classList.add("drop-in-play"));
  }

  // 落下クラスを付けたままだと、画面が display:none になって再表示されるたびに
  // 「落下」アニメーションが再生されてしまう。そのため、終わったとき（または
  // 落下の途中で別の画面へ移ったとき）に外し、本体は光り続けるクラスへ差し替える。
  function finishThiefKeyDrop() {
    const img = document.getElementById("key-reveal-image");
    if (!img.classList.contains("drop-in-play")) return;
    img.classList.remove("drop-in-play");
    img.classList.add("key-glowing");
    document.getElementById("key-reveal-echo-1").classList.remove("drop-in-play");
    document.getElementById("key-reveal-echo-2").classList.remove("drop-in-play");
  }
  document.getElementById("key-reveal-image").addEventListener("animationend", finishThiefKeyDrop);

  // ------------------------------------------------------------------
  // たからばこ一覧の描画（20個ぶんのレベルQRの取得状況）
  // ------------------------------------------------------------------
  const TREASURE_ICON = {
    closed: "assets/treasure-close.png",
    open: "assets/treasure-open.png",
  };

  const treasureGrid = document.getElementById("treasure-grid");
  for (let i = 0; i < LEVEL_MAX; i++) {
    const item = document.createElement("div");
    item.className = "treasure-item is-locked";
    item.id = `treasure-${i}`;
    item.innerHTML = `<img id="treasure-icon-${i}" class="treasure-icon-img" src="${TREASURE_ICON.closed}" alt="たからばこ${i + 1}"><span class="treasure-num">${i + 1}</span>`;
    treasureGrid.appendChild(item);
  }

  // 最初の5個は、参加者ごとに割り当てた順番のうち未取得のものを次に探すべき
  // 1個として返す。6個目以降（levelCount>=5）はどれから取っても良いのでnull。
  function getNextRequiredTreasureIndex() {
    if (state.levelCount >= PERSONAL_TREASURE_ORDER_COUNT) return null;
    const idx = state.treasureOrder.find((i) => !state.eventLevel[i]);
    return idx === undefined ? null : idx;
  }

  function renderTreasureList() {
    const nextIndex = getNextRequiredTreasureIndex();
    for (let i = 0; i < LEVEL_MAX; i++) {
      const unlocked = state.eventLevel[i];
      const item = document.getElementById(`treasure-${i}`);
      item.classList.toggle("is-locked", !unlocked);
      // 最初の5個は指定の1個だけ、6個目以降は未取得のすべてを点滅させる
      item.classList.toggle("is-next", !unlocked && (nextIndex === null || i === nextIndex));
      document.getElementById(`treasure-icon-${i}`).src = unlocked ? TREASURE_ICON.open : TREASURE_ICON.closed;
    }
    const hintEl = document.getElementById("treasure-hint-message");
    hintEl.textContent =
      state.levelCount >= LEVEL_MAX
        ? "すべてのたからばこをみつけました！"
        : nextIndex === null
        ? "どの たからばこ をさがしてもいいよ。"
        : `${nextIndex + 1}ばん のたからばこをさがそう！`;
  }

  // まおう勲章（王冠の代わり）の周りにキラキラ粒子を一定間隔で発生させる演出
  const CROWN_SPARKLE_CHARS = ["✨", "⭐", "🌟"];
  let crownSparkleIntervalId = null;

  // 勲章を新しく手に入れた直後、その勲章の周りに星くずを一時的に舞わせる演出
  let pendingMedalSparkleIndex = null;

  function spawnOneMedalSparkle(layer) {
    const sparkle = document.createElement("span");
    sparkle.className = "medal-sparkle";
    sparkle.textContent = CROWN_SPARKLE_CHARS[Math.floor(Math.random() * CROWN_SPARKLE_CHARS.length)];
    sparkle.style.left = `${Math.random() * 100}%`;
    sparkle.style.top = `${Math.random() * 100}%`;
    layer.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), 1800);
  }

  // 星くずを5秒間出し続け、最後の星くずが消えたら onDone を呼ぶ
  function spawnMedalSparkleBurst(index, onDone) {
    const layer = document.getElementById(`medal-sparkle-${index}`);
    if (!layer) {
      onDone();
      return;
    }
    spawnOneMedalSparkle(layer);
    let elapsedMs = 0;
    const intervalId = setInterval(() => {
      spawnOneMedalSparkle(layer);
      elapsedMs += 250;
      if (elapsedMs >= 5000) {
        clearInterval(intervalId);
        setTimeout(onDone, 1800); // 最後の星くずが消えるまで待つ
      }
    }, 250);
  }

  // 手に入れた勲章だけをゆっくり光らせ、他の勲章のランダムな光りは
  // この演出が終わるまで止めておく（どれを手に入れたか分かりやすくするため）。
  // 勲章の光と星くずの両方が終わってから、「とうぞくのカギ」の登場へ進む。
  function highlightNewMedal(index) {
    let glowDone = false;
    let sparkleDone = false;
    const finishIfBothDone = () => {
      if (!glowDone || !sparkleDone) return;
      startMedalShineRandomizer();
      maybeRevealThiefKey();
    };
    spawnMedalSparkleBurst(index, () => {
      sparkleDone = true;
      finishIfBothDone();
    });
    const item = document.getElementById(`medal-${index}`);
    const img = item ? item.querySelector(".status-item-icon-img") : null;
    if (!img) {
      glowDone = true;
      finishIfBothDone();
      return;
    }
    img.classList.remove("slow-glow-once");
    void img.offsetWidth; // reflow でアニメーションを再トリガー
    img.classList.add("slow-glow-once");
    const onAnimationEnd = () => {
      img.classList.remove("slow-glow-once");
      img.removeEventListener("animationend", onAnimationEnd);
      glowDone = true;
      finishIfBothDone();
    };
    img.addEventListener("animationend", onAnimationEnd);
  }

  function spawnCrownSparkle() {
    const layer = document.getElementById("crown-sparkle-layer");
    if (!layer) return;
    const sparkle = document.createElement("span");
    sparkle.className = "crown-sparkle";
    sparkle.textContent = CROWN_SPARKLE_CHARS[Math.floor(Math.random() * CROWN_SPARKLE_CHARS.length)];
    sparkle.style.left = `${Math.random() * 100}%`;
    sparkle.style.top = `${Math.random() * 100}%`;
    layer.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), 1800);
  }

  function startCrownSparkle() {
    stopCrownSparkle();
    spawnCrownSparkle();
    crownSparkleIntervalId = setInterval(spawnCrownSparkle, 400);
  }

  function stopCrownSparkle() {
    clearInterval(crownSparkleIntervalId);
    crownSparkleIntervalId = null;
    const layer = document.getElementById("crown-sparkle-layer");
    if (layer) layer.innerHTML = "";
  }

  // 勲章が光る演出：各勲章ごとに「ランダムな時間待つ→1回だけ光るアニメーションを
  // 再生→終わるのを待つ→また次のランダムな時間待つ」を繰り返す。アニメーション
  // の再生中は何も上書きしないので、光っている途中で強制的に消えることがない。
  let medalShineActive = false;
  const medalShineTimeouts = new Map();

  function isMedalUnlocked(imgEl) {
    const item = imgEl.closest(".status-item");
    return !!item && !item.classList.contains("is-locked");
  }

  function scheduleMedalShine(imgEl) {
    const waitMs = 2000 + Math.random() * 6000;
    const timeoutId = setTimeout(() => {
      if (!medalShineActive || !isMedalUnlocked(imgEl)) return;
      imgEl.classList.add("shine-once");
      const onAnimationEnd = () => {
        imgEl.classList.remove("shine-once");
        imgEl.removeEventListener("animationend", onAnimationEnd);
        if (medalShineActive && isMedalUnlocked(imgEl)) scheduleMedalShine(imgEl);
      };
      imgEl.addEventListener("animationend", onAnimationEnd);
    }, waitMs);
    medalShineTimeouts.set(imgEl, timeoutId);
  }

  function startMedalShineRandomizer() {
    // 勲章が常時ランダムに光る演出は一旦取止め（復活する場合は下のコメントを外す）
    // medalShineActive = true;
    // document.querySelectorAll(".status-item:not(.is-locked) .status-item-icon-img").forEach((img) => {
    //   scheduleMedalShine(img);
    // });
  }

  function stopMedalShineRandomizer() {
    medalShineActive = false;
    medalShineTimeouts.forEach((id) => clearTimeout(id));
    medalShineTimeouts.clear();
  }

  document.getElementById("btn-status-enter-bossroom").addEventListener("click", () => {
    enterBossRoom();
  });

  // レベルアップ直後だけ、キャラクターに星が舞い降りるエフェクトを表示する
  const STAR_CHARS = ["⭐", "✨", "🌟"];
  function spawnLevelUpStars() {
    const layer = document.getElementById("levelup-star-layer");
    if (!layer) return;
    layer.innerHTML = "";
    // 星が舞い降り始める時間を約2.4秒にばらけさせ、ゆっくり落ちる（2.6秒）星が
    // 落ち終わるまで合わせて約5秒続ける
    const starCount = 22;
    const spreadSeconds = 2.4;
    for (let i = 0; i < starCount; i++) {
      const star = document.createElement("span");
      star.className = "levelup-star";
      star.textContent = STAR_CHARS[Math.floor(Math.random() * STAR_CHARS.length)];
      star.style.left = `${Math.random() * 100}%`;
      star.style.fontSize = `${1 + Math.random() * 0.9}rem`;
      star.style.animationDelay = `${Math.random() * spreadSeconds}s`;
      layer.appendChild(star);
    }
    setTimeout(() => {
      layer.innerHTML = "";
    }, 5500);

    playLevelUpGlow();
  }

  // レベルアップ直後に、キャラクターをオーラの色で2回光らせる（クエストクリアの勲章と同じ光り方）。
  // 光らせている間は、いつものオーラのゆらぎと動きが重ならないよう、クラスを入れ替える。
  // 終わったら（または別の画面へ移ったら）外す。付けたままだと、画面を切り替えるたびに再生されてしまう。
  const statusCharacterImage = document.getElementById("status-character-image");
  function playLevelUpGlow() {
    statusCharacterImage.classList.remove("levelup-glow");
    void statusCharacterImage.offsetWidth; // reflow でアニメーションを再トリガー
    statusCharacterImage.classList.add("levelup-glow");
  }
  function finishLevelUpGlow() {
    statusCharacterImage.classList.remove("levelup-glow");
  }
  statusCharacterImage.addEventListener("animationend", (ev) => {
    if (ev.animationName === "character-levelup-glow") finishLevelUpGlow();
  });

  // ------------------------------------------------------------------
  // デバッグ用（本番公開前に必ず削除すること）
  // ------------------------------------------------------------------
  // 待たずに、すぐ寛ぎ動画に切りかえる（触れば元にもどる）
  document.getElementById("btn-debug-idle").addEventListener("click", () => {
    enterIdle();
  });

  // QR「Azuma_event_Ending」を読み込んだときと同じ処理（まおう討伐後のみ・1回だけ）を通す
  document.getElementById("btn-debug-ending").addEventListener("click", () => {
    handleQrCode(ENDING_CODE);
  });

  document.getElementById("btn-debug-level-plus1").addEventListener("click", () => {
    const candidates = [...state.treasureOrder, ...state.eventLevel.keys()];
    let added = 0;
    for (const i of candidates) {
      if (added >= 1) break;
      if (!state.eventLevel[i]) {
        state.eventLevel[i] = true;
        added++;
      }
    }
    state.levelCount = state.eventLevel.filter(Boolean).length;
    saveState();
    renderStatus();
  });

  // 押すたびに、まだクリアしていないクエスト（勲章）の中からランダムに1つをクリアする。
  // 実際にクエストをクリアしたときと同じ演出（勲章がゆっくり光る・キラキラ）が出る。
  document.getElementById("btn-debug-quest-clear").addEventListener("click", () => {
    const remaining = [0, 1, 2, 3].filter((i) => !state.eventMedal[i]);
    if (remaining.length === 0) return;
    const idx = remaining[Math.floor(Math.random() * remaining.length)];
    state.eventMedal[idx] = true;
    saveState();
    pendingMedalSparkleIndex = idx;
    renderStatus();
  });

  document.getElementById("btn-debug-back-to-opening").addEventListener("click", () => {
    state = defaultState();
    quizRun = null;
    pendingMedalSparkleIndex = null;
    document.getElementById("key-reveal-image").classList.remove("drop-in-play", "key-glowing");
    document.getElementById("key-reveal-echo-1").classList.remove("drop-in-play");
    document.getElementById("key-reveal-echo-2").classList.remove("drop-in-play");
    saveState();
    showScreen("opening");
  });

  // QR「Azuma_event_LastQuestPass」を読み込んだときと同じ処理（条件を満たしていなければ入れない）を通す
  document.getElementById("btn-debug-quiz-enter-door").addEventListener("click", () => {
    handleQrCode(LAST_QUEST_PASS_CODE);
  });

  document.getElementById("btn-debug-quiz-force-win").addEventListener("click", () => {
    quizRun = null;
    state.quizWon = true;
    state.eventLastMedal = true;
    saveState();
    showScreen("status");
  });

  document.getElementById("btn-debug-recovery-shrink").addEventListener("click", () => {
    if (state.recoveryEndsAt) {
      state.recoveryEndsAt = Date.now() + 5000;
      saveState();
      renderRecoveryCountdown();
    }
  });

  // ------------------------------------------------------------------
  // フィードバック（バイブ＋フラッシュ。iOSはバイブ非対応のためフラッシュのみ）
  // ------------------------------------------------------------------
  function feedback(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern || 200);
    document.body.classList.remove("flash-pulse");
    void document.body.offsetWidth; // reflow でアニメーションを再トリガー
    document.body.classList.add("flash-pulse");
  }

  // ------------------------------------------------------------------
  // カメラ画面：QRコード読み取り
  // ------------------------------------------------------------------
  const video = document.getElementById("camera-video");
  const canvas = document.getElementById("camera-canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const cameraMessage = document.getElementById("camera-message");

  let cameraStream = null;
  let scanRafId = null;
  let scanPaused = false;

  async function startCamera() {
    cameraMessage.textContent = "";
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (e) {
      cameraMessage.textContent = "カメラをつかえませんでした。せっていをかくにんしてください。";
      return;
    }
    video.srcObject = cameraStream;
    await video.play();
    scanPaused = false;
    scanRafId = requestAnimationFrame(scanLoop);
  }

  function stopCamera() {
    if (scanRafId) cancelAnimationFrame(scanRafId);
    scanRafId = null;
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    video.srcObject = null;
  }

  function scanLoop() {
    if (video.readyState === video.HAVE_ENOUGH_DATA && !scanPaused) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });
      // handleQrCode がレベルアップ画面への遷移を引き起こし、その中で
      // stopCamera() が呼ばれて cameraStream が null になることがある。
      // その場合はここでループを止め、次のフレームを予約しない。
      if (code && code.data) handleQrCode(code.data.trim());
    }
    if (cameraStream) {
      scanRafId = requestAnimationFrame(scanLoop);
    }
  }

  function handleQrCode(text) {
    const levelMatch = text.match(LEVEL_CODE_RE);
    if (levelMatch) {
      const idx = parseInt(levelMatch[1], 10) - 1;
      if (idx < 0 || idx >= LEVEL_MAX) return;
      if (state.eventLevel[idx]) {
        showCameraMessage("このQRコードは　もう　つかったよ！");
        return;
      }
      const requiredIdx = getNextRequiredTreasureIndex();
      if (requiredIdx !== null && idx !== requiredIdx) {
        showCameraMessage("していの　たからばこ　からさがしてください。");
        return;
      }
      pauseScanBriefly();
      state.eventLevel[idx] = true;
      state.levelCount = Math.min(LEVEL_MAX, state.levelCount + 1);
      saveState();
      feedback(200);
      playLevelUp();
      return;
    }

    const medalMatch = text.match(MEDAL_CODE_RE);
    if (medalMatch) {
      const midx = parseInt(medalMatch[1], 10) - 1;
      if (midx < 0 || midx >= 4) return;
      if (state.eventMedal[midx]) {
        showCameraMessage("このQRコードは　もう　つかったよ！");
        return;
      }
      const collectedMedalCount = state.eventMedal.filter(Boolean).length;
      if (collectedMedalCount >= allowedMedalCount(state.levelCount)) {
        showCameraMessage("じょうけん を みたしてないよ。");
        return;
      }
      pauseScanBriefly();
      // 同じQRを二度使えないよう、動画を流す前に取得済みにして保存しておく
      state.eventMedal[midx] = true;
      saveState();
      feedback(200);
      playQuestSlay(midx);
      return;
    }

    if (text === LAST_QUEST_PASS_CODE) {
      if (state.quizWon) {
        // まおう討伐済みなら、隠し通路へは案内しない
        showCameraMessage("このQRコードは　もう　つかったよ！");
        return;
      }
      if (state.eventLastQuestPass) {
        // 一度あけた扉に再度たどりついた場合も、吸い込み演出を流してからクイズの続きへ案内する
        pauseScanBriefly();
        playLastQuestTransfer();
        return;
      }
      const eligible = state.levelCount >= LEVEL_MAX && state.eventMedal.every(Boolean);
      if (!eligible) {
        showCameraMessage("じょうけん を みたしてないよ。");
        return;
      }
      pauseScanBriefly();
      state.eventLastQuestPass = true;
      saveState();
      feedback(200);
      playLastQuestTransfer();
      return;
    }

    if (text === ENDING_CODE) {
      if (!state.quizWon) {
        // まおうを倒すまでは使えない
        showCameraMessage("じょうけん を みたしてないよ。");
        return;
      }
      if (state.eventEnding) {
        showCameraMessage("このQRコードは　もう　つかったよ！");
        return;
      }
      pauseScanBriefly();
      state.eventEnding = true;
      saveState();
      feedback(200);
      playEnding();
      return;
    }

    showCameraMessage("これは　あずま保育園クエストの　QRコードでは　ないよ。");
  }

  function enterBossRoom() {
    showScreen(isRecoveryActive() ? "recovery" : "bossdoor");
  }

  let scanPauseTimeout = null;
  function pauseScanBriefly() {
    scanPaused = true;
    clearTimeout(scanPauseTimeout);
    scanPauseTimeout = setTimeout(() => {
      scanPaused = false;
    }, 3000);
  }

  let cameraMessageTimeout = null;
  function showCameraMessage(msg) {
    cameraMessage.textContent = msg;
    clearTimeout(cameraMessageTimeout);
    cameraMessageTimeout = setTimeout(() => {
      cameraMessage.textContent = "";
    }, 2500);
  }

  // ------------------------------------------------------------------
  // 動画オーバーレイの共通処理（レベルアップ／まおう決戦の幕開け／まおう討伐で共用）
  // ended/error イベントで次に進み、動画の長さが分かり次第「長さ＋3秒」の
  // 保険タイムアウトを仕掛ける（万一 ended が発火しない端末向け）。
  // 音声ONでの再生を試み、ブロックされたらミュート再生にフォールバックする。
  // ------------------------------------------------------------------
  // 外部リンクから開いた直後などタップ操作が無いと、ブラウザは音声つき自動再生を
  // 禁止する。その場合は音ボタンは出さず、そのままミュート再生にする。

  // 右上の「スキップ」：押すと、動画が最後まで流れたときと同じ流れで次へ進む
  const btnOverlaySkip = document.getElementById("btn-overlay-skip");
  let overlaySkipHandler = null;
  btnOverlaySkip.addEventListener("click", () => {
    if (overlaySkipHandler) overlaySkipHandler();
  });

  function playOverlayVideo({ videoEl, screenName, src, onFinish, skippable = true }) {
    videoEl.src = src;
    showScreen(screenName);
    videoEl.currentTime = 0;
    videoEl.muted = false;

    let finished = false;
    let safetyTimeout = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safetyTimeout);
      videoEl.removeEventListener("ended", finish);
      videoEl.removeEventListener("error", onError);
      videoEl.removeEventListener("loadedmetadata", onMetadata);
      videoEl.pause(); // スキップしたときに、音が残らないよう止める
      btnOverlaySkip.hidden = true;
      overlaySkipHandler = null;
      onFinish();
    };
    overlaySkipHandler = finish;
    btnOverlaySkip.hidden = !skippable;
    videoEl.addEventListener("ended", finish);
    // Cloudflare から読み込めなかったときは、同梱の動画に切りかえて再生しなおす
    function onError() {
      if (finished) return;
      if (fallbackToLocalMedia(videoEl)) {
        videoEl.play().catch(() => {});
      } else {
        finish();
      }
    }
    function onMetadata() {
      clearTimeout(safetyTimeout);
      const durationMs = isFinite(videoEl.duration) ? videoEl.duration * 1000 : 30000;
      safetyTimeout = setTimeout(finish, durationMs + 3000);
    }
    videoEl.addEventListener("error", onError);
    videoEl.addEventListener("loadedmetadata", onMetadata);

    // 再生開始が遅れて、スキップ後に始まってしまうと音だけが流れ続けるため、
    // 終わったあとに再生が始まったら止める
    const stopIfFinished = () => {
      if (finished) videoEl.pause();
    };
    videoEl
      .play()
      .then(stopIfFinished)
      .catch(() => {
        if (finished || videoEl.error) return; // 読み込み失敗は onError が処理する
        videoEl.muted = true;
        videoEl.play().then(stopIfFinished).catch(finish);
      });
  }

  // ------------------------------------------------------------------
  // レベルアップ演出（動画再生 → ステータス画面へ）
  // ------------------------------------------------------------------
  const levelupVideo = document.getElementById("levelup-video");

  function playLevelUp() {
    const charKey = state.character || "braver";
    playOverlayVideo({
      videoEl: levelupVideo,
      screenName: "levelup",
      src: LEVELUP_VIDEO[charKey],
      onFinish: () => {
        showScreen("status");
        spawnLevelUpStars();
      },
    });
  }

  // ------------------------------------------------------------------
  // まおうクイズ：決戦の幕開け動画・討伐動画
  // ------------------------------------------------------------------
  const bossintroVideo = document.getElementById("bossintro-video");
  const bossvictoryVideo = document.getElementById("bossvictory-video");

  function playBossIntro() {
    bossintroVideo.hidden = false;
    playOverlayVideo({
      videoEl: bossintroVideo,
      screenName: "bossintro",
      src: media("assets/boss-battle-start.mp4"),
      onFinish: () => {
        state.quizIntroPlayed = true;
        saveState();
        // 動画終了後、1秒間暗転させてからクイズを開始する
        bossintroVideo.hidden = true;
        setTimeout(startQuizAttempt, 1000);
      },
    });
  }

  // ------------------------------------------------------------------
  // どうが一覧：かいほう（視聴済み）した動画を、あとから1本ずつ見返せる
  // ------------------------------------------------------------------
  // かいほう前の動画は、内容が事前に分からないよう一覧にも出さない。
  const GALLERY_VIDEOS = [
    { title: "オープニング", src: media("assets/Opening.mp4"), unlocked: () => true },
    // クエストの討伐動画：その勲章（0:あか 1:あお 2:みどり 3:ピンク）を手に入れると見返せる
    { title: "ガーゴイルを たおした！", src: media("assets/quest-slay-gargoyle.mp4"), unlocked: () => !!state.eventMedal[0] },
    { title: "ピラニアンを たおした！", src: media("assets/quest-slay-piranian.mp4"), unlocked: () => !!state.eventMedal[1] },
    { title: "サーペントを たおした！", src: media("assets/quest-slay-serpent.mp4"), unlocked: () => !!state.eventMedal[2] },
    { title: "アビスバイクを たおした！", src: media("assets/quest-slay-abyssbike.mp4"), unlocked: () => !!state.eventMedal[3] },
    { title: "ひみつの かくしつうろ", src: media("assets/transfer-last-quest.mp4"), unlocked: () => state.eventLastQuestPass },
    { title: "まおうとの けっせん", src: media("assets/boss-battle-start.mp4"), unlocked: () => state.quizIntroPlayed },
    { title: "まおうを たおした！", src: media("assets/boss-defeated.mp4"), unlocked: () => state.quizWon },
    { title: "おひめさまからの ありがとう", src: media("assets/ending-thanks.mp4"), unlocked: () => state.eventEnding },
  ];
  const galleryList = document.getElementById("gallery-list");
  const replayVideo = document.getElementById("replay-video");

  function renderGallery() {
    galleryList.textContent = "";
    GALLERY_VIDEOS.filter((v) => v.unlocked()).forEach((v) => {
      const btn = document.createElement("button");
      btn.className = "gallery-item";
      const label = document.createElement("span");
      label.textContent = v.title;
      const stateEl = document.createElement("span");
      stateEl.className = "gallery-item-state";
      stateEl.textContent = "▶ みる";
      btn.append(label, stateEl);
      btn.addEventListener("click", () => playGalleryVideo(v.src));
      galleryList.appendChild(btn);
    });
  }

  function playGalleryVideo(src) {
    playOverlayVideo({
      videoEl: replayVideo,
      screenName: "replay",
      src,
      skippable: false, // 見返し用は、左上の「もどる」で戻れる
      onFinish: () => showScreen("gallery"),
    });
  }

  // 「もどる」：再生を止めて、動画が終わったときと同じ流れで一覧へ戻る
  document.getElementById("btn-replay-back").addEventListener("click", () => {
    replayVideo.pause();
    replayVideo.dispatchEvent(new Event("ended"));
  });

  // クエスト討伐の動画。勲章の番号（0:あか 1:あお 2:みどり 3:ピンク）→ モンスターの動画
  const QUEST_SLAY_VIDEO = [
    media("assets/quest-slay-gargoyle.mp4"), // あか：ガーゴイル
    media("assets/quest-slay-piranian.mp4"), // あお：ピラニアン
    media("assets/quest-slay-serpent.mp4"), // みどり：サーペント
    media("assets/quest-slay-abyssbike.mp4"), // ピンク：アビスバイク
  ];
  const questSlayVideo = document.getElementById("questslay-video");

  // 動画が終わったらステータス画面に移り、手に入れた勲章が光りながら表示される
  function playQuestSlay(medalIndex) {
    playOverlayVideo({
      videoEl: questSlayVideo,
      screenName: "questslay",
      src: QUEST_SLAY_VIDEO[medalIndex],
      onFinish: () => {
        pendingMedalSparkleIndex = medalIndex;
        showScreen("status");
      },
    });
  }

  const transferVideo = document.getElementById("transfer-video");

  function playLastQuestTransfer() {
    playOverlayVideo({
      videoEl: transferVideo,
      screenName: "transfer",
      src: media("assets/transfer-last-quest.mp4"),
      onFinish: enterBossRoom,
    });
  }

  const endingVideo = document.getElementById("ending-video");

  function playEnding() {
    playOverlayVideo({
      videoEl: endingVideo,
      screenName: "ending",
      src: media("assets/ending-thanks.mp4"),
      // 動画が終わったら、黄色い勲章とクリアの表示をゆっくり出す
      onFinish: () => {
        showScreen("status");
        retriggerStatusClearFadeIn();
      },
    });
  }

  function playBossVictory() {
    playOverlayVideo({
      videoEl: bossvictoryVideo,
      screenName: "bossvictory",
      src: media("assets/boss-defeated.mp4"),
      onFinish: () => showScreen("status"),
    });
  }

  // ------------------------------------------------------------------
  // まおうの部屋の扉
  // ------------------------------------------------------------------
  const bossdoorFadeWrap = document.getElementById("bossdoor-fade-wrap");

  function retriggerBossdoorFadeIn() {
    bossdoorFadeWrap.classList.remove("fade-in-play");
    void bossdoorFadeWrap.offsetWidth; // reflow でアニメーションを再トリガー
    bossdoorFadeWrap.classList.add("fade-in-play");
  }

  document.getElementById("btn-boss-challenge").addEventListener("click", () => {
    if (!state.quizIntroPlayed) playBossIntro();
    else startQuizAttempt();
  });

  // ------------------------------------------------------------------
  // まおうクイズ本体
  // ------------------------------------------------------------------
  const CORRECT_TARGET = 8;
  const WRONG_LIMIT = 3;
  const USABLE_QUESTIONS = (window.QUIZ_QUESTIONS || []).filter(
    (q) =>
      Array.isArray(q.choices) &&
      q.choices.filter((c) => c && c.trim() !== "").length === 4 &&
      q.choices.includes(q.answer)
  );

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildQuizQuestionRun(q) {
    const choices = shuffleArray(q.choices.slice());
    return { question: q.question, choices, correctIndex: choices.indexOf(q.answer) };
  }

  // 難易度は E（やさしい）→ D → C → B → A（むずかしい）の順。それまでの正解数
  // に応じて出題する難易度プールを切り替える：2問正解まではEとD、4問正解まで
  // はDとC、6問正解まではB、8問正解まではAのみ。同じ問題は同じクイズ内で
  // 二度出さない。
  function difficultyPoolForCorrectCount(correctCount) {
    if (correctCount < 2) return ["E", "D"];
    if (correctCount < 4) return ["D", "C"];
    if (correctCount < 6) return ["B"];
    return ["A"];
  }

  function pickNextQuestion(usedSet, correctCount) {
    const allowed = difficultyPoolForCorrectCount(correctCount);
    let candidates = USABLE_QUESTIONS.filter((q) => allowed.includes(q.difficulty) && !usedSet.has(q));
    if (candidates.length === 0) {
      candidates = USABLE_QUESTIONS.filter((q) => !usedSet.has(q));
    }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    usedSet.add(chosen);
    return buildQuizQuestionRun(chosen);
  }

  let quizRun = null; // { current, correct, wrong, used }
  const quizChoicesEl = document.getElementById("quiz-choices");
  const quizContent = document.getElementById("quiz-content");
  const quizBgm = document.getElementById("quiz-bgm");
  quizBgm.addEventListener("error", () => fallbackToLocalMedia(quizBgm));
  quizBgm.src = media("assets/quiz-bgm.mp3");

  function retriggerQuizFadeIn() {
    quizContent.classList.remove("fade-in-play");
    void quizContent.offsetWidth; // reflow でアニメーションを再トリガー
    quizContent.classList.add("fade-in-play");
  }

  function startQuizBgm() {
    quizBgm.currentTime = 0;
    quizBgm.volume = 0.6;
    quizBgm.play().catch(() => {});
  }

  function stopQuizBgm() {
    quizBgm.pause();
    quizBgm.currentTime = 0;
  }

  function startQuizAttempt() {
    quizRun = { current: null, correct: 0, wrong: 0, used: new Set() };
    quizRun.current = pickNextQuestion(quizRun.used, quizRun.correct);
    showScreen("quiz");
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    if (!quizRun) return;
    const q = quizRun.current;
    document.getElementById("quiz-question-text").textContent = q.question;
    document.getElementById("quiz-correct-count").textContent = quizRun.correct;
    document.getElementById("quiz-wrong-count").textContent = quizRun.wrong;
    quizChoicesEl.querySelectorAll(".quiz-choice-btn").forEach((btn, i) => {
      btn.textContent = q.choices[i] || "";
      btn.disabled = false;
    });
    retriggerQuizFadeIn();
  }

  quizChoicesEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".quiz-choice-btn");
    if (!btn || !quizRun) return;
    handleQuizAnswer(Number(btn.dataset.choiceIndex));
  });

  const quizFlashOverlay = document.getElementById("quiz-flash-overlay");
  const quizBossImage = document.querySelector(".quiz-boss-image");
  // 正解：まおうの画像だけを2回白く光らせる（まおうにダメージを与える演出）
  // 不正解：画面全体を2回赤く光らせる
  function flashQuizResult(isCorrect) {
    if (isCorrect) {
      quizBossImage.classList.remove("flash-damage");
      void quizBossImage.offsetWidth; // reflow でアニメーションを再トリガー
      quizBossImage.classList.add("flash-damage");
      // クラスを付けたままだと画面の再表示のたびに再生されてしまうので、終わったら外す
      quizBossImage.addEventListener("animationend", () => quizBossImage.classList.remove("flash-damage"), { once: true });
      return;
    }
    quizFlashOverlay.classList.remove("flash-wrong");
    void quizFlashOverlay.offsetWidth;
    quizFlashOverlay.classList.add("flash-wrong");
  }

  function handleQuizAnswer(chosenIndex) {
    if (!quizRun) return;
    quizChoicesEl.querySelectorAll(".quiz-choice-btn").forEach((b) => (b.disabled = true));
    const q = quizRun.current;
    const isCorrect = chosenIndex === q.correctIndex;
    if (navigator.vibrate) navigator.vibrate(isCorrect ? 100 : [100, 80, 100]);
    flashQuizResult(isCorrect);
    if (isCorrect) quizRun.correct += 1;
    else quizRun.wrong += 1;

    if (quizRun.correct >= CORRECT_TARGET) return finishQuiz("win");
    if (quizRun.wrong >= WRONG_LIMIT) return finishQuiz("fail");
    quizRun.current = pickNextQuestion(quizRun.used, quizRun.correct);
    setTimeout(renderQuizQuestion, 500);
  }

  function finishQuiz(result) {
    quizRun = null;
    if (result === "win") {
      state.quizWon = true;
      state.eventLastMedal = true;
      saveState();
      playBossVictory();
    } else {
      state.recoveryEndsAt = Date.now() + RECOVERY_DURATION_MS;
      saveState();
      showScreen("recovery");
    }
  }

  // ------------------------------------------------------------------
  // 回復中のカウントダウン（3分）
  // ------------------------------------------------------------------
  let recoveryIntervalId = null;

  function isRecoveryActive() {
    return typeof state.recoveryEndsAt === "number" && Date.now() < state.recoveryEndsAt;
  }

  function startRecoveryCountdown() {
    renderRecoveryCountdown();
    clearInterval(recoveryIntervalId);
    recoveryIntervalId = setInterval(renderRecoveryCountdown, 1000);
  }

  function stopRecoveryCountdown() {
    clearInterval(recoveryIntervalId);
    recoveryIntervalId = null;
  }

  function renderRecoveryCountdown() {
    const remainingMs = (state.recoveryEndsAt || 0) - Date.now();
    if (remainingMs <= 0) {
      stopRecoveryCountdown();
      state.recoveryEndsAt = null;
      saveState();
      showScreen("bossdoor");
      return;
    }
    const totalSec = Math.ceil(remainingMs / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    const el = document.getElementById("recovery-countdown");
    if (el) el.textContent = `${mm}:${ss}`;
  }

  // ------------------------------------------------------------------
  // 初期化
  // ------------------------------------------------------------------
  // 外部リンク（PDF・LINE等）から直接コードを渡して「ひみつの隠し通路」等へ
  // 進めるための仕組み。QRコードを読み取った場合と全く同じ判定・処理
  // （handleQrCode）を通すため、条件（レベル・勲章など）を満たしていなければ
  // QRのときと同様に弾かれる。
  // 例: index.html?code=Azuma_event_LastQuestPass
  const deepLinkCode = new URLSearchParams(location.search).get("code");
  if (deepLinkCode) {
    // 同じURLをリロード／再共有したときに毎回再実行されないよう、処理前にクエリを消す。
    history.replaceState(null, "", location.pathname + location.hash);
  }
  // 外部リンクからはタップ操作が無く、動画の音声が自動再生で止められてしまう。
  // そのため入れる状態のときは「すすむ」ボタンを挟み、そのタップで音つき再生を始める。
  function routeInitialScreen() {
    const lastQuestEnterable =
      !state.quizWon &&
      (state.eventLastQuestPass || (state.levelCount >= LEVEL_MAX && state.eventMedal.every(Boolean)));
    if (deepLinkCode === LAST_QUEST_PASS_CODE && !lastQuestEnterable) {
      // 条件を満たしていないときはアプリ画面へ移らず、エラー画面を表示する。
      showScreen("linkerror");
    } else if (deepLinkCode && state.character) {
      if (deepLinkCode === LAST_QUEST_PASS_CODE) {
        showScreen("gate");
        document.getElementById("btn-gate-proceed").addEventListener(
          "click",
          () => {
            showScreen("status");
            handleQrCode(deepLinkCode);
          },
          { once: true }
        );
      } else {
        showScreen("status");
        handleQrCode(deepLinkCode);
      }
    } else {
      showScreen("opening");
    }
  }

  // LINEなどのアプリ内ブラウザは、カメラが使えなかったり、SafariやChromeとプレイデータが
  // 別扱いになったりする。検出したら、先に「ブラウザで開いてください」の案内を出す。
  // （誤検出でも進めるように「このまま すすむ」ボタンも用意する。）
  const IN_APP_BROWSER_RE = /\bLine\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger/i;
  if (IN_APP_BROWSER_RE.test(navigator.userAgent)) {
    showScreen("inapp");
    document.getElementById("btn-inapp-continue").addEventListener("click", routeInitialScreen, { once: true });
  } else {
    routeInitialScreen();
  }
})();
