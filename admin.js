// うんえい かんり：参加者の進み具合を、一覧で見る（運営メンバーだけ）
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
  const loginView = $("login-view");
  const mainView = $("main-view");
  const loginMessage = $("login-message");
  const listEl = $("list");
  const listMessage = $("list-message");

  if (!cfg || !window.supabase) {
    loginMessage.textContent = "接続の設定を読み込めませんでした。";
    loginMessage.classList.add("error");
    return;
  }
  const client = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  let players = [];
  let timer = null;
  let loading = false;

  // ---------- ログイン ----------
  async function checkAdmin() {
    const { data, error } = await client.rpc("is_admin");
    return !error && data === true;
  }

  async function enter() {
    if (!(await checkAdmin())) {
      await client.auth.signOut();
      loginView.hidden = false;
      mainView.hidden = true;
      return false;
    }
    loginView.hidden = true;
    mainView.hidden = false;
    await load();
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    return true;
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = $("login-button");
    button.disabled = true;
    loginMessage.classList.remove("error");
    loginMessage.textContent = "ログインしています…";
    const { error } = await client.auth.signInWithPassword({
      email: $("login-email").value.trim(),
      password: $("login-password").value,
    });
    if (error) {
      loginMessage.classList.add("error");
      const code = error.code || "";
      loginMessage.textContent =
        code === "invalid_credentials"
          ? "メールアドレスかパスワードが違います。"
          : code === "email_not_confirmed"
          ? "このアカウントはメールの確認が済んでいません。Supabase の Authentication → Users で、このユーザーを「Confirm」してください。"
          : "ログインできませんでした（" + (code || error.message || "不明なエラー") + "）。";
      button.disabled = false;
      return;
    }
    const ok = await enter();
    if (!ok) {
      loginMessage.classList.add("error");
      loginMessage.textContent = "このアカウントは運営メンバーとして登録されていません。";
    } else {
      loginMessage.textContent = "";
      $("login-password").value = "";
    }
    button.disabled = false;
  });

  $("btn-logout").addEventListener("click", async () => {
    clearInterval(timer);
    await client.auth.signOut();
    players = [];
    mainView.hidden = true;
    loginView.hidden = false;
  });

  // ---------- データを読む ----------
  async function load() {
    if (loading) return;
    loading = true;
    const { data, error } = await client
      .from("players")
      .select(
        "id,name,character,level_count,medal_count,last_quest_pass,quiz_won,ending_seen,restore_code,created_at,last_seen_at,eventLevel:state->eventLevel,eventMedal:state->eventMedal"
      )
      .order("last_seen_at", { ascending: false })
      .limit(2000);
    loading = false;
    if (error) {
      listMessage.classList.add("error");
      listMessage.textContent = "データを読み込めませんでした。しばらくしてから「今すぐ更新」を押してください。";
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

  function rowFor(p) {
    const st = stateOf(p);
    const row = el("div", "row" + (st.cleared ? " is-cleared" : "") + (st.active ? " is-active" : "") + (st.idle ? " is-idle" : ""));

    const name = el("div", "c-name", p.name || "（名前なし）");
    const small = el("small", "", charName(p.character));
    name.appendChild(small);

    const seen = el("div", "c-seen");
    seen.appendChild(el("span", "dot"));
    seen.appendChild(document.createTextNode(agoText(p.last_seen_at)));

    const level = el("div", "c-level");
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.width = Math.min(100, (p.level_count / LEVEL_MAX) * 100) + "%";
    bar.appendChild(fill);
    level.appendChild(bar);
    level.appendChild(el("span", "lv", "Lv " + p.level_count + " / " + LEVEL_MAX));

    const meta = el("div", "c-meta");
    meta.appendChild(el("span", "tag" + (p.last_quest_pass ? " on" : ""), "隠し通路"));
    meta.appendChild(el("span", "tag" + (p.quiz_won ? " on" : ""), "まおう"));
    meta.appendChild(el("span", "tag" + (p.ending_seen ? " on" : ""), "エンディング"));
    meta.appendChild(el("span", "code", "コード " + (p.restore_code || "")));

    const del = el("button", "c-del", "✕");
    del.type = "button";
    del.title = "この人のデータを削除";
    del.addEventListener("click", () => deleteOne(p));

    // クエスト：クリアしたものだけ、勲章の色がつく
    const medalFlags = Array.isArray(p.eventMedal) ? p.eventMedal : [];
    const extra = el("div", "c-extra");
    const quests = el("div", "quests");
    quests.appendChild(el("span", "extra-label", "クエスト"));
    QUESTS.forEach((q, i) => {
      const b = el("span", "quest q" + i + (medalFlags[i] ? " on" : ""), q.color);
      b.title = q.monster + "（" + q.color + "）" + (medalFlags[i] ? "：クリア" : "：まだ");
      quests.appendChild(b);
    });
    // 受けられるクエスト数：レベル5ごとに1つ解放（最大4）－ クリア済みの数（アプリと同じ計算）
    const cleared = medalFlags.filter(Boolean).length;
    const available = Math.max(0, Math.min(4, Math.floor((p.level_count || 0) / 5)) - cleared);
    const a = el("span", "quest-avail" + (available > 0 ? "" : " zero"), "受注可能 " + available + "件");
    a.title = "レベルが上がって、まだ挑戦していないクエストの数";
    quests.appendChild(a);

    // たからばこ：見つけた番号に、色がつく
    const levels = Array.isArray(p.eventLevel) ? p.eventLevel : [];
    const foundCount = levels.filter(Boolean).length;
    const chests = el("div", "chests");
    chests.appendChild(el("span", "extra-label", "宝箱 " + foundCount + " / " + LEVEL_MAX));
    for (let n = 1; n <= LEVEL_MAX; n++) {
      const c = el("span", "chest" + (levels[n - 1] ? " on" : ""), String(n));
      c.title = n + "番" + (levels[n - 1] ? "：見つけた" : "：まだ");
      chests.appendChild(c);
    }
    extra.append(chests, quests, meta);

    row.append(name, seen, level, del, extra);
    return row;
  }

  function currentList() {
    const q = $("search").value.trim().toLowerCase();
    const filter = $("filter").value;
    let list = players.filter((p) => {
      if (q && !(p.name || "").toLowerCase().includes(q)) return false;
      const mf = Array.isArray(p.eventMedal) ? p.eventMedal : [];
      if (filter === "avail") return Math.min(4, Math.floor((p.level_count || 0) / 5)) - mf.filter(Boolean).length > 0;
      if (/^notq[0-3]$/.test(filter)) return !mf[Number(filter.slice(4))];
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
      name: (a, b) => (a.name || "").localeCompare(b.name || "", "ja"),
      created: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    }[sort];
    list = list.slice().sort(by);
    return list;
  }

  function render() {
    // まとめ
    const total = players.length;
    let active = 0, boss = 0, ending = 0, idle = 0, sum = 0;
    players.forEach((p) => {
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

  ["search", "sort", "filter"].forEach((id) => $(id).addEventListener("input", render));
  $("btn-refresh").addEventListener("click", load);

  // ---------- CSV ----------
  $("btn-csv").addEventListener("click", () => {
    const head = ["名前", "キャラ", "レベル", "勲章", "クリアしたクエスト", "見つけた宝箱", "隠し通路", "まおう", "エンディング", "引き継ぎコード", "開始日時", "最終アクセス"];
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const fmt = (iso) => new Date(iso).toLocaleString("ja-JP");
    const lines = [head.map(q).join(",")];
    currentList().forEach((p) => {
      lines.push(
        [
          p.name, charName(p.character), p.level_count, p.medal_count,
          (Array.isArray(p.eventMedal) ? p.eventMedal : []).map((v, i) => (v ? QUESTS[i].color : "")).filter(Boolean).join("・"),
          (Array.isArray(p.eventLevel) ? p.eventLevel : []).map((v, i) => (v ? i + 1 : "")).filter(Boolean).join(" "),
          p.last_quest_pass ? "○" : "", p.quiz_won ? "○" : "", p.ending_seen ? "○" : "",
          p.restore_code, fmt(p.created_at), fmt(p.last_seen_at),
        ].map(q).join(",")
      );
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "azuma-quest-players.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---------- 消す ----------
  async function deleteOne(p) {
    if (!confirm((p.name || "（名前なし）") + " さんのデータを削除します。よろしいですか？\n（元に戻せません）")) return;
    const { error } = await client.from("players").delete().eq("id", p.id);
    if (error) {
      alert("削除できませんでした。\n原因：" + (error.message || error.code || "不明"));
      return;
    }
    load();
  }

  $("btn-delete-all").addEventListener("click", async () => {
    const answer = prompt(
      "参加者のデータをすべて削除します（元に戻せません）。\n本当に削除する場合は、「全部削除」と入力してください。"
    );
    if (answer !== "全部削除") return;
    const { data, error } = await client.rpc("admin_delete_all_players");
    if (error) {
      alert("削除できませんでした。\n原因：" + (error.message || error.code || "不明"));
      return;
    }
    alert(data + " 人分のデータを削除しました。");
    load();
  });

  // ---------- はじめ：すでにログイン済みなら、そのまま入る ----------
  (async () => {
    const { data } = await client.auth.getSession();
    const user = data && data.session && data.session.user;
    if (user && !user.is_anonymous) await enter();
  })();
})();
