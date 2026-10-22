(() => {
  "use strict";

  const STORAGE_KEY = "azumaLocateRecords_v1";
  // ?sec=5 のように指定すると、測る時間を変えられる（動作確認用）。ふだんは20秒。
  const MEASURE_SECONDS = Math.max(3, parseInt(new URLSearchParams(location.search).get("sec"), 10) || 20);
  const GOOD_ACCURACY_M = 20; // これ以下の精度なら、確認なしで自動保存する
  const MAX_USABLE_ACCURACY_M = 100; // これより精度が悪い測定値は、平均に使わない（ほかに無いときだけ使う）
  const MIN_SAMPLES = 3;

  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------
  // 記録する場所の一覧（たからばこ → クエスト → 集合場所 → でんせつぶき）
  // ref は、アプリがいま使っている位置（map-data.js）。でんせつぶきは、まだ位置が無い。
  // ------------------------------------------------------------------
  const targets = [];
  (window.MAP_TREASURES || []).forEach((t) =>
    targets.push({ id: `t${t.n}`, group: "たからばこ", name: `たからばこ ${t.n}ばん`, label: String(t.n), ref: { lat: t.lat, lng: t.lng } })
  );
  (window.MAP_QUESTS || []).forEach((q) =>
    targets.push({ id: `q-${q.monster}`, group: "クエスト", name: `クエスト ${q.monster}`, label: q.monster.slice(0, 2), ref: { lat: q.lat, lng: q.lng } })
  );
  if (window.MAP_MEETING) {
    targets.push({ id: "meeting", group: "集合場所", name: window.MAP_MEETING.name, label: "集", ref: { lat: window.MAP_MEETING.lat, lng: window.MAP_MEETING.lng } });
  }
  for (let i = 1; i <= 4; i++) {
    targets.push({ id: `w${i}`, group: "でんせつぶき", name: `でんせつぶき ${i}`, label: `武${i}`, ref: null });
  }
  const byId = (id) => targets.find((t) => t.id === id);

  // ------------------------------------------------------------------
  // 記録の保存（この端末のブラウザの中に自動で保存）
  // ------------------------------------------------------------------
  let records = {};
  try {
    records = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch (e) {
    records = {};
  }
  function saveRecords() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (e) {
      toast("保存できませんでした。書き出しで、すぐにコピーしてください。");
    }
  }

  // ------------------------------------------------------------------
  // 距離・座標の変換（アプリの app.js と同じ式）
  // ------------------------------------------------------------------
  function distanceM(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function geoToImage(lat, lng) {
    const cfg = window.MAP_IMAGE;
    const n = Math.pow(2, cfg.geo.zoom);
    const mx = ((lng + 180) / 360 * n - cfg.geo.originTileX) * 256;
    const r = (lat * Math.PI) / 180;
    const my = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n - cfg.geo.originTileY) * 256;
    const t = cfg.affine;
    return { x: t.a * mx + t.b * my + t.c, y: t.d * mx + t.e * my + t.f };
  }
  const toLatLng = (pos) => {
    const p = geoToImage(pos.lat, pos.lng);
    return L.latLng(window.MAP_IMAGE.height - p.y, p.x);
  };

  // ------------------------------------------------------------------
  // 地図
  // ------------------------------------------------------------------
  const cfg = window.MAP_IMAGE;
  const bounds = L.latLngBounds([0, 0], [cfg.height, cfg.width]);
  const map = L.map("map", {
    crs: L.CRS.Simple,
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 0,
    zoomDelta: 0.5,
    minZoom: -6,
    maxZoom: 1.6,
    inertia: true,
    maxBoundsViscosity: 1,
  });
  L.control.zoom({ position: "bottomleft", zoomInText: "+", zoomOutText: "−" }).addTo(map);
  L.imageOverlay(cfg.src, bounds).addTo(map);
  map.setMaxBounds(bounds.pad(0.02));

  let fitZoom = 0;
  function updateFitZoom() {
    map.options.minZoom = -6;
    fitZoom = map.getBoundsZoom(bounds, false);
    map.setMinZoom(fitZoom);
  }
  function fitAll() {
    map.invalidateSize();
    updateFitZoom();
    map.setView(bounds.getCenter(), fitZoom, { animate: false });
    updatePinScale();
  }
  // 全体を見ているときは、番号のバッジを小さくして重なりを減らす（拡大すると、元の大きさ）
  function updatePinScale() {
    const scale = Math.min(1, 0.55 + (0.45 * (map.getZoom() - fitZoom)) / 1.4);
    map.getContainer().style.setProperty("--pin-s", scale.toFixed(3));
  }
  map.on("resize", () => {
    updateFitZoom();
    updatePinScale();
  });
  map.on("zoom", updatePinScale);

  const layer = L.layerGroup().addTo(map);
  let showRef = true;

  function pinIcon(text, cls) {
    return L.divIcon({ className: "pin-icon", html: `<div class="pin ${cls}">${text}</div>`, iconSize: [0, 0] });
  }

  function refreshMap() {
    layer.clearLayers();
    targets.forEach((t) => {
      const rec = records[t.id];
      const sel = t.id === selectedId ? " pin-sel" : "";
      if (showRef && t.ref) {
        L.marker(toLatLng(t.ref), { icon: pinIcon(t.label, "pin-ref" + (rec ? "" : sel)), zIndexOffset: sel && !rec ? 800 : 0 })
          .on("click", () => selectTarget(t.id, false))
          .addTo(layer);
      }
      if (rec) {
        if (showRef && t.ref) {
          L.polyline([toLatLng(t.ref), toLatLng(rec)], { color: "#f4d35e", weight: 2, dashArray: "4 4", interactive: false }).addTo(layer);
        }
        L.marker(toLatLng(rec), { icon: pinIcon(t.label, "pin-rec" + sel), zIndexOffset: 1000 })
          .on("click", () => selectTarget(t.id, false))
          .addTo(layer);
      }
    });
  }

  // ------------------------------------------------------------------
  // GPS（現在地の青い点・測定の両方で使う）
  // ------------------------------------------------------------------
  let watchId = null;
  let lastFix = null;
  let locateOn = false;
  let measuring = null; // { targetId, samples, startedAt, timer }
  let pending = null; // 精度が低くて、確認待ちの測定結果
  let meDot = null;
  let meCircle = null;

  function setGps(text, level) {
    const el = $("gps-status");
    el.textContent = text;
    el.className = "gps" + (level ? " " + level : "");
  }

  function ensureWatch() {
    if (watchId !== null) return;
    if (!navigator.geolocation) {
      setGps("GPS：この端末では使えません", "bad");
      return;
    }
    setGps("GPS：さがしています…", "warn");
    watchId = navigator.geolocation.watchPosition(onFix, onGeoError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }

  function releaseWatchIfIdle() {
    if (locateOn || measuring || watchId === null) return;
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    lastFix = null;
    clearMe();
    setGps("GPS：とまっています");
  }

  function onGeoError(err) {
    if (err && err.code === 1) {
      setGps("GPS：きょかされていません", "bad");
      toast("位置情報が許可されていません。ブラウザの設定で、このページの位置情報を許可してください。");
    } else {
      setGps("GPS：とれませんでした", "bad");
    }
  }

  function onFix(pos) {
    lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now() };
    const acc = Math.round(lastFix.acc);
    setGps(`GPS：±${acc}m`, lastFix.acc <= GOOD_ACCURACY_M ? "ok" : "warn");
    drawMe();
    if (measuring) {
      measuring.samples.push(lastFix);
      updateMeasureUi();
    }
  }

  function clearMe() {
    if (meDot) map.removeLayer(meDot);
    if (meCircle) map.removeLayer(meCircle);
    meDot = null;
    meCircle = null;
  }

  function drawMe() {
    if (!lastFix) return;
    const p = geoToImage(lastFix.lat, lastFix.lng);
    const margin = 150;
    if (p.x < -margin || p.x > cfg.width + margin || p.y < -margin || p.y > cfg.height + margin) {
      clearMe();
      return;
    }
    const ll = toLatLng(lastFix);
    const radiusPx = Math.max(lastFix.acc / cfg.metersPerPixel, 0);
    if (!meDot) {
      meCircle = L.circle(ll, { radius: radiusPx, stroke: false, fillColor: "#4285f4", fillOpacity: 0.16, interactive: false }).addTo(map);
      meDot = L.marker(ll, {
        icon: L.divIcon({ className: "me-icon", html: '<div class="me-dot"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }),
        zIndexOffset: 2000,
        interactive: false,
      }).addTo(map);
    } else {
      meDot.setLatLng(ll);
      meCircle.setLatLng(ll);
      meCircle.setRadius(radiusPx);
    }
  }

  $("btn-locate").addEventListener("click", () => {
    if (locateOn) {
      locateOn = false;
      $("btn-locate").classList.remove("is-on");
      releaseWatchIfIdle();
      return;
    }
    locateOn = true;
    $("btn-locate").classList.add("is-on");
    ensureWatch();
    if (lastFix) map.setView(toLatLng(lastFix), Math.max(map.getZoom(), fitZoom + 1.4), { animate: true });
  });

  // ------------------------------------------------------------------
  // 測定（MEASURE_SECONDS 秒のあいだ位置を集めて、精度で重みをつけた平均を取る）
  // ------------------------------------------------------------------
  function startMeasure() {
    pending = null;
    measuring = { targetId: selectedId, samples: [], startedAt: Date.now(), timer: null };
    ensureWatch();
    measuring.timer = setInterval(() => {
      updateMeasureUi();
      if (Date.now() - measuring.startedAt >= MEASURE_SECONDS * 1000) finishMeasure();
    }, 200);
    renderPanel();
  }

  function cancelMeasure() {
    if (!measuring) return;
    clearInterval(measuring.timer);
    measuring = null;
    pending = null;
    releaseWatchIfIdle();
    renderPanel();
  }

  function finishMeasure() {
    if (!measuring) return;
    const m = measuring;
    clearInterval(m.timer);
    measuring = null;
    releaseWatchIfIdle();

    const usable = m.samples.filter((s) => s.acc <= MAX_USABLE_ACCURACY_M);
    const use = usable.length ? usable : m.samples;
    if (use.length < MIN_SAMPLES) {
      toast(`測定が ${use.length}回しか取れませんでした。空が見える場所で、もう一度やってください。`);
      renderPanel();
      return;
    }
    let sw = 0;
    let la = 0;
    let ln = 0;
    use.forEach((s) => {
      const w = 1 / Math.pow(Math.max(s.acc, 1), 2);
      sw += w;
      la += w * s.lat;
      ln += w * s.lng;
    });
    const center = { lat: la / sw, lng: ln / sw };
    const accs = use.map((s) => s.acc).sort((a, b) => a - b);
    const acc = accs[Math.floor(accs.length / 2)];
    const spread = Math.sqrt(use.reduce((sum, s) => sum + Math.pow(distanceM(s, center), 2), 0) / use.length);
    const result = { targetId: m.targetId, lat: center.lat, lng: center.lng, acc, n: use.length, spread, ts: Date.now() };

    if (acc <= GOOD_ACCURACY_M) {
      saveResult(result, true);
    } else {
      pending = result;
      renderPanel();
    }
  }

  function saveResult(result, advance) {
    records[result.targetId] = { lat: result.lat, lng: result.lng, acc: result.acc, n: result.n, spread: result.spread, ts: result.ts };
    pending = null;
    saveRecords();
    const t = byId(result.targetId);
    toast(`${t.name} を記録しました（±${Math.round(result.acc)}m）`);
    if (advance) {
      const next = nextUnrecorded(result.targetId);
      if (next) selectedId = next;
    }
    renderAll();
    const sel = byId(selectedId);
    const pos = records[selectedId] || (sel && sel.ref);
    if (pos) map.panTo(toLatLng(pos), { animate: true });
  }

  function nextUnrecorded(afterId) {
    const start = targets.findIndex((t) => t.id === afterId);
    for (let i = 1; i <= targets.length; i++) {
      const t = targets[(start + i) % targets.length];
      if (!records[t.id]) return t.id;
    }
    return null;
  }

  function updateMeasureUi() {
    if (!measuring) return;
    const elapsed = Math.min((Date.now() - measuring.startedAt) / 1000, MEASURE_SECONDS);
    $("progress-bar").style.width = `${(elapsed / MEASURE_SECONDS) * 100}%`;
    const n = measuring.samples.length;
    let text;
    if (n === 0) {
      text = `測定中… ${Math.floor(elapsed)}/${MEASURE_SECONDS}秒\nまだ位置が取れていません。空が見える場所で、少し待ってください。`;
    } else {
      const acc = Math.round(measuring.samples[n - 1].acc);
      text = `測定中… ${Math.floor(elapsed)}/${MEASURE_SECONDS}秒 ・ ${n}回\nいまの精度 ±${acc}m`;
    }
    $("measure-text").textContent = text;
    $("measure-text").style.whiteSpace = "pre-line";
  }

  // ------------------------------------------------------------------
  // 画面の更新
  // ------------------------------------------------------------------
  let selectedId = targets[0].id;

  function movedText(t) {
    const rec = records[t.id];
    if (!rec || !t.ref) return "";
    return `アプリの位置から ${Math.round(distanceM(t.ref, rec))}m`;
  }

  function renderPanel() {
    const t = byId(selectedId);
    const rec = records[t.id];
    $("current-name").textContent = t.name;
    if (rec) {
      const moved = movedText(t);
      $("current-sub").textContent = `記録ずみ ±${Math.round(rec.acc)}m（${rec.n}回）${moved ? " ・ " + moved : ""}`;
    } else {
      $("current-sub").textContent = t.ref ? "まだ記録していません" : "まだ記録していません（アプリには、まだ位置がありません）";
    }

    const isMeasuring = !!measuring;
    $("idle-box").hidden = isMeasuring || !!pending;
    $("measure-box").hidden = !isMeasuring;
    $("confirm-box").hidden = !pending;
    $("btn-prev").disabled = isMeasuring;
    $("btn-next").disabled = isMeasuring;
    $("btn-delete").hidden = !rec;
    $("btn-record").textContent = rec ? "もういちど 記録する" : "ここを 記録する";
    $("btn-record").insertAdjacentHTML("beforeend", `（<span id="sec-label">${MEASURE_SECONDS}</span>秒）`);

    if (pending) {
      $("confirm-text").textContent =
        `精度が ±${Math.round(pending.acc)}m と低めです（${pending.n}回の平均）。\n木や建物から離れた所で、もう一度測るのがおすすめです。このまま保存しますか？`;
      $("confirm-text").style.whiteSpace = "pre-line";
    }
    if (isMeasuring) updateMeasureUi();
  }

  function renderList() {
    const box = $("target-list");
    box.textContent = "";
    let lastGroup = "";
    targets.forEach((t) => {
      if (t.group !== lastGroup) {
        lastGroup = t.group;
        const h = document.createElement("div");
        h.className = "group-title";
        h.textContent = t.group;
        box.appendChild(h);
      }
      const rec = records[t.id];
      const row = document.createElement("button");
      row.className = "row" + (rec ? " is-done" : "") + (t.id === selectedId ? " is-selected" : "");
      row.innerHTML = '<span class="dot"></span><span class="name"></span><span class="info"></span>';
      row.querySelector(".name").textContent = t.name;
      row.querySelector(".info").textContent = rec ? `±${Math.round(rec.acc)}m${t.ref ? " ・ " + Math.round(distanceM(t.ref, rec)) + "m動いた" : ""}` : "未記録";
      row.addEventListener("click", () => {
        if (!measuring) selectTarget(t.id, true);
      });
      box.appendChild(row);
    });
    const done = targets.filter((t) => records[t.id]).length;
    $("progress-count").textContent = `（${done} / ${targets.length}）`;
  }

  function renderAll() {
    renderPanel();
    renderList();
    refreshMap();
    if (!$("export-box").hidden) renderExport();
  }

  function selectTarget(id, pan) {
    if (measuring) return;
    selectedId = id;
    pending = null;
    renderAll();
    if (pan) {
      const t = byId(id);
      const pos = records[id] || t.ref;
      if (pos) map.panTo(toLatLng(pos), { animate: true });
    }
  }

  $("btn-prev").addEventListener("click", () => {
    const i = targets.findIndex((t) => t.id === selectedId);
    selectTarget(targets[(i - 1 + targets.length) % targets.length].id, true);
  });
  $("btn-next").addEventListener("click", () => {
    const i = targets.findIndex((t) => t.id === selectedId);
    selectTarget(targets[(i + 1) % targets.length].id, true);
  });
  $("btn-record").addEventListener("click", startMeasure);
  $("btn-finish").addEventListener("click", finishMeasure);
  $("btn-cancel").addEventListener("click", cancelMeasure);
  $("btn-save").addEventListener("click", () => {
    if (pending) saveResult(pending, true);
  });
  $("btn-retry").addEventListener("click", () => {
    pending = null;
    startMeasure();
  });
  $("btn-delete").addEventListener("click", () => {
    const t = byId(selectedId);
    if (!records[t.id] || !confirm(`${t.name} の記録を消しますか？`)) return;
    delete records[t.id];
    saveRecords();
    renderAll();
  });

  $("toggle-ref").addEventListener("change", (ev) => {
    showRef = ev.target.checked;
    refreshMap();
  });
  $("btn-map-reset").addEventListener("click", fitAll);

  // ------------------------------------------------------------------
  // 書き出し
  // ------------------------------------------------------------------
  const pad2 = (n) => String(n).padStart(2, "0");
  function formatTime(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function csvText() {
    const rows = ["種別,番号またはモンスター名,緯度,経度,精度(m),測定回数,記録日時,アプリの元の緯度,アプリの元の経度,元からのずれ(m)"];
    targets.forEach((t) => {
      const rec = records[t.id];
      const kind = t.group;
      const nm = t.id.startsWith("t") ? t.id.slice(1) : t.id.startsWith("q-") ? t.id.slice(2) : t.id.startsWith("w") ? t.id.slice(1) : t.name;
      rows.push(
        [
          kind,
          nm,
          rec ? rec.lat.toFixed(7) : "",
          rec ? rec.lng.toFixed(7) : "",
          rec ? Math.round(rec.acc) : "",
          rec ? rec.n : "",
          rec ? formatTime(rec.ts) : "",
          t.ref ? t.ref.lat : "",
          t.ref ? t.ref.lng : "",
          rec && t.ref ? Math.round(distanceM(t.ref, rec)) : "",
        ].join(",")
      );
    });
    return rows.join("\n");
  }

  // そのまま map-data.js の位置データの部分に貼れる形。未記録のものは、いまのアプリの位置のまま。
  function mapDataText() {
    const pos = (t) => records[t.id] || t.ref;
    const f = (v) => Number(v.toFixed(7));
    const lines = [];
    lines.push("window.MAP_TREASURES = [");
    targets.filter((t) => t.group === "たからばこ").forEach((t) => lines.push(`  { n: ${t.id.slice(1)}, lat: ${f(pos(t).lat)}, lng: ${f(pos(t).lng)} },`));
    lines.push("];", "window.MAP_QUESTS = [");
    targets.filter((t) => t.group === "クエスト").forEach((t) => lines.push(`  { monster: "${t.id.slice(2)}", lat: ${f(pos(t).lat)}, lng: ${f(pos(t).lng)} },`));
    lines.push("];");
    const m = targets.find((t) => t.id === "meeting");
    if (m) lines.push(`window.MAP_MEETING = { name: "${m.name}", lat: ${f(pos(m).lat)}, lng: ${f(pos(m).lng)} };`);
    const weapons = targets.filter((t) => t.group === "でんせつぶき" && records[t.id]);
    if (weapons.length) {
      lines.push("window.MAP_WEAPONS = [");
      weapons.forEach((t) => lines.push(`  { n: ${t.id.slice(1)}, lat: ${f(records[t.id].lat)}, lng: ${f(records[t.id].lng)} },`));
      lines.push("];");
    }
    return lines.join("\n");
  }

  let exportMode = "csv";
  function renderExport() {
    $("export-text").value = exportMode === "js" ? mapDataText() : csvText();
  }

  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage);
    } catch (e) {
      const ta = $("export-text");
      ta.value = text;
      ta.removeAttribute("readonly");
      ta.focus();
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e2) {
        ok = false;
      }
      ta.setAttribute("readonly", "");
      toast(ok ? okMessage : "コピーできませんでした。下の文字を、長押しして選んでコピーしてください。");
    }
  }

  $("btn-export-toggle").addEventListener("click", () => {
    const box = $("export-box");
    box.hidden = !box.hidden;
    $("btn-export-toggle").textContent = box.hidden ? "書き出し（CSV・map-data.js）をひらく" : "書き出しを とじる";
    if (!box.hidden) renderExport();
  });
  $("btn-copy-csv").addEventListener("click", () => {
    exportMode = "csv";
    renderExport();
    copyText(csvText(), "CSVをコピーしました");
  });
  $("btn-copy-js").addEventListener("click", () => {
    exportMode = "js";
    renderExport();
    copyText(mapDataText(), "map-data.js用をコピーしました");
  });
  $("btn-download-csv").addEventListener("click", () => {
    exportMode = "csv";
    renderExport();
    const d = new Date();
    const name = `マーカー実測_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}.csv`;
    const blob = new Blob(["﻿" + csvText()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("CSVを保存しました");
  });
  $("btn-clear-all").addEventListener("click", () => {
    if (!confirm("記録を、すべて消します。先に書き出しましたか？")) return;
    records = {};
    saveRecords();
    renderAll();
  });

  // ------------------------------------------------------------------
  // お知らせ
  // ------------------------------------------------------------------
  let toastTimer = null;
  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 3500);
  }

  // ------------------------------------------------------------------
  // はじめ
  // ------------------------------------------------------------------
  fitAll();
  renderAll();
  window.addEventListener("beforeunload", () => {
    if (measuring) clearInterval(measuring.timer);
  });
})();
