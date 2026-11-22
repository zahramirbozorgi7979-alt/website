/* ============================================================
   Everlight Homes — scroll-scrubbed hero video
   ------------------------------------------------------------
   The hero video is NEVER played. Scroll progress through the
   pinned hero track is mapped to video.currentTime, so the user
   drives the camera by scrolling, in both directions.

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

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var started = false;
  var staticMode = false;
  var failed = false;
  var ready = false;
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

  function onScroll() {
    if (staticMode) return;
    progress = readProgress();
    if (ready) targetTime = progress * duration;
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

  // The scene must never run on its own.
  video.addEventListener("play", function () {
    video.pause();
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
  window.addEventListener("scroll", onScroll, { passive: true });
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
