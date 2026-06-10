/* ═══════════════════════════════════════════════════════════
   Kindling — the engine (isolated module)
   ───────────────────────────────────────────────────────────
   BOUNDARY (the inputs/outputs contract — do not breach):
     touches ONLY  · the mount DOM element it's given
                   · localStorage (its OWN per-browser XP key)
                   · KindleLeveling.levelState (the lifted pure fn)
     NEVER         · Tauri invoke · app save/load · app state · sound

   Public API:
     const engine = KindleEngine.create({
       mount,                         // HTMLElement — the poem surface
       storageKey: "kindling_xp_total",
       onWord(state),                 // {xpTotal, level, …, banked} — host renders bar
       onPassageDone(),               // host fades in the next passage
       onStart(),                     // first keystroke of a passage (host hides hint)
     });
     engine.load({ text, attribution });
     engine.destroy();

   THE REVEAL (Dylan, post-ticker pivot): the poem is laid out in its REAL
   lines, like poetry. Lines you haven't reached are hidden; each line
   MATERIALIZES (fades up) the moment you reach it, and stays lit once typed —
   so when you finish, the whole illuminated poem sits in front of you. The
   text never moves under your fingers (the old "stationary word" win is now
   free: nothing scrolls).

   INPUT (Dylan's call, overriding the original "forgive punctuation"):
   you type exactly what you see — Shift for capitals, real periods / commas /
   colons / semicolons / apostrophes / ! ? / quotes, and a SPACE between words
   on a line. Only un-typeable glyphs are normalized (em-dash → "-", curly
   quotes → straight, …). A line break needs NO key — finishing a line's last
   word lights the next line automatically. A WRONG key never fails or scores;
   it just gives the expected letter a small ember shake, then settles back.
   ═══════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  // Normalize ONLY the un-typeable glyphs so "what you see is what you type".
  function normalize(s) {
    return String(s)
      .replace(/\r\n?/g, "\n")
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[–—―]/g, "-")
      .replace(/…/g, "...")
      .replace(/ /g, " ");
  }

  // Tokenize a (normalized) passage into words, tagged with their line index and
  // whether they end a line. Each word's glyphs are all required literally.
  function tokenize(text) {
    var words = [];
    var lines = normalize(text).split("\n");
    for (var li = 0; li < lines.length; li++) {
      var parts = lines[li].split(/[ \t]+/).filter(function (s) { return s.length; });
      for (var pi = 0; pi < parts.length; pi++) {
        words.push({
          display: parts[pi],
          lineIndex: li,
          endsLine: (pi === parts.length - 1) && (li < lines.length - 1),
        });
      }
    }
    return words;
  }

  function create(opts) {
    opts = opts || {};
    var mount = opts.mount;
    if (!mount) throw new Error("KindleEngine: mount element required");
    var storageKey = opts.storageKey || "kindling_xp_total";
    var onWord = typeof opts.onWord === "function" ? opts.onWord : function () {};
    var onPassageDone = typeof opts.onPassageDone === "function" ? opts.onPassageDone : function () {};
    var onStart = typeof opts.onStart === "function" ? opts.onStart : function () {};
    var keyTarget = opts.keyTarget || window;

    var leveling = root.KindleLeveling;

    // ── XP store (engine owns it; localStorage only) ─────────
    function readXp() {
      try {
        var raw = localStorage.getItem(storageKey);
        var n = raw == null ? 0 : parseInt(raw, 10);
        return isFinite(n) && n > 0 ? n : 0;
      } catch (e) { return 0; }
    }
    function writeXp(n) {
      try { localStorage.setItem(storageKey, String(n)); } catch (e) { /* best-effort */ }
    }

    // ── State ────────────────────────────────────────────────
    var words = [];          // tokenized passage
    var lineEls = [];         // .kline divs (one per poem line)
    var cur = 0;              // current word index
    var pos = 0;              // glyph index typed in the current word
    var awaitingSpace = false; // word done; the inter-word SPACE is pending (mid-line only)
    var started = false;       // has the first keystroke landed this passage
    var caret = null;          // ember caret element
    var xpMult = 1;            // XP per word for this passage (×2 on today's poem)

    function buildWord(w) {
      var el = document.createElement("span");
      el.className = "kw";
      var charEls = [];
      for (var i = 0; i < w.display.length; i++) {
        var c = document.createElement("span");
        c.className = "kc";
        c.textContent = w.display[i];
        el.appendChild(c);
        charEls.push(c);
      }
      w._charEls = charEls;
      return el;
    }

    // Lay the poem out as lines. Every line exists from the start (so the block
    // is full-sized and stably centered — no reflow), but lines you haven't
    // reached are hidden and fade up when revealed.
    function render() {
      mount.innerHTML = "";
      lineEls = [];
      caret = document.createElement("span");
      caret.className = "kcaret";

      var byLine = {};
      for (var i = 0; i < words.length; i++) {
        (byLine[words[i].lineIndex] || (byLine[words[i].lineIndex] = [])).push(i);
      }
      var lineKeys = Object.keys(byLine).map(Number).sort(function (a, b) { return a - b; });
      for (var li = 0; li < lineKeys.length; li++) {
        var lineDiv = document.createElement("div");
        lineDiv.className = "kline";
        var idxs = byLine[lineKeys[li]];
        for (var j = 0; j < idxs.length; j++) {
          var wi = idxs[j];
          words[wi]._lineEl = lineDiv;
          lineDiv.appendChild(buildWord(words[wi]));
          if (j < idxs.length - 1) {
            var sp = document.createElement("span");
            sp.className = "kgap";
            sp.textContent = " ";
            words[wi]._gapEl = sp;
            lineDiv.appendChild(sp);
          }
        }
        mount.appendChild(lineDiv);
        lineEls.push(lineDiv);
      }
    }

    function revealLine(idx) {
      if (lineEls[idx]) lineEls[idx].classList.add("revealed");
    }

    // Auto-fit: poem lines never wrap (white-space:nowrap), so scale the base
    // font down just enough that the widest line fits the surface. Keeps short
    // poems big and calm while long-lined ones (Keats, Teasdale) still fit.
    function fitFont() {
      mount.style.fontSize = "";
      var base = parseFloat(window.getComputedStyle(mount).fontSize) || 34;
      var avail = mount.clientWidth;
      var maxW = 0;
      for (var i = 0; i < lineEls.length; i++) {
        if (lineEls[i].scrollWidth > maxW) maxW = lineEls[i].scrollWidth;
      }
      if (maxW > avail && maxW > 0) {
        var scaled = Math.max(base * (avail / maxW) * 0.98, base * 0.5);
        mount.style.fontSize = scaled + "px";
      }
    }

    // Light the current word's first `pos` glyphs; park the caret.
    function paintCurrentWord() {
      var w = words[cur];
      if (!w) return;
      var charEls = w._charEls;
      for (var i = 0; i < charEls.length; i++) {
        charEls[i].classList.toggle("lit", i <= pos - 1);
      }
      if (awaitingSpace || pos >= charEls.length) {
        charEls[charEls.length - 1].insertAdjacentElement("afterend", caret);
      } else {
        charEls[pos].insertAdjacentElement("beforebegin", caret);
      }
    }

    // Wrong key: a small ember shake on the glyph the user was expected to type
    // (or on the caret, when a space was expected). No fail, no score — a nudge.
    function flashMiss() {
      var el;
      if (awaitingSpace) el = caret;
      else el = words[cur] && words[cur]._charEls[pos];
      if (!el) el = caret;
      el.classList.remove("miss");
      void el.offsetWidth;           // restart the animation if it's mid-flight
      el.classList.add("miss");
      setTimeout(function () { el.classList.remove("miss"); }, 260);
    }

    function bankWord() {
      var xp = readXp() + xpMult;     // XP per completed word (×2 on today's poem)
      writeXp(xp);
      var st = leveling.levelState(xp);
      onWord({
        xpTotal: xp, level: st.level, xpIntoLevel: st.xpIntoLevel,
        xpForNext: st.xpForNext, fillPct: st.fillPct, banked: true,
      });
    }

    // Move to the next word (no scrolling — just shift focus + caret). Reveals a
    // new line the instant we step onto it.
    function advanceWord() {
      cur += 1;
      pos = 0;
      awaitingSpace = false;
      if (cur >= words.length) { onPassageDone(); return; }
      if (words[cur].lineIndex !== words[cur - 1].lineIndex) revealLine(words[cur].lineIndex);
      paintCurrentWord();
    }

    function onKeyDown(e) {
      if (!words.length || cur >= words.length) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;   // Shift is allowed (caps are required)
      var k = e.key;
      if (k == null || k.length !== 1) return;            // arrows, Enter, Backspace, Tab… ignored

      if (!started) { started = true; onStart(); }

      // Between two words ON THE SAME LINE, the one required key is SPACE.
      if (awaitingSpace) {
        if (k === " ") {
          e.preventDefault();
          if (words[cur]._gapEl) words[cur]._gapEl.classList.add("lit");
          advanceWord();
        } else {
          if (k === " ") e.preventDefault();
          flashMiss();                                   // wrong key → ember nudge on the caret
        }
        return;
      }

      // Within a word: match the next glyph LITERALLY and case-sensitively.
      var need = words[cur].display[pos];
      if (need == null) return;
      if (k === need) {
        e.preventDefault();
        pos += 1;
        if (pos >= words[cur].display.length) {
          paintCurrentWord();   // fully light the completed word
          bankWord();           // 1 XP per word
          if (cur >= words.length - 1) {
            advanceWord();       // last word — finish the passage
          } else if (words[cur].endsLine) {
            advanceWord();       // line break needs no key — light the next line
          } else {
            awaitingSpace = true; // mid-line: wait for the SPACE press
            paintCurrentWord();
          }
        } else {
          paintCurrentWord();   // caret steps forward; nothing moves
        }
      } else {
        if (k === " ") e.preventDefault();
        flashMiss();            // wrong key → ember shake on the expected letter
      }
    }

    // ── Public ───────────────────────────────────────────────
    function load(passage) {
      passage = passage || {};
      words = tokenize(passage.text || "");
      xpMult = (passage.xpMultiplier > 0) ? passage.xpMultiplier : 1;
      cur = 0; pos = 0; awaitingSpace = false; started = false;
      render();
      fitFont();               // scale to fit before anything is shown
      revealLine(0);            // the first line is there from the off
      paintCurrentWord();
      var st = leveling.levelState(readXp());
      onWord({
        xpTotal: readXp(), level: st.level, xpIntoLevel: st.xpIntoLevel,
        xpForNext: st.xpForNext, fillPct: st.fillPct, banked: false,
      });
    }

    var _onResize = function () { if (lineEls.length) fitFont(); };
    keyTarget.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", _onResize);

    function destroy() {
      keyTarget.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", _onResize);
      mount.innerHTML = "";
      words = []; lineEls = [];
    }

    return { load: load, destroy: destroy };
  }

  root.KindleEngine = { create: create, tokenize: tokenize };
})(typeof window !== "undefined" ? window : this);
