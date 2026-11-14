// うんえい みまもり：参加者の進み具合を、見るだけの画面（ログインなし・キー付きURL）
(() => {
  "use strict";

  const cfg = window.AZUMA_SUPABASE;
  const REFRESH_MS = 10 * 1000; // 一覧を、自動で新しくする間隔
  const ACTIVE_MS = 10 * 60 * 1000; // この時間いないに動いていたら「いま あそんでいる」
  const IDLE_MS = 30 * 60 * 1000; // この時間いじょう動いていなくて、クリア前なら「うごいていない」
  const LEVEL_MAX = 20;
  const MEDAL_MAX = 4;
  // クエスト（勲章）：番号は、アプリの勲章の番号（0:あか 1:あお 2:みどり 3:ピンク）と同じ
  const QUESTS = [
    { color: "赤", monster: "ガーゴイル" },
    { color: "青", monster: "ピラニアン" },
    { color: "緑", monster: "サーペント" },
    { color: "ピンク", monster: "アビスバイク" },
  ];

  const $ = (id) => document.getElementById(id);
  const listEl = $("list");
  const listMessage = $("list-message");
  const KEY = new URLSearchParams(location.search).get("key") || "";
  if (!cfg || !window.supabase) {
    listMessage.classList.add("error");
    listMessage.textContent = "接続の設定を読み込めませんでした。";
    return;
  }
  if (!KEY) {
    listMessage.classList.add("error");
    listMessage.textContent = "閲覧用のURLが正しくありません。運営から共有されたURLを、そのまま開いてください。";
    return;
  }
  const client = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let players = [];
  let timer = null;
  let loading = false;

  // ---------- データを読む ----------
  async function load() {
    if (loading) return;
    loading = true;
    const { data, error } = await client.rpc("watch_players", { p_key: KEY });
    loading = false;
    if (error) {
      listMessage.classList.add("error");
      listMessage.textContent = /not_allowed/.test(error.message || "") ? "閲覧用のURLが正しくないか、古くなっています。運営から新しいURLを受け取ってください。" : "データを読み込めませんでした。しばらくしてから「今すぐ更新」を押してください。";
      return;
    }
    listMessage.classList.remove("error");
    listMessage.textContent = "";
    players = data || [];
    $("updated-at").textContent = "更新：" + new Date().toLocaleTimeString("ja-JP");
    render();
  }

  // ---------- 表示 ----------
  function agoText(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "たった今";
    if (m < 60) return m + "分前";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "時間前";
    return Math.floor(h / 24) + "日前";
  }

  function stateOf(p) {
    const age = Date.now() - new Date(p.last_seen_at).getTime();
    return {
      active: age <= ACTIVE_MS,
      idle: age >= IDLE_MS && !p.quiz_won,
      cleared: !!p.quiz_won,
    };
  }

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function charName(c) {
    return c === "braver" ? "ゆうしゃ" : c === "wizard" ? "まほうつかい" : "";
  }

  // ---------- 通常版 / Light版 ----------
  // Light版のアプリは、保存データ（state）に appKind:"light" を入れて送ってくる（入っていなければ通常版）。
  // Light版：たからばこ10個、クエスト2つ（赤＝ガーゴイル、緑＝サーペント）。
  function isLight(p) {
    return p.kind === "light";
  }
  function maxLevelOf(p) {
    return isLight(p) ? 10 : LEVEL_MAX;
  }
  function questSlotsOf(p) {
    return isLight(p) ? [0, 2] : [0, 1, 2, 3];
  }
  function clearedOf(p, flags) {
    return questSlotsOf(p).filter((i) => flags[i]).length;
  }
  function availableOf(p, flags) {
    return Math.max(0, Math.min(questSlotsOf(p).length, Math.floor((p.level_count || 0) / 5)) - clearedOf(p, flags));
  }

  function rowFor(p) {
    const st = stateOf(p);
    const row = el("div", "row" + (st.cleared ? " is-cleared" : "") + (st.active ? " is-active" : "") + (st.idle ? " is-idle" : ""));

    const name = el("div", "c-name", p.name || "（名前なし）");
    const small = el("small", "", charName(p.character));
    name.appendChild(small);
    name.appendChild(el("span", "kind-badge" + (isLight(p) ? " light" : ""), isLight(p) ? "Light" : "通常"));

    const seen = el("div", "c-seen");
    seen.appendChild(el("span", "dot"));
    seen.appendChild(document.createTextNode(agoText(p.last_seen_at)));

    const level = el("div", "c-level");
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.width = Math.min(100, (p.level_count / maxLevelOf(p)) * 100) + "%";
    bar.appendChild(fill);
    level.appendChild(bar);
    level.appendChild(el("span", "lv", "Lv " + p.level_count + " / " + maxLevelOf(p)));

    const meta = el("div", "c-meta");
    meta.appendChild(el("span", "tag" + (p.last_quest_pass ? " on" : ""), "隠し通路"));
    meta.appendChild(el("span", "tag" + (p.quiz_won ? " on" : ""), "まおう"));
    meta.appendChild(el("span", "tag" + (p.ending_seen ? " on" : ""), "エンディング"));

    // クエスト：クリアしたものだけ、勲章の色がつく
    const medalFlags = Array.isArray(p.eventMedal) ? p.eventMedal : [];
    const extra = el("div", "c-extra");
    const quests = el("div", "quests");
    quests.appendChild(el("span", "extra-label", "クエスト"));
    QUESTS.forEach((q, i) => {
      if (!questSlotsOf(p).includes(i)) return;
      const b = el("span", "quest q" + i + (medalFlags[i] ? " on" : ""), q.color);
      b.title = q.monster + "（" + q.color + "）" + (medalFlags[i] ? "：クリア" : "：まだ");
      quests.appendChild(b);
    });
    // 受けられるクエスト数：レベル5ごとに1つ解放（最大4）－ クリア済みの数（アプリと同じ計算）
    const available = availableOf(p, medalFlags);
    const a = el("span", "quest-avail" + (available > 0 ? "" : " zero"), "受注可能 " + available + "件");
    a.title = "レベルが上がって、まだ挑戦していないクエストの数";
    quests.appendChild(a);

    // たからばこ：見つけた番号に、色がつく
    const levels = Array.isArray(p.eventLevel) ? p.eventLevel : [];
    const foundCount = levels.filter(Boolean).length;
    const chests = el("div", "chests");
    chests.appendChild(el("span", "extra-label", "宝箱 " + foundCount + " / " + maxLevelOf(p)));
    for (let n = 1; n <= maxLevelOf(p); n++) {
      const c = el("span", "chest" + (levels[n - 1] ? " on" : ""), String(n));
      c.title = n + "番" + (levels[n - 1] ? "：見つけた" : "：まだ");
      chests.appendChild(c);
    }
    extra.append(chests, quests, meta);

    row.append(name, seen, level, extra);
    return row;
  }

  // 「通常版／Light版」の絞り込み
  function matchKind(p) {
    const k = $("kind-filter").value;
    return k === "all" || (k === "light" ? isLight(p) : !isLight(p));
  }

  // クエストの進み具合（並べ替え用）。エンディング → まおう → 隠し通路 → 勲章の割合 → レベルの割合 の順に比べる。
  // 割合で比べるので、通常版（勲章4つ・レベル20）とLight版（勲章2つ・レベル10）をまぜて並べられる。
  function progressKey(p) {
    const flags = Array.isArray(p.eventMedal) ? p.eventMedal : [];
    const stage = p.ending_seen ? 3 : p.quiz_won ? 2 : p.last_quest_pass ? 1 : 0;
    return [stage, clearedOf(p, flags) / questSlotsOf(p).length, (p.level_count || 0) / maxLevelOf(p)];
  }
  function byProgress(a, b) {
    const ka = progressKey(a), kb = progressKey(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return new Date(b.last_seen_at) - new Date(a.last_seen_at);
  }

  function currentList() {
    const q = $("search").value.trim().toLowerCase();
    const filter = $("filter").value;
    let list = players.filter((p) => {
      if (!matchKind(p)) return false;
      if (q && !(p.name || "").toLowerCase().includes(q)) return false;
      const mf = Array.isArray(p.eventMedal) ? p.eventMedal : [];
      if (filter === "avail") return availableOf(p, mf) > 0;
      if (/^notq[0-3]$/.test(filter)) {
        const qi = Number(filter.slice(4));
        return questSlotsOf(p).includes(qi) && !mf[qi]; // Light版には、青・ピンクのクエストがない
      }
      if (filter === "nopass") return !p.last_quest_pass;
      if (filter === "notboss") return !p.quiz_won;
      if (filter === "noend") return !p.ending_seen;
      return true;
    });
    const sort = $("sort").value;
    const by = {
      seen: (a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at),
      level: (a, b) => b.level_count - a.level_count || b.medal_count - a.medal_count,
      levelAsc: (a, b) => a.level_count - b.level_count || a.medal_count - b.medal_count,
      progress: byProgress,
      name: (a, b) => (a.name || "").localeCompare(b.name || "", "ja"),
      created: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    }[sort];
    list = list.slice().sort(by);
    return list;
  }

  function render() {
    // Light版だけを見ているときは、Light版にない「青」「ピンク」のクエストの絞り込みを消す
    const lightOnly = $("kind-filter").value === "light";
    ["notq1", "notq3"].forEach((v) => {
      const opt = $("filter").querySelector('option[value="' + v + '"]');
      if (opt) {
        opt.hidden = lightOnly;
        opt.disabled = lightOnly;
      }
    });
    if (lightOnly && /^notq[13]$/.test($("filter").value)) $("filter").value = "all";
    // まとめ
    const shown = players.filter(matchKind);
    const total = shown.length;
    let active = 0, boss = 0, ending = 0, idle = 0, sum = 0;
    shown.forEach((p) => {
      const st = stateOf(p);
      if (st.active) active++;
      if (p.quiz_won) boss++;
      if (p.ending_seen) ending++;
      if (st.idle) idle++;
      sum += p.level_count || 0;
    });
    $("stat-total").textContent = total;
    $("stat-active").textContent = active;
    $("stat-boss").textContent = boss;
    $("stat-ending").textContent = ending;
    $("stat-avg").textContent = total ? (sum / total).toFixed(1) : "0";
    $("stat-idle").textContent = idle;

    // 一覧
    const list = currentList();
    listEl.textContent = "";
    list.forEach((p) => listEl.appendChild(rowFor(p)));
    if (!list.length) {
      listMessage.classList.remove("error");
      listMessage.textContent = total ? "条件に合う人はいません。" : "まだ参加者はいません。";
    } else if (!listMessage.classList.contains("error")) {
      listMessage.textContent = "";
    }
  }

  ["search", "sort", "filter", "kind-filter"].forEach((id) => $(id).addEventListener("input", render));
  $("btn-refresh").addEventListener("click", load);

  // ---------- はじめ ----------
  load();
  timer = setInterval(() => {
    if (!document.hidden) load();
  }, REFRESH_MS);
})();
