// あずま保育園クエスト：進み具合を Supabase に保存する（保存・ひきつぎ）
// ・ログインの操作はいらない（匿名のIDが自動で作られる）。
// ・つながらないときも、アプリは今までどおり遊べる（スマホの中の保存が、いつも本体）。
//   つながったときに、あとから送る。
(() => {
  "use strict";

  const cfg = window.AZUMA_SUPABASE;
  const CODE_KEY = "azumaRestoreCode"; // ひきつぎコードを、スマホの中にも覚えておく
  const SYNC_DELAY_MS = 1500; // 保存のあと、この時間ほかに変化がなければ送る（細かく何度も送らない）
  const HEARTBEAT_MS = 90 * 1000; // 開いている間、「いま遊んでいる」を知らせる間隔

  let client = null;
  let readyPromise = null;
  let userId = null;
  let hasRow = false; // サーバーに、自分の行がすでにあるか
  let dirty = null; // まだ送っていない保存データ
  let syncTimer = null;
  let busy = false;
  let codeListener = null;

  function available() {
    return !!(cfg && cfg.url && cfg.key && window.supabase && window.supabase.createClient);
  }

  // 接続して、匿名でログインする（すでにログイン済みなら、そのまま）
  function init() {
    if (!available()) return Promise.resolve(null);
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      client = window.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      const { data } = await client.auth.getSession();
      let session = data && data.session;
      if (!session) {
        const res = await client.auth.signInAnonymously();
        if (res.error) throw res.error;
        session = res.data.session;
      }
      userId = session.user.id;
      return client;
    })().catch((e) => {
      console.warn("Supabase に接続できませんでした（あとで、やりなおします）", e && e.message);
      readyPromise = null;
      return null;
    });
    return readyPromise;
  }

  function rememberCode(code) {
    if (!code) return;
    try {
      localStorage.setItem(CODE_KEY, code);
    } catch (e) {}
    if (codeListener) codeListener(code);
  }

  function getRestoreCode() {
    try {
      return localStorage.getItem(CODE_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function buildRow(state) {
    return {
      owner: userId,
      name: state.playerName || "",
      character: state.character || null,
      level_count: state.levelCount || 0,
      medal_count: (state.eventMedal || []).filter(Boolean).length,
      last_quest_pass: !!state.eventLastQuestPass,
      quiz_won: !!state.quizWon,
      ending_seen: !!state.eventEnding,
      state,
      last_seen_at: new Date().toISOString(),
    };
  }

  async function flush() {
    if (busy || !dirty) return;
    const c = await init();
    if (!c) return; // つながらない：dirty を残して、あとでやりなおす
    busy = true;
    const snapshot = dirty;
    try {
      const { data, error } = await c
        .from("players")
        .upsert(buildRow(snapshot), { onConflict: "owner" })
        .select("restore_code")
        .single();
      if (error) throw error;
      hasRow = true;
      if (dirty === snapshot) dirty = null; // 送っている間に、新しい保存がなければ、完了
      rememberCode(data && data.restore_code);
    } catch (e) {
      console.warn("進み具合を送れませんでした（あとで、やりなおします）", e && e.message);
    } finally {
      busy = false;
    }
    if (dirty && !syncTimer) syncTimer = setTimeout(runSync, SYNC_DELAY_MS * 4);
  }

  function runSync() {
    syncTimer = null;
    flush();
  }

  // アプリが「保存した」ときに呼ぶ。名前を入れる前は、送らない。
  function queue(state) {
    if (!available() || !state || !state.playerName) return;
    dirty = JSON.parse(JSON.stringify(state));
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, SYNC_DELAY_MS);
  }

  // 別の端末で、ひきつぎコードから続きをもどす。成功すると、{ ok: true, state } を返す
  async function restore(code) {
    const c = await init();
    if (!c) return { error: "network" };
    const { data, error } = await c.rpc("restore_player", { p_code: code });
    if (error) {
      return { error: /too_many_attempts/.test(error.message || "") ? "too_many" : "network" };
    }
    if (!data) return { error: "notfound" };
    hasRow = true;
    dirty = null;
    rememberCode(data.restore_code);
    return { ok: true, state: data.state, code: data.restore_code };
  }

  // 同じスマホで「最初から」はじめなおすとき：いまの記録（とひきつぎコード）はサーバーに残したまま、
  // このスマホを新しい参加者として扱う（新しい匿名IDで、新しい行・新しいコードができる）
  async function startNewPlayer() {
    clearTimeout(syncTimer);
    syncTimer = null;
    dirty = null;
    hasRow = false;
    try {
      localStorage.removeItem(CODE_KEY);
    } catch (e) {}
    if (!available()) return;
    try {
      const c = await init();
      if (c) await c.auth.signOut({ scope: "local" });
    } catch (e) {}
    client = null;
    userId = null;
    readyPromise = null;
    init();
  }

  // 「いま遊んでいる」を知らせる（画面を開いている間だけ）
  async function heartbeat() {
    if (document.hidden) return;
    if (dirty) return flush();
    if (!hasRow || busy) return;
    const c = await init();
    if (!c) return;
    try {
      await c.from("players").update({ last_seen_at: new Date().toISOString() }).eq("owner", userId);
    } catch (e) {}
  }

  // 画面を閉じる・別のアプリに移るときは、すぐ送る
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && dirty) {
      clearTimeout(syncTimer);
      syncTimer = null;
      flush();
    }
  });
  window.addEventListener("online", () => flush());
  setInterval(heartbeat, HEARTBEAT_MS);

  window.AzumaCloud = {
    available,
    init,
    queue,
    restore,
    getRestoreCode,
    startNewPlayer,
    onRestoreCode(fn) {
      codeListener = fn;
    },
  };

  // アプリを開いたときに、先に接続しておく（匿名ログインまで済ませる）
  init();
})();
