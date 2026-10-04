(() => {
  "use strict";

  const LEVEL_MAX = 20;
  const STATE_KEY = "azumaQuestState";

  const LEVEL_CODE_RE = /^Azuma_event_level(\d{2})$/;
  const MEDAL_CODE_RE = /^Azuma_event_Medal(\d{2})$/;
  const LAST_QUEST_PASS_CODE = "Azuma_event_LastQuestPass";
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
    braver: "assets/levelup-braver.mp4",
    wizard: "assets/levelup-wizard.mp4",
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

  function showScreen(name) {
    screens.forEach((el) => el.classList.toggle("active", el.id === `screen-${name}`));
    navButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.screen === name));
    bottomNav.classList.toggle("visible", ["status", "treasure", "camera"].includes(name));

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
    }
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
      guidanceLines.push(`・${nextTreasureIndex + 1}ばん のたからばこをさがしてください。`);
    } else {
      if (state.levelCount < LEVEL_MAX) {
        guidanceLines.push(
          state.levelCount < 15 ? "・どの たからばこ をさがしてもOKです。" : "・どのたからばこ をさがしてもOKです。"
        );
      }
      if (availableQuestCount > 0) {
        guidanceLines.push(
          `・${availableQuestCount}つ クエスト（モンスター）へチャレンジできます。どのクエストからでも だいじょうぶ です。`
        );
      }
    }
    questAvailableMessage.hidden = guidanceLines.length === 0;
    if (!questAvailableMessage.hidden) {
      questAvailableMessage.innerHTML = guidanceLines
        .map((line) => `<span class="guidance-line">${line}</span>`)
        .join("");
    }
    document.getElementById("btn-status-enter-bossroom").hidden = !(state.eventLastQuestPass && !state.quizWon);
    document.getElementById("status-boss-defeated-banner").hidden = !state.quizWon;
    document.getElementById("status-key-reveal").hidden = !(state.keyRevealed && !state.quizWon);
    if (state.keyRevealed && !state.quizWon) {
      const keyImg = document.getElementById("key-reveal-image");
      if (!keyImg.classList.contains("drop-in-play")) keyImg.classList.add("key-glowing");
    }
    stopMedalShineRandomizer();
    if (state.quizWon) startCrownSparkle();
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
  // 先にある「とうぞくのかぎ」を一度だけ演出付きで出現させる。
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
        ? "どの たからばこ をさがしてもOKです。"
        : `${nextIndex + 1}ばん のたからばこをさがしてください。`;
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

  function spawnMedalSparkleBurst(index) {
    const layer = document.getElementById(`medal-sparkle-${index}`);
    if (!layer) return;
    spawnOneMedalSparkle(layer);
    let elapsedMs = 0;
    const intervalId = setInterval(() => {
      spawnOneMedalSparkle(layer);
      elapsedMs += 250;
      if (elapsedMs >= 2500) clearInterval(intervalId);
    }, 250);
  }

  // 手に入れた勲章だけをゆっくり光らせ、他の勲章のランダムな光りは
  // この演出が終わるまで止めておく（どれを手に入れたか分かりやすくするため）
  function highlightNewMedal(index) {
    spawnMedalSparkleBurst(index);
    const item = document.getElementById(`medal-${index}`);
    const img = item ? item.querySelector(".status-item-icon-img") : null;
    if (!img) {
      startMedalShineRandomizer();
      maybeRevealThiefKey();
      return;
    }
    img.classList.remove("slow-glow-once");
    void img.offsetWidth; // reflow でアニメーションを再トリガー
    img.classList.add("slow-glow-once");
    const onAnimationEnd = () => {
      img.classList.remove("slow-glow-once");
      img.removeEventListener("animationend", onAnimationEnd);
      startMedalShineRandomizer();
      maybeRevealThiefKey();
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
    const starCount = 14;
    for (let i = 0; i < starCount; i++) {
      const star = document.createElement("span");
      star.className = "levelup-star";
      star.textContent = STAR_CHARS[Math.floor(Math.random() * STAR_CHARS.length)];
      star.style.left = `${Math.random() * 100}%`;
      star.style.fontSize = `${1 + Math.random() * 0.9}rem`;
      star.style.animationDelay = `${Math.random() * 0.7}s`;
      layer.appendChild(star);
    }
    setTimeout(() => {
      layer.innerHTML = "";
    }, 2500);
  }

  // ------------------------------------------------------------------
  // デバッグ用（本番公開前に必ず削除すること）
  // ------------------------------------------------------------------
  document.getElementById("btn-debug-reset-level").addEventListener("click", () => {
    state.levelCount = 0;
    state.eventLevel = new Array(LEVEL_MAX).fill(false);
    saveState();
    renderStatus();
  });

  document.getElementById("btn-debug-level-plus5").addEventListener("click", () => {
    const candidates = [...state.treasureOrder, ...state.eventLevel.keys()];
    let added = 0;
    for (const i of candidates) {
      if (added >= 5) break;
      if (!state.eventLevel[i]) {
        state.eventLevel[i] = true;
        added++;
      }
    }
    state.levelCount = state.eventLevel.filter(Boolean).length;
    saveState();
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

  document.getElementById("btn-debug-quiz-unlock").addEventListener("click", () => {
    state.levelCount = LEVEL_MAX;
    state.eventLevel = new Array(LEVEL_MAX).fill(true);
    state.eventMedal = new Array(4).fill(true);
    saveState();
    renderStatus();
  });

  document.getElementById("btn-debug-quiz-enter-door").addEventListener("click", () => {
    state.eventLastQuestPass = true;
    saveState();
    enterBossRoom();
  });

  document.getElementById("btn-debug-quiz-force-win").addEventListener("click", () => {
    quizRun = null;
    state.quizWon = true;
    state.eventLastMedal = true;
    saveState();
    showScreen("status");
  });

  document.getElementById("btn-debug-quiz-force-fail").addEventListener("click", () => {
    quizRun = null;
    state.recoveryEndsAt = Date.now() + RECOVERY_DURATION_MS;
    saveState();
    showScreen("recovery");
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
      state.eventMedal[midx] = true;
      saveState();
      feedback(200);
      showCameraMessage("メダルを　てにいれた！");
      pendingMedalSparkleIndex = midx;
      setTimeout(() => showScreen("status"), 1200);
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
  // 禁止する。その場合はミュート再生にして、このボタンのタップで音を出せるようにする。
  const btnOverlaySound = document.getElementById("btn-overlay-sound");
  let overlaySoundTarget = null;
  btnOverlaySound.addEventListener("click", () => {
    if (overlaySoundTarget) overlaySoundTarget.muted = false;
    btnOverlaySound.hidden = true;
  });

  function playOverlayVideo({ videoEl, screenName, src, onFinish }) {
    videoEl.src = src;
    showScreen(screenName);
    videoEl.currentTime = 0;
    videoEl.muted = false;
    btnOverlaySound.hidden = true;

    let finished = false;
    let safetyTimeout = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safetyTimeout);
      videoEl.removeEventListener("ended", finish);
      videoEl.removeEventListener("error", finish);
      btnOverlaySound.hidden = true;
      onFinish();
    };
    videoEl.addEventListener("ended", finish);
    videoEl.addEventListener("error", finish);
    videoEl.addEventListener(
      "loadedmetadata",
      () => {
        clearTimeout(safetyTimeout);
        const durationMs = isFinite(videoEl.duration) ? videoEl.duration * 1000 : 30000;
        safetyTimeout = setTimeout(finish, durationMs + 3000);
      },
      { once: true }
    );

    videoEl.play().catch(() => {
      videoEl.muted = true;
      overlaySoundTarget = videoEl;
      btnOverlaySound.hidden = false;
      videoEl.play().catch(finish);
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
      src: "assets/boss-battle-start.mp4",
      onFinish: () => {
        state.quizIntroPlayed = true;
        saveState();
        // 動画終了後、1秒間暗転させてからクイズを開始する
        bossintroVideo.hidden = true;
        setTimeout(startQuizAttempt, 1000);
      },
    });
  }

  const transferVideo = document.getElementById("transfer-video");

  function playLastQuestTransfer() {
    playOverlayVideo({
      videoEl: transferVideo,
      screenName: "transfer",
      src: "assets/transfer-last-quest.mp4",
      onFinish: enterBossRoom,
    });
  }

  function playBossVictory() {
    playOverlayVideo({
      videoEl: bossvictoryVideo,
      screenName: "bossvictory",
      src: "assets/boss-defeated.mp4",
      onFinish: () => {
        showScreen("status");
        retriggerStatusClearFadeIn();
      },
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
  function flashQuizResult(isCorrect) {
    quizFlashOverlay.classList.remove("flash-correct", "flash-wrong");
    void quizFlashOverlay.offsetWidth; // reflow でアニメーションを再トリガー
    quizFlashOverlay.classList.add(isCorrect ? "flash-correct" : "flash-wrong");
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
  const lastQuestEnterable =
    !state.quizWon &&
    (state.eventLastQuestPass || (state.levelCount >= LEVEL_MAX && state.eventMedal.every(Boolean)));
  if (deepLinkCode && state.character) {
    if (deepLinkCode === LAST_QUEST_PASS_CODE && lastQuestEnterable) {
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
})();
