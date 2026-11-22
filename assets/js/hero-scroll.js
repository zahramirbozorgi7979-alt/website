/* ============================================================
   Everlight Homes — scroll-scrubbed hero video
   ------------------------------------------------------------
   The clip plays once, muted, as a short cinematic intro (the
   exterior shot), then pauses for good. From that frame on, scroll
   progress through the pinned hero track is mapped to
   video.currentTime, so the user drives the camera by scrolling,
   in both directions. The video never loops, and once the intro is
   over it never plays again on its own.

   How the smoothness is achieved
   - The scroll listener only records the target progress. All
     video work happens inside requestAnimationFrame.
   - currentTime eases toward the scroll target (exponential
     smoothing), so a fast flick never produces a hard jump while
     a slow drag still feels attached to the finger.
   - A new seek is issued only after the previous one finished
     (`seeked`). Writing currentTime on every frame while a seek
     is still in flight is the classic cause of stuttering
     scrubbing, especially in Safari. A safety timer releases the
     gate if a `seeked` never arrives.
   - The loop stops as soon as the video settles, so an idle page
     costs nothing; it restarts on the next scroll event.
   - Geometry is measured on resize only, so no layout is read
     inside the animation frame.
   - The hero copy fades through a CSS custom property, so the
     text motion costs one style write per frame, no reflow.

   Encoding (assets/video/)
   - H.264 / MP4, yuv420p, +faststart (moov atom at the front) so
     decoding can begin before the file is fully downloaded.
   - One keyframe every 6 frames (~0.25 s at 24 fps). Seeking is
     random access: with a long GOP every seek has to decode from
     the previous keyframe, which is the single biggest cause of
     jerky scroll videos. The supplied source had ONE keyframe
     for its whole 9 s, so it was re-encoded with -g 6.
   - Audio stripped, moderate bitrate, 1168x768 desktop and a
     720 px-wide mobile variant, so each seek is cheap.
   - MP4/H.264 is served alone on purpose: it is the format with
     the fastest random-access seek in every current browser. A
     WebM/VP9 alternative seeks slower and would hurt scrubbing,
     so it is intentionally not shipped.
   ============================================================ */

