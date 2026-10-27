/* =========================================================
   dumpit — the desk, a live app preview
   ========================================================= */
(() => {
  'use strict';

  const appWindow = document.querySelector('[data-macapp]');
  if (!appWindow) return;

  const noteList = document.querySelector('[data-note-list]');
  const detail = document.querySelector('[data-note-detail]');
  const detailScroll = document.querySelector('[data-detail-scroll]');
  const searchInput = document.querySelector('[data-app-search]');
  const listTitle = document.querySelector('[data-list-title]');
  const listCount = document.querySelector('[data-list-count]');
  const sortButton = document.querySelector('.app-sort');
  const filterButtons = Array.from(document.querySelectorAll('.app-filter'));

  const categoryColor = {
    Work: 'work',
    Study: 'study',
    Ideas: 'ideas',
    Personal: 'personal',
    Shopping: 'personal',
  };

  const notes = [
    {
      id: 'q3',
      title: 'Q3 launch — kickoff call',
      category: 'Work',
      time: '9:41 AM',
      date: 'Today',
      duration: '0:48',
      durationSec: 48,
      snippet: 'Timing, owners, and the two things that still need a decision.',
      summary: 'The launch is holding at October 28. Maya owns the deck, Sam is finalizing pricing. The only open question is whether the beta invite goes to the full list or the first 500.',
      tasks: [
        { label: 'Send Q3 deck to Maya', meta: 'Thu', done: false },
        { label: 'Book design review', meta: 'Mon 10:00', done: false },
        { label: 'Reply to Sam about budget', meta: 'Today', done: true },
      ],
      reminder: { label: 'Launch sync', meta: 'Wed 9:00' },
      tags: ['launch', 'q3', 'work'],
      transcript: '“Quick one after the kickoff — the date is still October 28th. Maya needs the deck by Thursday, and I should book the design review for Monday…”',
    },
    {
      id: 'behaviour',
      title: 'Behavioral economics — lecture 04',
      category: 'Study',
      time: 'Yesterday',
      date: 'Yesterday',
      duration: '32:14',
      durationSec: 32,
      snippet: 'Nudges, defaults, and why we never choose the salad.',
      summary: 'This lecture covered how small environmental cues change decisions. Defaults, loss aversion, and friction were the three ideas worth carrying forward.',
      keypoints: [
        'Defaults do most of the deciding.',
        'Losses feel about twice as loud as gains.',
        'Small friction changes behavior more than big persuasion.',
      ],
      tasks: [
        { label: 'Review nudges chapter', meta: 'Fri', done: false },
        { label: 'Make flashcards for loss aversion', meta: 'Weekend', done: false },
      ],
      reminder: null,
      tags: ['lecture', 'semester 2', 'economics'],
      transcript: '“Okay, lecture four. Today was all about nudges and defaults. The reading is the Thaler chapter, and we should probably make flashcards before the seminar…”',
    },
    {
      id: 'kitchen',
      title: 'Kitchen list + the weekend',
      category: 'Shopping',
      time: '8:12 AM',
      date: 'Today',
      duration: '0:22',
      durationSec: 22,
      snippet: 'Oat milk, avocados, coffee — and call Mom on Sunday.',
      summary: 'A quick kitchen dump before the shop. The list is complete, the lemons are for the pasta, and there is one reminder for Sunday.',
      shopping: [
        { label: 'Oat milk', meta: '×2' },
        { label: 'Avocados', meta: '×3' },
        { label: 'Coffee beans', meta: '1 bag' },
        { label: 'Sourdough', meta: '1' },
        { label: 'Lemons', meta: '×4' },
        { label: 'Olive oil', meta: '1' },
      ],
      reminder: { label: 'Call Mom', meta: 'Sun 11:00' },
      tags: ['kitchen', 'weekend'],
      transcript: '“Morning — add oat milk and avocados to the list, we’re nearly out of coffee, and remind me to call Mom on Sunday…”',
    },
    {
      id: 'podcast',
      title: 'That podcast idea about pricing',
      category: 'Ideas',
      time: 'Yesterday',
      date: 'Yesterday',
      duration: '0:36',
      durationSec: 36,
      snippet: 'Free tiers, invisible costs, and the psychology of “just $9”.',
      summary: 'A three-episode series idea about the cost of free. Episode one would unpack free tiers, episode two the psychology of pricing, and episode three a founder who got it wrong.',
      tasks: [
        { label: 'Sketch three episode titles', meta: 'Sat', done: false },
        { label: 'Ask Maya about cover art', meta: 'Next week', done: false },
      ],
      reminder: null,
      tags: ['podcast', 'pricing', 'side project'],
      transcript: '“Okay, this is the podcast idea — what if the whole season was about pricing? Free tiers, the cost of free, why $9 feels so different from $10…”',
    },
    {
      id: 'dentist',
      title: 'Dentist + small admin',
      category: 'Personal',
      time: 'Mon',
      date: 'Monday',
      duration: '0:18',
      durationSec: 18,
      snippet: 'Book the dentist, renew the passport, stop putting both off.',
      summary: 'The admin dump. Two things: book the six-month dentist check-up and renew the passport before the trip in August.',
      tasks: [
        { label: 'Book dentist appointment', meta: 'Wed 10:00', done: false },
        { label: 'Renew passport online', meta: 'This month', done: true },
      ],
      reminder: { label: 'Dentist', meta: 'Wed 10:00' },
      tags: ['admin', 'health'],
      transcript: '“Right, admin. Call the dentist on Wednesday, and actually renew the passport this time. That’s it. Thank you.”',
    },
    {
      id: 'offsite',
      title: 'Team offsite brainstorm',
      category: 'Work',
      time: 'Mon',
      date: 'Monday',
      duration: '0:58',
      durationSec: 58,
      snippet: 'Two days, twelve people, and far too many breakout rooms.',
      summary: 'The team wants the offsite to feel less like a conference. The strongest idea was a single long walk with one question, followed by a working session with no slides.',
      tasks: [
        { label: 'Book the cabin for two nights', meta: 'Fri', done: false },
        { label: 'Send the offsite survey', meta: 'Tue', done: false },
      ],
      reminder: null,
      tags: ['team', 'offsite'],
      transcript: '“Offsite brainstorm notes. Less slides, more walking. Maybe one question for the whole first day, and a proper working session after lunch…”',
    },
    {
      id: 'book',
      title: 'Book notes — The Creative Act',
      category: 'Personal',
      time: 'Sun',
      date: 'Sunday',
      duration: '0:41',
      durationSec: 41,
      snippet: 'The idea that the artist is a filter, not a generator.',
      summary: 'A short dump after finishing the book. The most useful idea: you are not here to make the art, you are here to get out of its way. Keep the input strange and the output honest.',
      keypoints: [
        'The artist is a filter, not a generator.',
        'Attention is the material.',
        'Make the work you want to find.',
      ],
      tasks: [],
      reminder: null,
      tags: ['books', 'creativity'],
      transcript: '“Finished The Creative Act. The bit I want to keep is that the artist is a filter — you don’t invent the thing, you notice it and get out of the way…”',
    },
  ];

  const filterTitles = {
    all: 'All notes',
    tasks: 'Tasks',
    shopping: 'Shopping',
    reminders: 'Reminders',
    Work: 'Work',
    Study: 'Study',
    Ideas: 'Ideas',
    Personal: 'Personal',
  };

  let activeFilter = 'all';
  let query = '';
  let selectedId = notes[0].id;
  let appInView = false;
  let sortReversed = false;
  const recentOrder = ['q3', 'kitchen', 'behaviour', 'podcast', 'dentist', 'offsite', 'book'];

  const escapeHtml = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  function matchesFilter(note, filter) {
    if (filter === 'all') return true;
    if (filter === 'tasks') return (note.tasks || []).some((task) => !task.done);
    if (filter === 'reminders') return Boolean(note.reminder);
    if (filter === 'shopping') return Boolean(note.shopping);
    return note.category === filter;
  }

  function getVisibleNotes() {
    const q = query.trim().toLowerCase();
    const visible = notes.filter((note) => {
      if (!q && !matchesFilter(note, activeFilter)) return false;
      return [note.title, note.snippet, note.summary, note.category, ...(note.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    visible.sort((a, b) => recentOrder.indexOf(a.id) - recentOrder.indexOf(b.id));
    return sortReversed ? visible.reverse() : visible;
  }

  function renderList(visible) {
    if (!noteList) return;
    if (!visible.length) {
      noteList.innerHTML = '<div class="app-empty"><b>Nothing filed here yet</b>Try another word or a different folder.</div>';
      return;
    }
    noteList.innerHTML = visible.map((note) => `
      <button class="note-row${note.id === selectedId ? ' is-active' : ''}" type="button" data-note-id="${note.id}" aria-current="${note.id === selectedId ? 'true' : 'false'}">
        <span class="note-row-top">
          <span class="note-cat"><i style="background:var(--${categoryColor[note.category]})"></i>${escapeHtml(note.category)}</span>
          <span class="note-dur"><svg class="icon"><use href="#i-mic"/></svg>${escapeHtml(note.duration)}</span>
        </span>
        <b>${escapeHtml(note.title)}</b>
        <span class="note-snippet">${escapeHtml(note.snippet)}</span>
        <span class="note-row-time">${escapeHtml(note.date)} · ${escapeHtml(note.time)}</span>
      </button>
    `).join('');
  }

  function renderDetail(note) {
    if (!detailScroll) return;
    if (!note) {
      detailScroll.innerHTML = `
        <div class="app-empty" style="padding-top:60px;">
          <b>No note selected</b>
          Choose a folder or clear your search.<br>
          <button type="button" data-clear-search style="margin-top:14px;border:0;background:none;color:var(--green-deep);font-size:10px;text-decoration:underline;">Clear search</button>
        </div>`;
      return;
    }
    const cat = categoryColor[note.category];
    const tasks = note.tasks || [];
    const keypoints = note.keypoints || [];
    const shopping = note.shopping || [];

    detailScroll.innerHTML = `
      <div class="detail-kicker">
        <span class="detail-cat"><i style="background:var(--${cat})"></i>${escapeHtml(note.category)}</span>
        <span>${escapeHtml(note.date)} · ${escapeHtml(note.time)}</span>
      </div>
      <p class="detail-title">${escapeHtml(note.title)}</p>
      <div class="detail-audio" data-audio data-duration="${note.durationSec}" role="button" tabindex="0" aria-label="Play voice note">
        <span class="audio-play" aria-hidden="true"><svg class="icon"><use href="#i-play"/></svg></span>
        <div class="wave wave--app" data-wave data-bars="44"></div>
        <span class="audio-time">${escapeHtml(note.duration)}</span>
      </div>

      <div class="detail-block">
        <p class="detail-label">Summary</p>
        <p class="detail-summary">${escapeHtml(note.summary)}</p>
      </div>

      ${keypoints.length ? `
        <div class="detail-block">
          <p class="detail-label">Key points</p>
          <ul class="detail-points">
            ${keypoints.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}
          </ul>
        </div>` : ''}

      ${tasks.length ? `
        <div class="detail-block">
          <p class="detail-label">Tasks</p>
          <div class="detail-tasks">
            ${tasks.map((task, i) => `
              <button class="detail-task" type="button" data-app-task="${i}" aria-pressed="${task.done}">
                <span class="detail-check"><svg class="icon"><use href="#i-check"/></svg></span>
                ${escapeHtml(task.label)}
                <em>${escapeHtml(task.meta)}</em>
              </button>`).join('')}
          </div>
        </div>` : ''}

      ${shopping.length ? `
        <div class="detail-block">
          <p class="detail-label">Shopping list</p>
          <div class="detail-tasks">
            ${shopping.map((item, i) => `
              <button class="detail-task" type="button" data-app-shopping="${i}" aria-pressed="false">
                <span class="detail-check"><svg class="icon"><use href="#i-check"/></svg></span>
                ${escapeHtml(item.label)}
                <em>${escapeHtml(item.meta)}</em>
              </button>`).join('')}
          </div>
        </div>` : ''}

      ${note.reminder ? `
        <div class="detail-block">
          <p class="detail-label">Reminder</p>
          <div class="detail-reminder">
            <svg class="icon"><use href="#i-bell"/></svg>
            ${escapeHtml(note.reminder.label)}
            <em>${escapeHtml(note.reminder.meta)}</em>
          </div>
        </div>` : ''}
    `;

    window.__dumpit?.buildWave(detailScroll.querySelector('[data-wave]'));
  }

  function render({ keepSelection = false } = {}) {
    const visible = getVisibleNotes();
    if (!visible.length) {
      selectedId = null;
    } else if (!keepSelection || !visible.some((note) => note.id === selectedId)) {
      selectedId = visible[0].id;
    }
    renderList(visible);
    const selected = notes.find((note) => note.id === selectedId);
    renderDetail(selected);

    if (listTitle) listTitle.textContent = query.trim() ? 'Search results' : (filterTitles[activeFilter] || 'Notes');
    if (listCount) {
      const total = visible.length;
      listCount.textContent = `${total} ${total === 1 ? 'note' : 'notes'}`;
    }
    filterButtons.forEach((button) => {
      const match = button.dataset.filter === activeFilter;
      button.classList.toggle('is-active', match);
      if (match) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'all';
      query = '';
      if (searchInput) searchInput.value = '';
      appWindow.classList.remove('show-detail');
      render();
    });
  });

  sortButton?.addEventListener('click', () => {
    sortReversed = !sortReversed;
    sortButton.classList.toggle('is-reversed', sortReversed);
    sortButton.setAttribute('aria-label', sortReversed ? 'Sort newest first' : 'Sort oldest first');
    render({ keepSelection: true });
  });

  noteList?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-note-id]');
    if (!row) return;
    selectedId = row.dataset.noteId;
    render({ keepSelection: true });
    if (window.innerWidth <= 760) {
      appWindow.classList.add('show-detail');
      detail?.querySelector('.app-detail-back')?.focus({ preventScroll: true });
    }
  });

  searchInput?.addEventListener('input', () => {
    query = searchInput.value;
    if (query.trim() && activeFilter !== 'all') activeFilter = 'all';
    render();
  });

  detail?.addEventListener('click', (e) => {
    const task = e.target.closest('[data-app-task]');
    const shopItem = e.target.closest('[data-app-shopping]');
    const clear = e.target.closest('[data-clear-search]');
    const back = e.target.closest('.app-detail-back');

    if (back) {
      appWindow.classList.remove('show-detail');
      noteList?.querySelector('.note-row.is-active')?.focus({ preventScroll: true });
      return;
    }
    if (clear) {
      query = '';
      if (searchInput) searchInput.value = '';
      render();
      return;
    }
    if (task) {
      const note = notes.find((item) => item.id === selectedId);
      if (!note) return;
      const index = Number(task.dataset.appTask);
      note.tasks[index].done = !note.tasks[index].done;
      task.setAttribute('aria-pressed', String(note.tasks[index].done));
      return;
    }
    if (shopItem) {
      const pressed = shopItem.getAttribute('aria-pressed') === 'true';
      shopItem.setAttribute('aria-pressed', String(!pressed));
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && appWindow.classList.contains('show-detail')) {
      appWindow.classList.remove('show-detail');
      noteList?.querySelector('.note-row.is-active')?.focus({ preventScroll: true });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && appInView) {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    }
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.value = '';
      query = '';
      searchInput.blur();
      render();
    }
  });

  const appSection = document.querySelector('#app');
  if (appSection && 'IntersectionObserver' in window) {
    const visibilityObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { appInView = entry.isIntersecting; });
    }, { threshold: 0.15 });
    visibilityObserver.observe(appSection);
  }

  render();
})();
