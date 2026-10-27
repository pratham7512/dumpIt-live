/* =========================================================
   dumpit — interactions
   ========================================================= */
(() => {
  'use strict';

  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  /* ---------- shared sound ---------- */
  const Sound = (() => {
    const files = {
      send: 'audio/message-sent.m4a',
      receive: 'audio/whatsapp-receive.m4a',
      click: 'audio/ui-click.m4a',
    };
    const players = new Map();
    const clickPool = [];
    let clickIndex = 0;
    let enabled = true;

    function player(kind) {
      if (!files[kind]) return null;
      let audio = players.get(kind);
      if (!audio) {
        audio = new Audio(files[kind]);
        audio.preload = 'auto';
        audio.playsInline = true;
        players.set(kind, audio);
      }
      return audio;
    }

    player('send');
    player('receive');

    for (let i = 0; i < 4; i += 1) {
      const audio = new Audio(files.click);
      audio.preload = 'auto';
      audio.playsInline = true;
      audio.volume = .8;
      clickPool.push(audio);
    }

    // Browsers keep audio locked until the first gesture. Prime the pool
    // silently so scroll-driven clicks are allowed once the visitor moves.
    let primed = false;

    function primeAudio() {
      if (primed) return;
      primed = true;
      [...players.values(), ...clickPool].forEach((audio) => {
        if (!audio.paused) return;
        const wasMuted = audio.muted;
        audio.muted = true;
        let played;
        try {
          played = audio.play();
        } catch (err) {
          audio.muted = wasMuted;
          primed = false;
          return;
        }
        if (!played || !played.then) {
          audio.muted = wasMuted;
          return;
        }
        played.then(() => {
          audio.pause();
          try { audio.currentTime = 0; } catch (err) { /* noop */ }
          audio.muted = wasMuted;
        }).catch((err) => {
          audio.muted = wasMuted;
          if (err?.name === 'NotAllowedError') primed = false;
        });
      });
    }

    function onFirstGesture(event) {
      if (primed) return;
      const target = event?.target instanceof Element ? event.target : document.activeElement;
      if (target?.closest?.('button, a, input, select, textarea, label, [role="button"], [data-note]')) return;
      primeAudio();
    }

    document.addEventListener('pointerdown', onFirstGesture, { capture: true, passive: true });
    document.addEventListener('touchstart', onFirstGesture, { capture: true, passive: true });
    document.addEventListener('keydown', onFirstGesture, true);

    function wa(kind) {
      if (!enabled) return;
      const track = kind === 'receive-soft' ? 'receive' : kind;
      if (!files[track]) return;
      const audio = player(track);
      if (!audio) return;
      audio.pause();
      audio.muted = false;
      audio.volume = kind === 'receive-soft' ? .38 : (kind === 'send' ? .72 : .9);
      try { audio.currentTime = 0; } catch (err) { /* not loaded yet */ }
      const played = audio.play();
      if (played && played.catch) played.catch(() => {});
    }

    function click() {
      if (!enabled || !clickPool.length) return;
      const audio = clickPool[clickIndex % clickPool.length];
      clickIndex += 1;
      audio.muted = false;
      try { audio.currentTime = 0; } catch (err) { /* not loaded yet */ }
      const played = audio.play();
      if (played && played.catch) played.catch(() => {});
    }

    return {
      wa,
      click,
      get enabled() { return enabled; },
      setEnabled(next) {
        enabled = Boolean(next);
        if (!enabled) {
          players.forEach((audio) => {
            audio.pause();
            try { audio.currentTime = 0; } catch (err) { /* noop */ }
          });
          clickPool.forEach((audio) => {
            audio.pause();
            try { audio.currentTime = 0; } catch (err) { /* noop */ }
          });
        } else {
          primeAudio();
        }
      },
    };
  })();

  /* ---------- sound toggle ---------- */
  const soundToggles = $$('[data-sound-toggle]');
  function paintSoundToggle() {
    const on = Sound.enabled;
    soundToggles.forEach((button) => {
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', on ? 'Mute sound effects' : 'Turn sound effects on');
      const text = $('.sound-toggle-text', button);
      if (text) text.textContent = on ? 'Sound on' : 'Sound off';
    });
  }
  soundToggles.forEach((button) => {
    button.addEventListener('click', () => {
      Sound.setEnabled(!Sound.enabled);
      paintSoundToggle();
    });
  });
  paintSoundToggle();

  /* ---------- mobile menu ---------- */
  const menuToggle = $('.menu-toggle');
  const mobileMenu = $('#mobile-menu');

  function closeMenu() {
    document.body.classList.remove('menu-open');
    mobileMenu?.classList.remove('is-open');
    mobileMenu?.setAttribute('aria-hidden', 'true');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Open menu');
  }

  menuToggle?.addEventListener('click', () => {
    const open = !mobileMenu?.classList.contains('is-open');
    document.body.classList.toggle('menu-open', open);
    mobileMenu?.classList.toggle('is-open', open);
    mobileMenu?.setAttribute('aria-hidden', String(!open));
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  $$('#mobile-menu a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  /* ---------- reveal on scroll ---------- */
  const revealEls = $$('[data-reveal]');
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-in'));
  }

  /* ---------- waveforms ---------- */
  function buildWave(el) {
    if (!el || el.dataset.built) return;
    el.dataset.built = 'true';
    const count = Number(el.dataset.bars) || 30;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i += 1) {
      const bar = document.createElement('span');
      const wave = Math.sin(i * 0.7) * 0.26 + Math.sin(i * 0.23 + 1.4) * 0.24 + 0.52;
      const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const height = clamp(wave + Math.abs(jitter) * 0.18, 0.18, 0.98);
      bar.style.setProperty('--h', `${Math.round(height * 100)}%`);
      frag.appendChild(bar);
    }
    el.appendChild(frag);
  }
  $$('[data-wave]').forEach(buildWave);

  const activePlaybacks = new WeakMap();

  function toggleAudio(container) {
    if (!container) return;
    const existing = activePlaybacks.get(container);
    if (existing) {
      cancelAnimationFrame(existing.raf);
      if (existing.clearTimer) clearTimeout(existing.clearTimer);
      container.classList.remove('is-playing');
      container.setAttribute('aria-pressed', 'false');
      activePlaybacks.delete(container);
      $$('.wave span', container).forEach((bar) => bar.classList.remove('is-played'));
      const label = container.querySelector('.wa-wave-time, .audio-time');
      if (label && container.dataset.originalTime) label.textContent = container.dataset.originalTime;
      return;
    }

    const wave = $('[data-wave]', container);
    if (!wave) return;
    const durationSec = Number(container.dataset.duration) || 9;
    const bars = $$('.wave span', container);
    const label = container.querySelector('.wa-wave-time, .audio-time');
    if (label) container.dataset.originalTime = container.dataset.originalTime || label.textContent;
    container.classList.add('is-playing');
    container.setAttribute('aria-pressed', 'true');
    bars.forEach((bar) => bar.classList.remove('is-played'));

    const start = performance.now();
    const durationMs = reducedMotion.matches ? Math.min(durationSec * 1000, 1500) : durationSec * 1000;

    function step(now) {
      const progress = clamp((now - start) / durationMs, 0, 1);
      const activeBars = Math.floor(progress * bars.length);
      bars.forEach((bar, index) => bar.classList.toggle('is-played', index < activeBars));
      if (label) {
        const current = Math.round(progress * durationSec);
        label.textContent = `0:${String(current).padStart(2, '0')}`;
      }
      if (progress < 1) {
        const raf = requestAnimationFrame(step);
        const obj = activePlaybacks.get(container);
        if (obj) obj.raf = raf;
      } else {
        const clearTimer = setTimeout(() => {
          container.classList.remove('is-playing');
          container.setAttribute('aria-pressed', 'false');
          bars.forEach((bar) => bar.classList.remove('is-played'));
          if (label) label.textContent = container.dataset.originalTime;
          activePlaybacks.delete(container);
        }, 700);
        const obj = activePlaybacks.get(container);
        if (obj) { obj.raf = 0; obj.clearTimer = clearTimer; }
      }
    }
    const raf = requestAnimationFrame(step);
    activePlaybacks.set(container, { raf, clearTimer: 0 });
  }

  document.addEventListener('click', (e) => {
    const audio = e.target.closest('[data-audio]');
    if (audio) toggleAudio(audio);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const audio = e.target.closest?.('[data-audio]');
    if (audio) {
      e.preventDefault();
      toggleAudio(audio);
    }
  });

  /* ---------- whatsapp sequence ---------- */
  const chat = $('[data-chat]');
  const phoneScreen = chat?.closest('.phone-screen');
  const recTimeEl = $('[data-rec-time]', phoneScreen || document);
  const howSteps = $$('[data-how-step]');
  const chatMsgs = chat ? $$('.msg', chat) : [];
  const chatTimers = [];
  let chatRecordTimer = 0;
  let chatRun = 0;
  let chatInView = false;

  function clearChatTimers() {
    chatTimers.forEach(clearTimeout);
    chatTimers.length = 0;
    clearInterval(chatRecordTimer);
    chatRecordTimer = 0;
  }

  function setStep(index) {
    howSteps.forEach((step, i) => {
      step.classList.toggle('is-live', i === index);
      step.classList.toggle('is-done', i < index);
    });
  }

  function setRecording(on) {
    phoneScreen?.classList.toggle('is-recording', on);
    if (!on) {
      clearInterval(chatRecordTimer);
      chatRecordTimer = 0;
    }
  }

  function scrollChatToBottom(smooth) {
    if (!chat) return;
    const top = chat.scrollHeight;
    if (smooth && chat.scrollTo) {
      chat.scrollTo({ top, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    } else {
      chat.scrollTop = top;
    }
  }

  function showChatMsg(name) {
    const msg = chat?.querySelector(`[data-msg="${name}"]`);
    if (!msg) return;
    msg.classList.add('is-shown');
    chat?.classList.add('has-msgs');
    requestAnimationFrame(() => scrollChatToBottom(true));
  }

  function hideChatMsg(name) {
    chat?.querySelector(`[data-msg="${name}"]`)?.classList.remove('is-shown');
    requestAnimationFrame(() => scrollChatToBottom(true));
  }

  function stopChatCycle() {
    chatRun += 1;
    clearChatTimers();
    setRecording(false);
    howSteps.forEach((step) => step.classList.remove('is-live', 'is-done'));
  }

  function startRecording() {
    setStep(0);
    setRecording(true);
    let seconds = 0;
    if (recTimeEl) recTimeEl.textContent = '0:00';
    chatRecordTimer = setInterval(() => {
      seconds += 1;
      if (recTimeEl) recTimeEl.textContent = `0:0${Math.min(seconds, 9)}`;
    }, 1000);
  }

  function startChatCycle() {
    if (!chat || reducedMotion.matches || !chatInView || document.hidden) return;
    stopChatCycle();
    const run = chatRun;
    chat.classList.add('will-animate');
    chat.classList.remove('has-msgs');
    chatMsgs.forEach((msg) => msg.classList.remove('is-shown'));
    howSteps.forEach((step) => step.classList.remove('is-live', 'is-done'));
    scrollChatToBottom(false);
    if (recTimeEl) recTimeEl.textContent = '0:00';

    const at = (delay, action) => {
      const timer = setTimeout(() => {
        if (run === chatRun) action();
      }, delay);
      chatTimers.push(timer);
    };

    at(420, startRecording);
    at(4420, () => {
      if (recTimeEl) recTimeEl.textContent = '0:04';
      setRecording(false);
      Sound.wa('send');
      showChatMsg('voice');
    });
    at(4830, () => {
      setStep(1);
      showChatMsg('typing');
    });
    at(6400, () => {
      hideChatMsg('typing');
      showChatMsg('filed');
      Sound.wa('receive');
    });
    at(9800, () => {
      setStep(2);
      showChatMsg('ask');
      Sound.wa('send');
    });
    at(10600, () => {
      showChatMsg('found');
      Sound.wa('receive');
    });
    at(11450, () => {
      showChatMsg('reminder');
      Sound.wa('receive-soft');
    });
    at(17200, startChatCycle);
  }

  function showStaticChat() {
    stopChatCycle();
    chat?.classList.remove('will-animate');
    chat?.classList.add('has-msgs');
    chatMsgs.forEach((msg) => msg.classList.add('is-shown'));
    setRecording(false);
    howSteps.forEach((step) => {
      step.classList.remove('is-live');
      step.classList.add('is-done');
    });
    if (recTimeEl) recTimeEl.textContent = '0:00';
    scrollChatToBottom(false);
  }

  if (chat) {
    // Start as a finished illustration. The live demonstration takes over as
    // soon as the phone is actually on screen.
    showStaticChat();

    const how = $('.how');
    const chatTarget = $('.phone-plate') || how;

    function enterChat() {
      chatInView = true;
      if (reducedMotion.matches) showStaticChat();
      else startChatCycle();
    }

    function leaveChat() {
      chatInView = false;
      stopChatCycle();
    }

    if ('IntersectionObserver' in window) {
      if (chatTarget) {
        const chatObserver = new IntersectionObserver((entries) => {
          if (entries[0]?.isIntersecting) enterChat();
          else leaveChat();
        }, { threshold: 0.25, rootMargin: '0px 0px -8% 0px' });
        chatObserver.observe(chatTarget);
      }
    } else {
      enterChat();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopChatCycle();
      else if (chatInView) enterChat();
    });

    const onReducedMotion = () => {
      if (reducedMotion.matches) showStaticChat();
      else if (chatInView) startChatCycle();
    };
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onReducedMotion);
    else reducedMotion.addListener?.(onReducedMotion);
  }

  /* ---------- simple checkboxes ---------- */
  document.addEventListener('click', (e) => {
    const check = e.target.closest('[data-toggle-check]');
    if (!check) return;
    if (check.closest('[data-feature-deck]')) Sound.click();
    const pressed = check.getAttribute('aria-pressed') === 'true';
    check.setAttribute('aria-pressed', String(!pressed));
  });

  /* ---------- typewriter ---------- */
  const typedEl = $('[data-typewriter]');
  if (typedEl) {
    const phrases = ['that podcast idea about pricing', 'my lecture on loss aversion', 'the list with oat milk'];
    let phraseIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let started = false;
    let typeTimer;

    function type() {
      const phrase = phrases[phraseIndex];
      if (!deleting) {
        charIndex += 1;
        typedEl.textContent = phrase.slice(0, charIndex);
        if (charIndex === phrase.length) {
          deleting = true;
          typeTimer = setTimeout(type, 2100);
          return;
        }
        typeTimer = setTimeout(type, 38 + Math.random() * 35);
      } else {
        charIndex -= 1;
        typedEl.textContent = phrase.slice(0, charIndex);
        if (charIndex === 0) {
          deleting = false;
          phraseIndex = (phraseIndex + 1) % phrases.length;
          typeTimer = setTimeout(type, 450);
          return;
        }
        typeTimer = setTimeout(type, 20);
      }
    }

    if (!reducedMotion.matches && 'IntersectionObserver' in window) {
      const typeObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !started) {
            started = true;
            typedEl.textContent = '';
            clearTimeout(typeTimer);
            typeTimer = setTimeout(type, 700);
            typeObserver.disconnect();
          }
        });
      }, { threshold: 0.4 });
      typeObserver.observe(typedEl);
    }
  }

  /* ---------- faq ---------- */
  const faqItems = $$('.faq-item');
  faqItems.forEach((item) => {
    const button = $('.faq-q', item);
    button?.addEventListener('click', () => {
      Sound.click();
      const wasOpen = item.classList.contains('is-open');
      faqItems.forEach((other) => {
        other.classList.remove('is-open');
        $('.faq-q', other)?.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        item.classList.add('is-open');
        button.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------- sticky note wall ---------- */
  (() => {
    const hero = $('.hero');
    const notesRoot = $('[data-notes]', hero || document);
    if (!hero || !notesRoot) return;

    const notes = $$('.sticky-note[data-note]', notesRoot)
      .map((el) => ({ el, paper: $('.note-paper', el) }))
      .filter((note) => note.paper);
    if (!notes.length) return;

    const prefersReduced = () => reducedMotion.matches;
    const rand = (min, max) => min + Math.random() * (max - min);
    const state = {
      stageH: 0,
      inView: true,
      away: false,
      idleTimer: 0,
      resizeTimer: 0,
      cascadeTimers: [],
    };
    let introTimer = 0;

    function endIntro() {
      document.documentElement.classList.remove('notes-intro');
      clearTimeout(introTimer);
      introTimer = 0;
    }

    function measure() {
      state.stageH = notesRoot.clientHeight;
      notes.forEach((note) => {
        note.visible = note.el.offsetParent !== null;
        note.top = note.el.offsetTop;
        note.h = note.paper.offsetHeight;
      });
    }

    function clearTimers(note) {
      clearTimeout(note.peelTimer);
      clearTimeout(note.goneTimer);
      clearTimeout(note.respawnTimer);
      clearTimeout(note.restuckTimer);
    }

    function settle(note, restick = false) {
      clearTimers(note);
      note.busy = false;
      note.el.classList.remove('is-peeling', 'is-falling', 'is-gone');
      note.paper.style.removeProperty('--fall-y');
      note.paper.style.removeProperty('--fall-dur');
      if (restick) {
        note.el.classList.remove('is-restuck');
        void note.el.offsetWidth;
        note.el.classList.add('is-restuck');
        note.restuckTimer = setTimeout(() => note.el.classList.remove('is-restuck'), 640);
      }
    }

    function drop(note) {
      if (!note.visible || note.busy || prefersReduced()) return;
      endIntro();
      note.busy = true;
      note.el.classList.remove('is-restuck');
      note.el.classList.add('is-peeling');

      note.peelTimer = setTimeout(() => {
        if (!note.busy || prefersReduced()) return;
        const fall = state.stageH + note.h + 260;
        note.paper.style.setProperty('--fall-y', `${fall.toFixed(0)}px`);
        note.paper.style.setProperty('--fall-dur', `${rand(1.02, 1.18).toFixed(2)}s`);
        note.el.classList.remove('is-peeling');
        void note.el.offsetWidth;
        note.el.classList.add('is-falling');

        note.goneTimer = setTimeout(() => {
          note.el.classList.remove('is-falling');
          note.el.classList.add('is-gone');
          if (state.away) return;
          note.respawnTimer = setTimeout(() => {
            if (prefersReduced() || state.away) return;
            settle(note, true);
          }, rand(4400, 8200));
        }, 1560);
      }, 170);
    }

    function clearCascade() {
      state.cascadeTimers.forEach((timer) => clearTimeout(timer));
      state.cascadeTimers = [];
    }

    function setAway(away) {
      if (state.away === away) return;
      state.away = away;
      clearCascade();

      if (away) {
        endIntro();
        clearTimeout(state.idleTimer);
        state.idleTimer = 0;
        if (prefersReduced()) return;
        const remaining = notes.filter((note) => note.visible && !note.el.classList.contains('is-gone'));
        remaining.forEach((note, index) => {
          state.cascadeTimers.push(setTimeout(() => {
            if (!state.away) return;
            drop(note);
          }, index * 90));
        });
        return;
      }

      if (prefersReduced()) {
        makeStatic();
        return;
      }
      notes.forEach((note, index) => {
        if (!note.visible) return;
        state.cascadeTimers.push(setTimeout(() => {
          if (state.away) return;
          settle(note, true);
        }, index * 70));
      });
    }

    function syncAway() {
      const leaveAt = Math.max(140, hero.offsetHeight - window.innerHeight * .45);
      const returnAt = Math.max(80, leaveAt - 120);
      const nextAway = state.away ? window.scrollY > returnAt : window.scrollY > leaveAt;
      setAway(nextAway);

      if (state.away || window.scrollY > 24) {
        clearTimeout(state.idleTimer);
        state.idleTimer = 0;
      } else if (!prefersReduced()) {
        scheduleIdle(rand(14000, 22000));
      }
    }

    function scheduleIdle(delay) {
      clearTimeout(state.idleTimer);
      state.idleTimer = 0;
      if (prefersReduced() || !state.inView || state.away || document.hidden) return;
      state.idleTimer = setTimeout(() => {
        if (prefersReduced() || !state.inView || state.away || document.hidden || window.scrollY > 24) {
          scheduleIdle(rand(9000, 14000));
          return;
        }
        const available = notes.filter((note) => note.visible && !note.busy);
        if (available.length > 3) {
          drop(available[Math.floor(Math.random() * available.length)]);
        }
        scheduleIdle(rand(17000, 27000));
      }, delay ?? rand(16000, 25000));
    }

    function makeStatic() {
      endIntro();
      clearCascade();
      state.away = false;
      clearTimeout(state.idleTimer);
      state.idleTimer = 0;
      notes.forEach((note) => {
        clearTimers(note);
        note.busy = false;
        note.el.classList.remove('is-peeling', 'is-falling', 'is-gone', 'is-restuck');
        note.paper.style.removeProperty('--fall-y');
        note.paper.style.removeProperty('--fall-dur');
      });
    }

    notesRoot.addEventListener('click', (event) => {
      const el = event.target.closest('.sticky-note[data-note]');
      if (!el) return;
      const note = notes.find((item) => item.el === el);
      if (!note || note.busy) return;
      Sound.click();
      if (prefersReduced()) return;
      drop(note);
      scheduleIdle(rand(17000, 26000));
    });

    document.addEventListener('pointerdown', () => {
      if (window.scrollY < 30) scheduleIdle(rand(17000, 27000));
    }, { passive: true });
    document.addEventListener('keydown', () => {
      if (window.scrollY < 30) scheduleIdle(rand(17000, 27000));
    });

    window.addEventListener('scroll', syncAway, { passive: true });

    window.addEventListener('resize', () => {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(() => {
        measure();
        if (prefersReduced()) makeStatic();
        syncAway();
      }, 180);
    });

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        state.inView = entries[0]?.isIntersecting ?? true;
        if (state.inView && !prefersReduced() && !state.away) scheduleIdle(rand(15000, 23000));
        else {
          clearTimeout(state.idleTimer);
          state.idleTimer = 0;
        }
      }, { rootMargin: '100px' });
      observer.observe(hero);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearTimeout(state.idleTimer);
        state.idleTimer = 0;
      } else if (state.inView && !state.away && !prefersReduced()) {
        scheduleIdle(rand(14000, 22000));
      }
    });

    const onMotionChange = () => {
      if (prefersReduced()) {
        makeStatic();
        syncAway();
      } else {
        measure();
        state.away = false;
        syncAway();
        if (!state.away) scheduleIdle(rand(15000, 23000));
      }
    };
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionChange);
    else reducedMotion.addListener?.(onMotionChange);

    if (document.documentElement.classList.contains('notes-intro')) {
      if (window.scrollY < 24) introTimer = setTimeout(endIntro, 1800);
      else endIntro();
    }

    measure();
    syncAway();
    if (prefersReduced()) makeStatic();
  })();

  /* ---------- feature deck ---------- */
  (() => {
    const deck = $('[data-feature-deck]');
    if (!deck) return;

    const stage = $('.feature-stage', deck);
    const entries = $$('[data-feature-entry]', deck);
    if (!stage || entries.length < 2) return;

    const notes = entries.map((entry) => $('[data-feature-note]', entry));
    const liveEl = $('[data-deck-live]', deck);
    const indexEl = $('[data-deck-index]', deck);
    const titleEl = $('[data-deck-title]', deck);
    const meterEls = $$('.deck-meter span', deck);
    const prevBtn = $('[data-deck-prev]', deck);
    const nextBtn = $('[data-deck-next]', deck);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const flatStack = window.matchMedia('(max-width: 840px)');
    const mobileDeck = window.matchMedia('(max-width: 760px)');
    const grid = $('.feature-stage-grid', deck);
    const baseRotations = [-1.2, .8, -.6, 1.1, -.9, .7];
    const features = notes.map((note, index) => ({
      note,
      title: $('h3', note)?.textContent.trim() || `Feature ${index + 1}`,
      rotation: baseRotations[index % baseRotations.length],
    }));

    let active = 0;
    let ready = false;
    let carouselMode = false;
    let ticking = false;
    let gridTicking = false;
    let layoutSyncing = false;
    let navTarget = null;
    let navSettleTimer = 0;

    function paint(index) {
      active = index;
      deck.dataset.deckActive = String(index);
      const stackGap = parseFloat(getComputedStyle(deck).getPropertyValue('--stack-gap')) || 7;

      entries.forEach((entry, i) => {
        const depth = i - index;
        const scraped = !carouselMode && depth < 0;
        entry.classList.toggle('is-active', i === index);
        entry.classList.toggle('is-scraped', scraped);
        if (ready) {
          entry.inert = i !== index;
          if (i === index) entry.removeAttribute('aria-hidden');
          else entry.setAttribute('aria-hidden', 'true');
        } else {
          entry.inert = false;
          entry.removeAttribute('aria-hidden');
        }
        if (notes[i]) {
          if (carouselMode) {
            notes[i].style.removeProperty('--note-x');
            notes[i].style.removeProperty('--note-y');
            notes[i].style.removeProperty('--note-r');
            notes[i].style.removeProperty('--note-s');
          } else if (!scraped) {
            const rotation = flatStack.matches ? 0 : features[i].rotation + depth * .18;
            notes[i].style.setProperty('--note-x', `${depth * stackGap}px`);
            notes[i].style.setProperty('--note-y', `${depth * stackGap}px`);
            notes[i].style.setProperty('--note-r', `${rotation}deg`);
            notes[i].style.setProperty('--note-s', String(1 - depth * .008));
          }
        }
      });

      meterEls.forEach((meter, i) => {
        meter.classList.toggle('is-active', i === index);
        meter.classList.toggle('is-done', i < index);
      });
      if (liveEl) liveEl.textContent = `Feature ${index + 1} of ${entries.length}: ${features[index].title}`;
      if (indexEl) indexEl.textContent = String(index + 1).padStart(2, '0');
      if (titleEl) titleEl.textContent = features[index].title;
      if (prevBtn) prevBtn.disabled = index === 0;
      if (nextBtn) nextBtn.disabled = index === entries.length - 1;
    }

    function setActive(next) {
      const clamped = clamp(next, 0, entries.length - 1);
      if (clamped === active) return;
      paint(clamped);
    }

    function progressIndex() {
      const total = deck.offsetHeight - stage.offsetHeight;
      if (total <= 0) return 0;
      const top = deck.getBoundingClientRect().top + window.scrollY;
      const progress = clamp((window.scrollY - top) / total, 0, 1);
      return Math.min(entries.length - 1, Math.floor(progress * entries.length));
    }

    function syncFromScroll() {
      if (!ready) return;
      const next = progressIndex();
      if (next === active) return;
      setActive(next);
      if (!layoutSyncing && navTarget === null && !document.hidden) Sound.click();
    }

    function onScroll() {
      if (!ready || ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        syncFromScroll();
      });
    }

    function setStatic() {
      ready = false;
      deck.classList.remove('is-ready');
      entries.forEach((entry, i) => {
        entry.classList.remove('is-active', 'is-scraped');
        entry.inert = false;
        entry.removeAttribute('aria-hidden');
        if (notes[i]) {
          notes[i].style.removeProperty('--note-x');
          notes[i].style.removeProperty('--note-y');
          notes[i].style.removeProperty('--note-r');
          notes[i].style.removeProperty('--note-s');
        }
      });
      deck.removeAttribute('data-deck-active');
    }

    function carouselIndex() {
      if (!grid) return active;
      const gridLeft = grid.getBoundingClientRect().left;
      let best = 0;
      let bestDistance = Infinity;
      entries.forEach((entry, i) => {
        const distance = Math.abs(entry.getBoundingClientRect().left - gridLeft);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      return best;
    }

    function scrollToCard(index, behavior) {
      if (!grid) return;
      const target = clamp(index, 0, entries.length - 1);
      const gridRect = grid.getBoundingClientRect();
      const entryRect = entries[target].getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(grid).paddingLeft) || 0;
      const left = grid.scrollLeft + entryRect.left - gridRect.left - padding;
      grid.scrollTo({ left: Math.max(0, left), behavior });
    }

    function syncCarousel() {
      if (!carouselMode) return;
      const next = carouselIndex();
      if (next !== active) paint(next);
    }

    function onCarouselScroll() {
      if (!carouselMode || gridTicking) return;
      gridTicking = true;
      requestAnimationFrame(() => {
        gridTicking = false;
        syncCarousel();
      });
    }

    function layout() {
      const useCarousel = mobileDeck.matches;
      const modeChanged = carouselMode !== useCarousel;

      if (useCarousel) {
        // Phones get a swipeable deck instead of a long pinned scroll scene.
        carouselMode = true;
        deck.classList.remove('is-ready');
        deck.classList.add('is-carousel');
        setStatic();
        paint(active);
        if (modeChanged) requestAnimationFrame(() => scrollToCard(active, 'auto'));
        return;
      }

      carouselMode = false;
      deck.classList.remove('is-carousel');

      // Pinned deck needs enough vertical room for the note and its preview.
      // Very short screens get the readable, stacked feature cards instead.
      if (motion.matches || window.innerHeight < 620) {
        setStatic();
        return;
      }
      deck.classList.add('is-ready');
      ready = true;
      paint(active);
      layoutSyncing = true;
      syncFromScroll();
      layoutSyncing = false;
      if (modeChanged) requestAnimationFrame(() => paint(active));
    }

    function goTo(index) {
      const target = clamp(index, 0, entries.length - 1);
      if (carouselMode) {
        scrollToCard(target, motion.matches ? 'auto' : 'smooth');
        paint(target);
        return;
      }
      if (!ready) return;
      const total = deck.offsetHeight - stage.offsetHeight;
      const top = deck.getBoundingClientRect().top + window.scrollY;
      const pos = top + total * ((target + .5) / entries.length);
      // The button already plays a click; ignore the scroll-driven one until it settles.
      navTarget = target;
      clearTimeout(navSettleTimer);
      navSettleTimer = setTimeout(() => { navTarget = null; }, 1000);
      window.scrollTo({ top: Math.max(0, pos), behavior: motion.matches ? 'auto' : 'smooth' });
    }

    prevBtn?.addEventListener('click', () => {
      Sound.click();
      goTo(active - 1);
    });
    nextBtn?.addEventListener('click', () => {
      Sound.click();
      goTo(active + 1);
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', layout);
    grid?.addEventListener('scroll', onCarouselScroll, { passive: true });
    if (motion.addEventListener) motion.addEventListener('change', layout);
    else motion.addListener?.(layout);

    layout();
    requestAnimationFrame(layout);
  })();

  /* ---------- randomized testimonial tape ---------- */
  (() => {
    const voices = $$('.voice');
    if (!voices.length) return;
    const rand = (min, max) => min + Math.random() * (max - min);
    voices.forEach((voice) => {
      voice.style.setProperty('--tape-x', `${rand(30, 70).toFixed(1)}%`);
      voice.style.setProperty('--tape-y', `${rand(-10, -6).toFixed(1)}px`);
      voice.style.setProperty('--tape-r', `${rand(-3.4, 3.4).toFixed(2)}deg`);
      voice.style.setProperty('--tape-w', `${rand(48, 64).toFixed(0)}px`);
    });
  })();

  /* ---------- signup ---------- */
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  $$('[data-signup]').forEach((form) => {
    const wrap = form.closest('.signup-wrap');
    const note = wrap?.querySelector('.form-note');
    const input = $('input[type="email"]', form);
    const button = $('button[type="submit"]', form);
    const defaultButton = button?.innerHTML;
    let resetTimer = 0;

    const setNote = (message) => {
      if (note) note.textContent = message;
    };

    const restoreButton = () => {
      if (!button || !defaultButton) return;
      button.innerHTML = defaultButton;
      button.disabled = false;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.dataset.submitting === 'true' || button?.disabled) return;

      // Opening index.html directly (file://) cannot reach the API. Fail with
      // a useful message instead of a console CORS error.
      if (window.location.protocol === 'file:') {
        form.classList.remove('is-success');
        form.classList.add('is-invalid');
        wrap?.classList.remove('is-success');
        setNote('Preview mode — run `npm start` to join the waitlist.');
        input?.focus();
        setTimeout(() => form.classList.remove('is-invalid'), 450);
        return;
      }

      const email = input?.value.trim() || '';
      if (!emailRegex.test(email)) {
        form.classList.remove('is-success');
        form.classList.add('is-invalid');
        wrap?.classList.remove('is-success');
        setNote('That email doesn’t look quite right — one more try?');
        input?.focus();
        setTimeout(() => form.classList.remove('is-invalid'), 450);
        return;
      }

      form.classList.remove('is-invalid');
      form.dataset.submitting = 'true';
      clearTimeout(resetTimer);
      if (button) {
        button.disabled = true;
        button.innerHTML = '<span>Joining…</span>';
      }
      setNote('');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      try {
        const response = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
          signal: controller.signal,
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const error = new Error(data.error || 'Request failed.');
          error.status = response.status;
          throw error;
        }

        form.classList.add('is-success');
        wrap?.classList.add('is-success');
        try {
          const stored = JSON.parse(localStorage.getItem('dumpit_waitlist') || '[]');
          const storedEmail = email.toLowerCase();
          if (!stored.includes(storedEmail)) stored.push(storedEmail);
          localStorage.setItem('dumpit_waitlist', JSON.stringify(stored));
        } catch (err) { /* private browsing */ }

        setNote(
          data.alreadyRegistered
            ? 'You’re already on the list — we’ll be in touch.'
            : 'You’re in. Keep an eye on your inbox — and your WhatsApp.'
        );

        if (button) {
          button.innerHTML = '<span>You’re on the list</span><svg class="icon"><use href="#i-check"/></svg>';
          button.disabled = true;
        }
        if (input) input.value = '';

        resetTimer = setTimeout(() => {
          restoreButton();
          form.classList.remove('is-success');
          wrap?.classList.remove('is-success');
          setNote('');
        }, 6000);
      } catch (err) {
        form.classList.remove('is-success');
        wrap?.classList.remove('is-success');
        restoreButton();
        if (err.name === 'AbortError') {
          setNote('That took too long — one more try?');
        } else if (err.status === 429) {
          setNote('Too many tries — give it a minute.');
        } else if (err.status === 400) {
          form.classList.add('is-invalid');
          setTimeout(() => form.classList.remove('is-invalid'), 450);
          setNote('That email doesn’t look quite right — one more try?');
        } else {
          setNote('Something went wrong — one more try?');
        }
        input?.focus();
      } finally {
        clearTimeout(timeout);
        form.dataset.submitting = 'false';
      }
    });

    input?.addEventListener('input', () => {
      form.classList.remove('is-invalid');
      if (note && !wrap?.classList.contains('is-success')) note.textContent = '';
    });
  });

  window.__dumpit = { toggleAudio, buildWave, Sound };
})();