(function () {
  "use strict";

  var section = document.querySelector(".hero-scroll");
  if (!section) return;

  var stage = section.querySelector(".hero-stage");
  var video = section.querySelector(".hero-video");
  if (!stage || !video) return;

  var SMOOTHING = 0.26;      // how quickly currentTime catches the target
  var SNAP = 0.024;          // seconds — closer than this we land exactly
  var MIN_SEEK_STEP = 0.012; // seconds — ignore sub-frame differences
  var SEEK_TIMEOUT = 320;    // ms — release a seek gate that never resolved
  var READY_TIMEOUT = 8000;  // ms — begin scrubbing even on a slow network
  var INTRO_MAX = 3;         // seconds of the clip that play on their own
  var INTRO_RATIO = 0.35;    // …and never more than a third of the clip

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var started = false;
  var staticMode = false;
  var failed = false;
  var ready = false;
  var introActive = false;
  var introTimer = 0;
  var introStartY = 0;
  var scrubOffset = 0;       // frame the scroll experience starts from
  var duration = 0;
  var progress = 0;
  var targetTime = 0;
  var currentTime = 0;
  var lastSeeked = -1;
  var seekPending = false;
  var seekStartedAt = 0;
  var rafId = 0;
  var sectionTop = 0;
  var scrollDistance = 1;
  var lastProgress = -1;
  var isPast = false;
  var readyTimer = 0;

  function now() {
    return window.performance && window.performance.now
      ? window.performance.now()
      : Date.now();
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function scrollY() {
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  // ---- geometry -----------------------------------------------------------

  function measure() {
    sectionTop = section.getBoundingClientRect().top + scrollY();
    scrollDistance = Math.max(1, section.offsetHeight - stage.offsetHeight);
  }

  function readProgress() {
    return clamp((scrollY() - sectionTop) / scrollDistance, 0, 1);
  }

  // ---- text fade ----------------------------------------------------------

  function applyProgress(value) {
    if (Math.abs(value - lastProgress) < 0.0015) return;
    lastProgress = value;
    stage.style.setProperty("--hero-progress", value.toFixed(4));

    var past = value > 0.34;
    if (past !== isPast) {
      isPast = past;
      stage.classList.toggle("is-past", past);
    }
  }

  // ---- animation loop -----------------------------------------------------

  function tick() {
    rafId = 0;
    applyProgress(progress);

    if (ready) {
      var diff = targetTime - currentTime;

      if (Math.abs(diff) < SNAP) {
        currentTime = targetTime;
      } else {
        currentTime += diff * SMOOTHING;
      }

      if (seekPending && now() - seekStartedAt > SEEK_TIMEOUT) {
        seekPending = false; // never let a lost `seeked` freeze the scene
      }

      if (!seekPending && Math.abs(currentTime - lastSeeked) >= MIN_SEEK_STEP) {
        lastSeeked = currentTime;
        seekPending = true;
        seekStartedAt = now();
        try {
          video.currentTime = currentTime;
        } catch (error) {
          seekPending = false;
        }
      }

      if (Math.abs(targetTime - currentTime) > 0.004 || seekPending) {
        rafId = window.requestAnimationFrame(tick);
      }
    }
  }

  function requestTick() {
    if (!rafId) rafId = window.requestAnimationFrame(tick);
  }

  // `userScroll` is only true for a real scroll event: the bookkeeping calls
  // (load, resize, orientation) must not interrupt the intro.
  function onScroll(userScroll) {
    if (staticMode) return;
    progress = readProgress();
    if (introActive && userScroll && Math.abs(scrollY() - introStartY) > 2) {
      stopIntro();
    }
    if (ready) targetTime = scrubOffset + progress * (duration - scrubOffset);
    requestTick();
  }

  // ---- video readiness ----------------------------------------------------

  function markReady() {
    if (ready || failed || staticMode) return;

    if (!duration) duration = video.duration || 0;
    if (!duration || !isFinite(duration)) return;

    ready = true;
    window.clearTimeout(readyTimer);

    // Start from the frame that belongs to the current scroll position.
    progress = readProgress();
    targetTime = progress * duration;
    currentTime = targetTime;
    lastSeeked = targetTime;
    try {
      video.currentTime = targetTime;
    } catch (error) { /* the next tick retries */ }

    section.classList.add("is-video-ready");
    requestTick();
    startIntro();
  }

  // ---- one-time intro -----------------------------------------------------
  // The clip opens on the exterior. It plays once, muted, so the scene is
  // alive from the first moment, then it pauses and the scroll takes over
  // from exactly that frame — no rewind, no looping.
  function startIntro() {
    if (introActive || staticMode || failed || !ready) return;
    if (progress > 0.02) return; // the visitor already scrolled: stay scroll-driven

    introActive = true;
    introStartY = scrollY();
    scrubOffset = 0;
    currentTime = 0;
    lastSeeked = 0;
    targetTime = 0;
    section.classList.add("is-intro");

    var played = video.play();
    if (played && played.catch) {
      played.catch(function () {
        stopIntro(); // autoplay blocked: fall back to the paused first frame
      });
    }

    introTimer = window.setTimeout(
      stopIntro,
      Math.min(INTRO_MAX, duration * INTRO_RATIO) * 1000
    );
  }

  function stopIntro() {
    if (!introActive) return;
    introActive = false;
    window.clearTimeout(introTimer);
    section.classList.remove("is-intro");

    try {
      video.pause();
    } catch (error) { /* ignore */ }

    scrubOffset = Math.min(video.currentTime || 0, duration);
    currentTime = scrubOffset;
    lastSeeked = scrubOffset;
    targetTime = scrubOffset + progress * (duration - scrubOffset);
    requestTick();
  }

  function fail() {
    if (failed || ready) return;
    failed = true;
    window.clearTimeout(readyTimer);
    section.classList.add("is-video-failed");
  }

  function start() {
    if (started) return;
    started = true;

    var mobile = window.matchMedia("(max-width: 760px)").matches;
    var source = mobile
      ? video.getAttribute("data-src-mobile")
      : video.getAttribute("data-src-desktop");

    if (!source) {
      fail();
      return;
    }

    video.autoplay = false;
    video.loop = false;
    video.muted = true;
    video.preload = "auto";
    video.src = source;
    video.load();

    readyTimer = window.setTimeout(function () {
      if (ready || failed) return;
      if (duration) markReady();
      else fail();
    }, READY_TIMEOUT);
  }

  // ---- events -------------------------------------------------------------

  video.addEventListener("loadedmetadata", function () {
    duration = video.duration || 0;
  });

  video.addEventListener("canplay", markReady);
  video.addEventListener("canplaythrough", markReady);

  video.addEventListener("seeked", function () {
    seekPending = false;
  });

  video.addEventListener("error", fail);

  // Safari buffers lazily until a user gesture: nudging the decoder on the
  // first interaction gets the frames flowing without ever playing the video.
  function prime() {
    if (failed || staticMode || !started) return;
    if (video.readyState < 2) {
      try {
        video.load();
      } catch (error) { /* ignore */ }
    }
    window.removeEventListener("pointerdown", prime);
    window.removeEventListener("touchstart", prime);
    window.removeEventListener("wheel", prime);
  }
  window.addEventListener("pointerdown", prime, { passive: true });
  window.addEventListener("touchstart", prime, { passive: true });
  window.addEventListener("wheel", prime, { passive: true });

  function enableStatic() {
    stopIntro();
    staticMode = true;
    section.classList.add("is-static");
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function onMotionPreferenceChange() {
    if (reduceMotion.matches) {
      enableStatic();
      return;
    }
    staticMode = false;
    section.classList.remove("is-static");
    if (!started) start();
    measure();
    onScroll();
  }

  // ---- boot ---------------------------------------------------------------

  if (reduceMotion.matches) {
    enableStatic();
  } else {
    start();
  }

  measure();
  window.addEventListener("scroll", function () {
    onScroll(true);
  }, { passive: true });
  window.addEventListener("resize", function () {
    measure();
    onScroll();
  }, { passive: true });
  window.addEventListener("load", function () {
    measure();
    onScroll();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      measure();
      onScroll();
    });
  }

  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener("change", onMotionPreferenceChange);
  } else if (reduceMotion.addListener) {
    reduceMotion.addListener(onMotionPreferenceChange);
  }

  onScroll();
})();
