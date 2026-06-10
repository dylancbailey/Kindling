/* ═══════════════════════════════════════════════════════════
   Kindling — leveling (lifted verbatim from Lannair markdown.js)
   ───────────────────────────────────────────────────────────
   The PORTABLE leveling function, copied byte-for-byte from the
   app's `levelState` (src/markdown.js) so the `Lv X` curve on the
   Kindling page is identical to the one inside Lannair — that
   "continuous with the app" feel is the whole point.

   Pure: a LIFETIME XP total (count of completed words ever, on
   this browser's own per-browser track) → the leveling UI. No DOM,
   no storage, no Tauri. The engine owns the XP store + calls this;
   the host page renders the bar from the returned state.

   Curve is TRIANGULAR: XP to go from level L to L+1 is 10·L, so each
   level costs proportionally more but never walls off. Cumulative XP
   to REACH level L is 5·L·(L−1); inverting gives the closed-form
   level, so this is O(1). Lv 5 ≈ 100 words, Lv 10 ≈ 450, Lv 20 ≈ 1,900.
   ═══════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  var XP_PER_LEVEL_BASE = 10;

  function levelState(totalXp) {
    var xp = totalXp > 0 ? Math.floor(totalXp) : 0;
    // Largest L with 5·L·(L−1) ≤ xp  ⇔  L ≤ (1 + √(1 + 8·xp/10)) / 2.
    var level = Math.floor((1 + Math.sqrt(1 + (8 * xp) / XP_PER_LEVEL_BASE)) / 2);
    var xpToReach = XP_PER_LEVEL_BASE * (level * (level - 1)) / 2; // cumulative XP at the start of `level`
    var xpForNext = XP_PER_LEVEL_BASE * level;                     // cost of the current level
    var xpIntoLevel = xp - xpToReach;
    var raw = (xpIntoLevel / xpForNext) * 100;
    var fillPct = raw < 0 ? 0 : raw > 100 ? 100 : raw;
    return { level: level, xpIntoLevel: xpIntoLevel, xpForNext: xpForNext, fillPct: fillPct };
  }

  var api = { levelState: levelState, XP_PER_LEVEL_BASE: XP_PER_LEVEL_BASE };

  // No-bundler / classic-<script> global, matching Lannair's runtime.
  root.KindleLeveling = api;
  // Also export for a node parity check (test harness), harmless in the browser.
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
