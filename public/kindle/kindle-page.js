/* ═══════════════════════════════════════════════════════════
   Kindling — host page glue (the SHELL, not the engine)
   ───────────────────────────────────────────────────────────
   Owns the shell-level pieces: the Lv bar, the greyed "get Lannair"
   funnel link, the PNG export, the completion check-off, and the
   touch fallback. The engine + leveling files stay byte-identical.

   VIEW TRANSITIONS: with Astro's ClientRouter the page swaps without a
   full reload, so this glue is driven by `astro:page-load` (fires on the
   first load AND after every client-side navigation). boot() is
   idempotent — it tears down any prior engine, re-reads the new page's
   data (from a JSON <script id="kindle-data">), and re-initialises. The
   intro flame plays once per real page load, not on every navigation.
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // Initialise exactly ONCE. Under view transitions this inline script re-executes
  // on every navigation; without this guard each run would spin up a second engine
  // with its own state. We set up one instance and let the persistent
  // astro:page-load listener drive every subsequent page.
  if (window.__kindleGlueLoaded) return;
  window.__kindleGlueLoaded = true;

  // ── Module state (reset every boot) ───────────────────────
  var engine = null;
  var bootedNode = null;        // the #ticker node we last booted (dedupe guard)
  var CORPUS = [];
  var firstPending = null;
  var bag = [];
  var shownLevel = 1;
  var awaitingNext = false;
  var currentSlug = null, currentPoem = null;
  var todayBonusPending = false;   // the date-seeded poem (home) earns 2× XP
  var bootInstant = false;         // on navigation the first poem appears instantly (no fade)
  var pendingTimers = [];

  // DOM refs (re-queried each boot — the nodes change on a page swap)
  var mount, attribEl, hintEl, introEl, flameEl, fillEl, trackEl, levelEl, preludeEl, saveEl, eyebrowEl, multEl, calEl;

  // Listeners we must be able to detach on re-boot
  var continueHandler = null, saveHandler = null, upgradeHandler = null;

  function later(fn, ms) { var t = setTimeout(fn, ms); pendingTimers.push(t); return t; }
  function clearTimers() { for (var i = 0; i < pendingTimers.length; i++) clearTimeout(pendingTimers[i]); pendingTimers = []; }
  function reveal() { if (window.__kindleReveal) window.__kindleReveal(); }   // lift the bg curtain

  // ── Per-page data (robust across navigations) ─────────────
  function readData() {
    var el = document.getElementById("kindle-data");
    if (!el) return null;
    try { return JSON.parse(el.textContent || "{}"); } catch (e) { return null; }
  }

  function dayOfYear(d) {
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);   // Jan 1 = 1 … Dec 31 = 365/366
  }

  // Pick today's poem: a poem PINNED to today's calendar day wins; otherwise a
  // date-seeded hash, so every visitor on the same day gets the same poem.
  function pickTodayIndex(corpus) {
    var d = new Date();
    var doy = dayOfYear(d);
    for (var i = 0; i < corpus.length; i++) {
      if (corpus[i].dayOfYear === doy) return i;   // pinned (e.g. a wintry poem at the solstice)
    }
    var ymd = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
    var h = 2166136261;
    for (var j = 0; j < ymd.length; j++) { h ^= ymd.charCodeAt(j); h = Math.imul(h, 16777619); }
    return Math.abs(h) % corpus.length;
  }

  function nextPassage() {
    if (firstPending != null) {
      var p = CORPUS[firstPending];
      bag = CORPUS.slice();
      bag.splice(firstPending, 1);   // remaining cycle excludes the just-shown poem
      firstPending = null;
      return p;
    }
    if (!bag.length) bag = CORPUS.slice();
    var i = Math.floor(Math.random() * bag.length);
    return bag.splice(i, 1)[0];
  }

  // ── Private completion set (localStorage; /poems reads it) ──
  function recordCompletion(slug) {
    if (!slug) return;
    try {
      var done = JSON.parse(localStorage.getItem("kindling_completed") || "[]");
      if (!Array.isArray(done)) done = [];
      if (done.indexOf(slug) === -1) {
        done.push(slug);
        localStorage.setItem("kindling_completed", JSON.stringify(done));
      }
    } catch (e) { /* private browsing: fail silently */ }
  }

  // ── Shareable PNG export (1200×800, no chrome) ────────────
  function buildExportNode(poem) {
    var W = 1200, H = 800;
    var card = document.createElement("div");
    var s = card.style;
    s.position = "fixed"; s.left = "-10000px"; s.top = "0";
    s.width = W + "px"; s.height = H + "px";
    s.background = "#171717";
    s.display = "flex"; s.flexDirection = "column";
    s.alignItems = "center"; s.justifyContent = "center";
    s.boxSizing = "border-box"; s.padding = "120px"; s.overflow = "hidden";
    s.fontFamily = '"LT Saeada", ui-rounded, "SF Pro Rounded", system-ui, -apple-system, sans-serif';

    var poemWrap = document.createElement("div");
    poemWrap.className = "kexport-poem";
    poemWrap.style.textAlign = "center";
    poemWrap.style.lineHeight = "1.7";
    poemWrap.style.maxWidth = (W - 240) + "px";
    var lines = String(poem.text || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var ln = document.createElement("div");
      ln.textContent = lines[i];
      ln.style.color = "#f5f5f5";
      ln.style.fontWeight = "500";
      ln.style.whiteSpace = "nowrap";
      ln.style.fontSize = "40px";
      poemWrap.appendChild(ln);
    }
    card.appendChild(poemWrap);

    var meta = document.createElement("div");
    meta.style.marginTop = "44px";
    meta.style.color = "#c98a52";
    meta.style.fontSize = "20px";
    meta.style.letterSpacing = "0.04em";
    var t = poem.title || "", a = poem.attribution || "";
    meta.textContent = (t && a) ? (t + " — " + a) : (t || a);
    card.appendChild(meta);

    var wm = document.createElement("div");
    wm.textContent = "kindlingwriting.app";
    wm.style.position = "absolute";
    wm.style.right = "44px"; wm.style.bottom = "36px";
    wm.style.color = "rgba(245, 245, 245, 0.3)";
    wm.style.fontSize = "16px";
    wm.style.letterSpacing = "0.06em";
    card.appendChild(wm);
    return card;
  }

  function fitExport(poemWrap, avail) {
    var base = 40, maxW = 0, kids = poemWrap.children;
    for (var i = 0; i < kids.length; i++) { if (kids[i].scrollWidth > maxW) maxW = kids[i].scrollWidth; }
    if (maxW > avail && maxW > 0) {
      var scaled = Math.max(base * (avail / maxW) * 0.99, 20);
      for (var j = 0; j < kids.length; j++) kids[j].style.fontSize = scaled + "px";
    }
  }

  function savePng() {
    if (!currentPoem) return;
    if (typeof window.domtoimage === "undefined") { console.error("Kindling: export library not loaded"); return; }
    var node = buildExportNode(currentPoem);
    document.body.appendChild(node);
    fitExport(node.querySelector(".kexport-poem"), 1200 - 240);
    function cleanup() { if (node.parentNode) node.parentNode.removeChild(node); }
    // Render at 2× for a crisp, retina-quality export (2400×1600).
    window.domtoimage.toPng(node, {
      width: 2400, height: 1600, bgcolor: "#171717",
      style: { transform: "scale(2)", transformOrigin: "top left", width: "1200px", height: "800px" },
    })
      .then(function (dataUrl) {
        var a = document.createElement("a");
        a.href = dataUrl;
        a.download = "kindling-" + (currentPoem.slug || "poem") + ".png";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        cleanup();
      })
      .catch(function (err) { console.error("Kindling: export failed", err); cleanup(); });
  }

  // ── Lv bar ────────────────────────────────────────────────
  function restart(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  function renderBar(state) {
    if (!fillEl || !levelEl) return;
    var leveledUp = state.banked && state.level > shownLevel;
    if (state.fillPct < (parseFloat(fillEl.style.width) || 0) || leveledUp) {
      fillEl.classList.add("no-ease");
      fillEl.style.width = state.fillPct + "%";
      void fillEl.offsetWidth;
      fillEl.classList.remove("no-ease");
    } else {
      fillEl.style.width = state.fillPct + "%";
    }
    levelEl.textContent = "Lv " + state.level;
    levelEl.title = state.xpIntoLevel + " / " + state.xpForNext + " to Lv " + (state.level + 1);
    if (state.banked) restart(trackEl, "pop");
    if (leveledUp) restart(levelEl, "bloom");
    shownLevel = state.level;
  }

  function showHint(text) {
    if (!hintEl) return;
    hintEl.textContent = text;
    hintEl.classList.remove("gone");
  }

  var MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function todayLabel() {
    var d = new Date();
    return "TODAY'S POEM · " + MON[d.getMonth()] + " " + d.getDate();
  }

  function loadNext() {
    var p = nextPassage();
    // The date-seeded poem (loaded first on home) is "today's poem": 2× XP + signal.
    var isToday = todayBonusPending;
    todayBonusPending = false;
    p.xpMultiplier = isToday ? 2 : 1;

    currentPoem = p;
    currentSlug = p.slug || null;
    if (saveEl) saveEl.classList.remove("show");
    if (attribEl) {
      attribEl.textContent = p.attribution ? "— " + p.attribution : "";
      attribEl.classList.remove("show");   // author stays hidden until the poem is finished
    }
    if (eyebrowEl) {
      if (isToday) { eyebrowEl.textContent = todayLabel(); eyebrowEl.classList.remove("gone"); eyebrowEl.classList.add("show"); }
      else { eyebrowEl.classList.remove("show"); eyebrowEl.textContent = ""; }
    }
    if (multEl) multEl.classList.toggle("show", isToday);   // the 2× bonus marker on the bar
    if (calEl) calEl.classList.toggle("today", isToday);    // calendar lights for today, mutes after
    showHint("just start typing");

    // On a navigation, the first poem appears INSTANTLY (no materialize fade) so
    // there's no fade-from-blank flicker; the fade is reserved for the fresh-load
    // intro and for cycling between poems mid-session.
    var instant = bootInstant;
    bootInstant = false;
    if (instant && mount) mount.classList.add("kinstant");
    engine.load(p);
    if (instant && mount) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { if (mount) mount.classList.remove("kinstant"); });
      });
    }
  }

  // Static, fully-lit render for keyboard-less devices (no engine, no listeners).
  function staticRender(poem) {
    mount.innerHTML = "";
    var lines = String(poem.text || "").split("\n");
    for (var li = 0; li < lines.length; li++) {
      var div = document.createElement("div");
      div.className = "kline revealed";
      var words = lines[li].split(/ +/);
      for (var wi = 0; wi < words.length; wi++) {
        if (!words[wi]) continue;
        var w = document.createElement("span");
        w.className = "kw";
        for (var ci = 0; ci < words[wi].length; ci++) {
          var c = document.createElement("span");
          c.className = "kc lit";
          c.textContent = words[wi][ci];
          w.appendChild(c);
        }
        div.appendChild(w);
        if (wi < words.length - 1) {
          var g = document.createElement("span");
          g.className = "kgap";
          g.textContent = " ";
          div.appendChild(g);
        }
      }
      mount.appendChild(div);
    }
  }

  // ── Teardown (so re-boot after navigation leaves nothing behind) ──
  function teardown() {
    clearTimers();
    if (engine && engine.destroy) { try { engine.destroy(); } catch (e) {} }
    engine = null;
    if (continueHandler) { window.removeEventListener("keydown", continueHandler); continueHandler = null; }
    if (upgradeHandler) { window.removeEventListener("keydown", upgradeHandler); upgradeHandler = null; }
    if (saveHandler && saveEl) { saveEl.removeEventListener("click", saveHandler); saveHandler = null; }
    awaitingNext = false;
  }

  function queryRefs() {
    attribEl = document.getElementById("attrib");
    hintEl = document.getElementById("hint");
    introEl = document.getElementById("intro");
    flameEl = document.getElementById("intro-flame");
    fillEl = document.getElementById("kFill");
    trackEl = document.getElementById("kTrack");
    levelEl = document.getElementById("kLevel");
    preludeEl = document.getElementById("prelude");
    saveEl = document.getElementById("ksave");
    eyebrowEl = document.getElementById("keyebrow");
    multEl = document.getElementById("kMult");
    calEl = document.querySelector(".ktop-cal");
  }

  function startInteractive() {
    engine = window.KindleEngine.create({
      mount: mount,
      storageKey: "kindling_xp_total",
      onWord: renderBar,
      onStart: function () {
        if (hintEl) hintEl.classList.add("gone");
        if (preludeEl) preludeEl.classList.add("gone");
        if (eyebrowEl) eyebrowEl.classList.add("gone");   // the today eyebrow drifts away too
      },
      onPassageDone: function () {
        recordCompletion(currentSlug);
        if (attribEl) attribEl.classList.add("show");   // reveal the author on completion
        showHint("press any key to continue");
        if (saveEl) later(function () { saveEl.classList.add("show"); }, 700);
        later(function () { awaitingNext = true; }, 0);
      },
    });

    continueHandler = function (e) {
      if (!awaitingNext) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key;
      if (k == null || (k.length !== 1 && k !== "Enter")) return;
      e.preventDefault();
      awaitingNext = false;
      later(function () { loadNext(); }, 0);
    };
    window.addEventListener("keydown", continueHandler);

    if (saveEl) { saveHandler = savePng; saveEl.addEventListener("click", saveHandler); }
    window._kindle = engine;

    // Intro flame plays only on a genuine fresh page load — never on a
    // client-side navigation (__kindleNavigated is set on the first swap).
    if (!window.__kindleNavigated) {
      playIntro(function () { loadNext(); reveal(); });   // poem rendered → lift the curtain
    } else {
      if (introEl) introEl.classList.add("done");
      loadNext();
      reveal();
    }
  }

  function playIntro(done) {
    if (!flameEl) { done(); return; }
    var loaded = false;
    function load() { if (loaded) return; loaded = true; done(); }
    function hide() { if (introEl) introEl.classList.add("done"); }
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    flameEl.addEventListener("animationend", function () { hide(); load(); }, { once: true });
    if (!reduce) later(load, 1800);
    later(function () { hide(); load(); }, 3200);
  }

  // ── boot: idempotent, runs on first load + every navigation ──
  function boot() {
    var m = document.getElementById("ticker");
    if (!m) { teardown(); bootedNode = null; return; }   // a non-typing page (e.g. /poems)
    if (m === bootedNode) return;                         // already booted this exact DOM
    // The engine scripts may not have executed yet on the very first swap into a
    // typing page — bail without claiming this node so a later trigger re-boots.
    if (!window.KindleEngine || !window.KindleLeveling) return;
    teardown();
    bootedNode = m;
    mount = m;
    queryRefs();

    var data = readData() || {};
    CORPUS = Array.isArray(data.corpus) ? data.corpus : [];
    if (!CORPUS.length) return;
    bag = [];
    shownLevel = 1;
    currentSlug = null; currentPoem = null;
    todayBonusPending = !!data.dateSeeded;   // the first (date-seeded) poem earns 2×
    bootInstant = true;   // the first poem of any page load appears instantly; the bg
                          // curtain provides the reveal. (Cycled poems still materialize.)

    if (data.dateSeeded) {
      firstPending = pickTodayIndex(CORPUS);
      if (CORPUS[firstPending] && CORPUS[firstPending].title) {
        document.title = "Today's warm-up: " + CORPUS[firstPending].title + " — Kindling";
      }
    } else if (typeof data.firstIndex === "number" && CORPUS[data.firstIndex]) {
      firstPending = data.firstIndex;
    } else {
      firstPending = null;
    }

    // Keyboard-less devices: a still, fully-lit poem + a quiet note. If a real
    // keyboard turns out to be present, the first keypress upgrades to typing.
    var coarse = window.matchMedia &&
      window.matchMedia("(pointer: coarse)").matches &&
      !window.matchMedia("(any-pointer: fine)").matches;
    if (coarse) {
      var p = nextPassage();
      currentPoem = p; currentSlug = p.slug || null;
      if (attribEl) { attribEl.textContent = p.attribution ? "— " + p.attribution : ""; attribEl.classList.add("show"); }
      if (introEl) introEl.classList.add("done");
      staticRender(p);
      showHint("Kindling works best with a keyboard.");
      reveal();   // touch fallback: poem is on screen, lift the curtain
      upgradeHandler = function (e) {
        if (e.key && e.key.length === 1) {
          window.removeEventListener("keydown", upgradeHandler);
          upgradeHandler = null;
          // restart this same poem in interactive mode
          firstPending = CORPUS.indexOf(p);
          startInteractive();
        }
      };
      window.addEventListener("keydown", upgradeHandler);
      return;
    }

    startInteractive();
  }

  // Drive every client-side navigation; also boot the current page now.
  // (Navigation detection — __kindleNavigated + pre-hiding the intro flame — lives
  // in the global BaseLayout script so it's active on browse pages too.)
  // after-swap fires before the new frame paints, so the poem renders in step with
  // the chrome (no blank gap); page-load is the reliable fallback. Both dedupe.
  document.addEventListener("astro:after-swap", boot);
  document.addEventListener("astro:page-load", boot);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
