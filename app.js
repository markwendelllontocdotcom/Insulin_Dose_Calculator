/*
 * Insulin Dose Calculator
 * -----------------------
 * Everything runs on the phone. Nothing is saved or sent anywhere.
 *
 * Helper tool only – always check against the written plan and follow
 * the care team's advice.
 *
 * HOW TO CHANGE THE PLAN
 *   1. Edit the numbers in DOSE_PLAN below (and planDate).
 *   2. Run the tests:  node --test   (from this folder)
 *   3. In service-worker.js change CACHE_VERSION (for example v1 → v2)
 *      so phones download the new version.
 */
(function () {
  'use strict';

  /* ================================================================
     DOSE PLAN – the only place the numbers live.
     Copied from the written plan "Flexible Insulin Dose Plan" dated
     24 July 2024.
     ================================================================ */
  const DOSE_PLAN = {
    planTitle: 'Flexible Insulin Dose Plan',
    planDate: '24 July 2024',
    rapidInsulin: 'NovoRapid',
    longActingInsulin: 'Tresiba',

    // Meal times. clockFrom is inclusive, clockTo is exclusive (24-hour clock).
    // Any time not covered falls back to fallbackMeal.
    meals: [
      { id: 'breakfast', label: 'Breakfast', short: 'B’fast', clockFrom: '05:00', clockTo: '11:00' },
      { id: 'lunch',     label: 'Lunch',     short: 'Lunch',  clockFrom: '11:00', clockTo: '16:00' },
      { id: 'dinner',    label: 'Dinner',    short: 'Dinner', clockFrom: '16:00', clockTo: '21:00' },
      { id: 'bedtime',   label: 'Bedtime',   short: 'Bed' }
    ],
    fallbackMeal: 'bedtime',

    // Insulin-to-carb ratio: grams of carbohydrate covered by 1 unit.
    carbRatio: { breakfast: 8, lunch: 8, dinner: 8, bedtime: 8 },

    // Glucose correction in units. The row used is the one whose "from"
    // is the largest value that is not above the reading.
    correctionTable: [
      { from: 0,   label: 'Less than 70', breakfast: 0, lunch: 0, dinner: 0, bedtime: 0 },
      { from: 70,  label: '70 to 100',    breakfast: 0, lunch: 0, dinner: 0, bedtime: 0 },
      { from: 101, label: '101 to 120',   breakfast: 1, lunch: 1, dinner: 1, bedtime: 0 },
      { from: 121, label: '121 to 150',   breakfast: 1, lunch: 1, dinner: 1, bedtime: 0 },
      { from: 151, label: '151 to 180',   breakfast: 2, lunch: 2, dinner: 2, bedtime: 1 },
      { from: 181, label: '181 to 220',   breakfast: 3, lunch: 3, dinner: 3, bedtime: 2 },
      { from: 221, label: '221 to 260',   breakfast: 5, lunch: 5, dinner: 5, bedtime: 4 },
      { from: 261, label: '261 to 300',   breakfast: 6, lunch: 6, dinner: 6, bedtime: 5 },
      { from: 301, label: '301 to 350',   breakfast: 7, lunch: 7, dinner: 7, bedtime: 7 },
      { from: 351, label: 'Over 350',     breakfast: 9, lunch: 9, dinner: 9, bedtime: 8 }
    ],

    // Trend arrow adjustment in units (no arrow = 0).
    arrows: [
      { id: 'upup',     symbol: '↑↑', name: 'Double up',   adjust: 3,  colourName: 'Dark Red',    bg: '#C00000', fg: '#FFFFFF' },
      { id: 'up',       symbol: '↑',  name: 'Up',          adjust: 2,  colourName: 'Red',         bg: '#FF0000', fg: '#FFFFFF' },
      { id: 'steady',   symbol: '→',  name: 'Steady',      adjust: 0,  colourName: 'Yellow',      bg: '#FFFF00', fg: '#000000' },
      { id: 'down',     symbol: '↓',  name: 'Down',        adjust: -2, colourName: 'Light Green', bg: '#92D050', fg: '#000000' },
      { id: 'downdown', symbol: '↓↓', name: 'Double down', adjust: -3, colourName: 'Green',       bg: '#00B050', fg: '#FFFFFF' }
    ],

    // Blood sugar box colour. First match wins:
    // "below" means reading < value, "atMost" means reading <= value.
    readingColours: [
      { label: 'Under 70',          below: 70,   name: 'Blue',     bg: '#0070C0', fg: '#FFFFFF' },
      { label: '70 to 100',         atMost: 100, name: 'Yellow',   bg: '#FFFF00', fg: '#000000' },
      { label: 'Over 100 to 180',   atMost: 180, name: 'Green',    bg: '#00B050', fg: '#FFFFFF' },
      { label: 'Over 180 to 250',   atMost: 250, name: 'Red',      bg: '#FF0000', fg: '#FFFFFF' },
      { label: 'Over 250',                       name: 'Dark Red', bg: '#C00000', fg: '#FFFFFF' }
    ],

    lowBelow: 70,                 // "LOW" message below this
    injectAfterEatingBelow: 80,   // inject after eating below this
    ketonesAbove: 250,            // check ketones above this
    hypoRapidCarbsGrams: 20,      // rapid carbs for hypoglycaemia
    exerciseReductionUnits: 2,    // before exercise (NOT included in the calculation)

    messages: {
      low: 'LOW: treat with 20 g rapid carbs first',
      sweets: 'Take sweets to avoid Hypoglycemia',
      injectAfter: 'Below 80: inject after eating',
      great: 'You’re doing Great!!! 😊'
    },
    messageColours: {
      red:   { bg: '#FF0000', fg: '#FFFFFF' },
      green: { bg: '#00B050', fg: '#FFFFFF' }
    },

    disclaimer: 'Helper tool only – always check against the written plan and follow the care team’s advice.',

    // Carb amounts listed in the carb-to-dose table on the Plan tab.
    carbTableRows: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160],

    foodRows: 3,

    // If the app has been in the background this long, it clears itself
    // so an old reading is never reused. Set to 0 to switch this off.
    autoClearAfterMinutes: 30
  };

  /* ================================================================
     CALCULATIONS (pure functions – covered by tests/calc.test.js)
     ================================================================ */

  /** Turns typed text into a number. Returns null for blank or invalid text. */
  function parseNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).trim().replace(',', '.');
    if (text === '') return null;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  /** Blood sugar reading, or null when blank / invalid / negative. */
  function parseReading(value) {
    const n = parseNumber(value);
    return n === null || n < 0 ? null : n;
  }

  /** Round to the nearest whole number, .5 rounds up (like Excel ROUND for positive numbers). */
  function roundHalfUp(x) {
    return Math.floor(x + 0.5 + 1e-9);
  }

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  /** Default meal time from the clock. */
  function mealTimeForClock(date, plan) {
    plan = plan || DOSE_PLAN;
    const minutes = date.getHours() * 60 + date.getMinutes();
    for (const meal of plan.meals) {
      if (!meal.clockFrom || !meal.clockTo) continue;
      if (minutes >= toMinutes(meal.clockFrom) && minutes < toMinutes(meal.clockTo)) return meal.id;
    }
    return plan.fallbackMeal;
  }

  /** Row of the correction table: the largest "from" that is <= reading. */
  function findCorrectionBand(reading, plan) {
    plan = plan || DOSE_PLAN;
    const rows = plan.correctionTable.slice().sort((a, b) => a.from - b.from);
    let band = rows[0];
    for (const row of rows) {
      if (row.from <= reading) band = row;
    }
    return band;
  }

  function arrowInfo(arrowId, plan) {
    plan = plan || DOSE_PLAN;
    if (!arrowId) return null;
    return plan.arrows.find(a => a.id === arrowId) || null;
  }

  function arrowAdjustment(arrowId, plan) {
    const arrow = arrowInfo(arrowId, plan);
    return arrow ? arrow.adjust : 0;
  }

  /** Correction dose in units, or null when there is no reading. May be negative. */
  function correctionDose(reading, arrowId, meal, plan) {
    plan = plan || DOSE_PLAN;
    if (reading === null || reading === undefined) return null;
    const band = findCorrectionBand(reading, plan);
    return band[meal] + arrowAdjustment(arrowId, plan);
  }

  /** Dose for one food row, or null ("No food") when the name or the carbs are empty. */
  function foodDose(foodName, carbs, meal, plan) {
    plan = plan || DOSE_PLAN;
    const name = foodName === null || foodName === undefined ? '' : String(foodName).trim();
    const grams = parseNumber(carbs);
    if (name === '' || grams === null || grams < 0) return null;
    return roundHalfUp(grams / plan.carbRatio[meal]);
  }

  function readingColour(reading, plan) {
    plan = plan || DOSE_PLAN;
    if (reading === null || reading === undefined) return null;
    for (const c of plan.readingColours) {
      if ('below' in c) { if (reading < c.below) return c; continue; }
      if ('atMost' in c) { if (reading <= c.atMost) return c; continue; }
      return c;
    }
    return null;
  }

  /** Banner message. First match wins. */
  function dosingMessage(reading, correction, plan) {
    plan = plan || DOSE_PLAN;
    if (reading === null || reading === undefined) return null;
    if (reading < plan.lowBelow) return { key: 'low', tone: 'red', text: plan.messages.low };
    if (reading < plan.injectAfterEatingBelow && correction < 0) return { key: 'sweets', tone: 'red', text: plan.messages.sweets };
    if (reading < plan.injectAfterEatingBelow) return { key: 'injectAfter', tone: 'red', text: plan.messages.injectAfter };
    return { key: 'great', tone: 'green', text: plan.messages.great };
  }

  /**
   * Full calculation for the screen.
   * input = { meal, reading, arrow, foods: [{ name, carbs }] }
   */
  function calculate(input, plan) {
    plan = plan || DOSE_PLAN;
    const meal = input.meal;
    if (!(meal in plan.carbRatio)) throw new Error('Unknown meal time: ' + meal);

    const reading = parseReading(input.reading);
    const arrow = arrowInfo(input.arrow, plan) ? input.arrow : null;
    const correction = correctionDose(reading, arrow, meal, plan);

    const foods = (input.foods || []).map(f => ({
      name: f.name,
      carbs: f.carbs,
      dose: foodDose(f.name, f.carbs, meal, plan)
    }));
    const foodTotal = foods.reduce((sum, f) => sum + (f.dose === null ? 0 : f.dose), 0);
    const total = Math.max(0, (correction === null ? 0 : correction) + foodTotal);

    return {
      meal,
      reading,
      arrow,
      correction,
      foods,
      foodTotal,
      total,
      band: reading === null ? null : findCorrectionBand(reading, plan),
      message: dosingMessage(reading, correction, plan),
      readingColour: readingColour(reading, plan),
      arrowColour: arrowInfo(arrow, plan),
      checkKetones: reading !== null && reading > plan.ketonesAbove
    };
  }

  /** "8 u", "−2 u" (true minus sign), "" for null. */
  function formatUnits(n) {
    if (n === null || n === undefined) return '';
    return signedNumber(n) + ' u';
  }

  function signedNumber(n, showPlus) {
    if (n < 0) return '−' + Math.abs(n);
    if (n > 0 && showPlus) return '+' + n;
    return String(Math.abs(n));
  }

  function reminderList(plan) {
    plan = plan || DOSE_PLAN;
    return [
      'Take insulin before meals and snacks unless glucose is below ' + plan.injectAfterEatingBelow + ' mg/dL (then inject after eating).',
      'Hypoglycaemia: use ' + plan.hypoRapidCarbsGrams + ' g rapid carbs.',
      'Before exercise: reduce insulin by ' + plan.exerciseReductionUnits + ' units. This is not included in the calculation.',
      'Check ketones if glucose is over ' + plan.ketonesAbove + ' mg/dL, particularly if unwell.',
      'Long-acting insulin (' + plan.longActingInsulin + ') is not part of this calculator.'
    ];
  }

  const api = {
    DOSE_PLAN, parseNumber, parseReading, roundHalfUp, mealTimeForClock,
    findCorrectionBand, arrowInfo, arrowAdjustment, correctionDose, foodDose,
    readingColour, dosingMessage, calculate, formatUnits, signedNumber, reminderList
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') startApp(api);

  /* ================================================================
     SCREEN (only runs in the browser)
     ================================================================ */
  function startApp(api) {
    const plan = api.DOSE_PLAN;
    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    const state = { meal: api.mealTimeForClock(new Date(), plan), arrow: null };
    const foodInputs = [];
    let hiddenAt = null;

    function el(tag, attrs, children) {
      const node = document.createElement(tag);
      Object.entries(attrs || {}).forEach(([key, value]) => {
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') node.textContent = value;
        else if (key === 'class') node.className = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
      });
      (children || []).forEach(child => node.append(child));
      return node;
    }

    /* ---------- build the pieces that come from the plan ---------- */

    const mealWrap = $('#meal-buttons');
    plan.meals.forEach(meal => {
      mealWrap.append(el('button', {
        type: 'button', role: 'radio', 'aria-checked': 'false', 'data-meal': meal.id, text: meal.label,
        onclick: () => { state.meal = meal.id; render(); }
      }));
    });

    const arrowWrap = $('#arrow-buttons');
    plan.arrows.forEach(arrow => {
      const btn = el('button', {
        type: 'button', role: 'radio', 'aria-checked': 'false', 'data-arrow': arrow.id,
        'aria-label': arrow.name + ' arrow, ' + api.signedNumber(arrow.adjust, true) + ' units',
        onclick: () => { state.arrow = state.arrow === arrow.id ? null : arrow.id; render(); }
      }, [
        el('span', { class: 'sym', text: arrow.symbol }),
        el('span', { class: 'adj', text: api.signedNumber(arrow.adjust, true) })
      ]);
      btn.style.setProperty('--sel-bg', arrow.bg);
      btn.style.setProperty('--sel-fg', arrow.fg);
      arrowWrap.append(btn);
    });

    const foodWrap = $('#food-rows');
    for (let i = 0; i < plan.foodRows; i++) {
      const name = el('input', {
        type: 'text', class: 'food-name', 'aria-label': 'Food ' + (i + 1),
        placeholder: 'Food', autocomplete: 'off', autocapitalize: 'sentences',
        enterkeyhint: 'next', maxlength: '40'
      });
      const carbs = el('input', {
        type: 'text', class: 'food-carbs', inputmode: 'decimal',
        'aria-label': 'Carbs for food ' + (i + 1) + ' in grams', placeholder: 'g',
        autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
        enterkeyhint: 'done', maxlength: '5'
      });
      const dose = el('output', { class: 'food-dose', 'aria-label': 'Required dose for food ' + (i + 1) });
      foodWrap.append(el('div', { class: 'food-grid food-row' }, [name, carbs, dose]));

      name.addEventListener('input', render);
      name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); carbs.focus(); } });
      carbs.addEventListener('input', () => { keepOnly(carbs, /[^\d.,]/g); render(); });
      carbs.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); carbs.blur(); } });
      foodInputs.push({ name, carbs, dose });
    }

    const reading = $('#reading');
    reading.addEventListener('input', () => { keepOnly(reading, /[^\d]/g); render(); });
    reading.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reading.blur(); } });

    function keepOnly(input, badChars) {
      const cleaned = input.value.replace(badChars, '');
      if (cleaned !== input.value) input.value = cleaned;
    }

    $$('[data-disclaimer]').forEach(p => { p.textContent = plan.disclaimer; });
    $('#reminder-line').textContent =
      'Below ' + plan.injectAfterEatingBelow + ' mg/dL: inject after eating · ' +
      'Exercise: reduce by ' + plan.exerciseReductionUnits + ' u (not included) · ' +
      'Hypo: ' + plan.hypoRapidCarbsGrams + ' g rapid carbs';
    const reminderUl = $('#reminder-list');
    api.reminderList(plan).forEach(text => reminderUl.append(el('li', { text })));
    reminderUl.append(el('li', { class: 'strong', text: plan.disclaimer }));
    $('#auto-clear-note').textContent = plan.autoClearAfterMinutes > 0
      ? 'The app also clears itself if it has been in the background for ' + plan.autoClearAfterMinutes + ' minutes or more.'
      : '';

    buildPlanTab();

    $('#clear').addEventListener('click', clearAll);

    /* ---------- tabs ---------- */
    const tabButtons = $$('.tabbar button');
    tabButtons.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
    function showTab(id) {
      $$('.tab').forEach(section => { section.hidden = section.id !== 'tab-' + id; });
      tabButtons.forEach(btn => btn.setAttribute('aria-current', btn.dataset.tab === id ? 'page' : 'false'));
      window.scrollTo(0, 0);
    }

    // Hide the bottom tab bar while the keyboard is up.
    document.addEventListener('focusin', e => {
      if (e.target.matches('input')) document.body.classList.add('typing');
    });
    document.addEventListener('focusout', () => document.body.classList.remove('typing'));

    // Never reuse an old reading: clear after a long time in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        // Check for a new version each time the app comes back to the front.
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistration().then(reg => reg && reg.update()).catch(() => {});
        }
        const minutesAway = (Date.now() - hiddenAt) / 60000;
        hiddenAt = null;
        if (plan.autoClearAfterMinutes > 0 && minutesAway >= plan.autoClearAfterMinutes) clearAll();
      }
    });

    render();
    registerServiceWorker();

    /* ---------- functions ---------- */

    function readInputs() {
      return {
        meal: state.meal,
        reading: reading.value,
        arrow: state.arrow,
        foods: foodInputs.map(f => ({ name: f.name.value, carbs: f.carbs.value }))
      };
    }

    function hasInput() {
      return reading.value.trim() !== '' || state.arrow !== null ||
        foodInputs.some(f => f.name.value.trim() !== '' || f.carbs.value.trim() !== '');
    }

    function clearAll() {
      reading.value = '';
      state.arrow = null;
      foodInputs.forEach(f => { f.name.value = ''; f.carbs.value = ''; });
      state.meal = api.mealTimeForClock(new Date(), plan);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      render();
      window.scrollTo(0, 0);
    }

    function setUnits(node, n) {
      node.textContent = '';
      node.classList.remove('is-empty', 'is-nofood');
      if (n === null) {
        node.classList.add('is-empty');
        node.textContent = '–';
        return;
      }
      node.append(el('span', {}, [
        el('span', { class: 'num', text: api.signedNumber(n) }),
        el('span', { class: 'u', text: ' u' })
      ]));
    }

    function render() {
      const res = api.calculate(readInputs(), plan);

      $$('#meal-buttons button').forEach(btn => btn.setAttribute('aria-checked', String(btn.dataset.meal === res.meal)));

      const box = $('#reading-box');
      if (res.readingColour) {
        box.style.setProperty('--box-bg', res.readingColour.bg);
        box.style.setProperty('--box-fg', res.readingColour.fg);
        box.dataset.colour = res.readingColour.name;
      } else {
        box.style.removeProperty('--box-bg');
        box.style.removeProperty('--box-fg');
        delete box.dataset.colour;
      }

      $$('#arrow-buttons button').forEach(btn => btn.setAttribute('aria-checked', String(btn.dataset.arrow === res.arrow)));
      const arrowBox = $('#arrow-box');
      if (res.arrowColour) {
        arrowBox.style.setProperty('--arrow-bg', res.arrowColour.bg);
        arrowBox.classList.add('has-arrow');
      } else {
        arrowBox.style.removeProperty('--arrow-bg');
        arrowBox.classList.remove('has-arrow');
      }

      setUnits($('#correction'), res.correction);

      const banner = $('#message');
      if (res.message) {
        const colours = plan.messageColours[res.message.tone];
        banner.textContent = res.message.text;
        banner.dataset.key = res.message.key;
        banner.style.setProperty('--banner-bg', colours.bg);
        banner.style.setProperty('--banner-fg', colours.fg);
        banner.hidden = false;
      } else {
        banner.textContent = '';
        delete banner.dataset.key;
        banner.hidden = true;
      }

      res.foods.forEach((food, i) => {
        const out = foodInputs[i].dose;
        if (food.dose === null) {
          out.textContent = 'No food';
          out.classList.remove('is-empty');
          out.classList.add('is-nofood');
        } else {
          setUnits(out, food.dose);
        }
      });

      setUnits($('#total'), res.total);

      const ketone = $('#ketone-note');
      ketone.hidden = !res.checkKetones;
      ketone.textContent = res.checkKetones
        ? 'Check ketones: glucose is over ' + plan.ketonesAbove + ' mg/dL (particularly if unwell).'
        : '';

      // Highlight what is being used on the Plan tab.
      $$('#tab-plan [data-meal]').forEach(cell => cell.classList.toggle('is-current', cell.dataset.meal === res.meal));
      $$('#tab-plan tr[data-from]').forEach(row => row.classList.toggle('is-used', !!res.band && row.dataset.from === String(res.band.from)));
      $$('#tab-plan tr[data-arrow]').forEach(row => row.classList.toggle('is-used', row.dataset.arrow === (res.arrow || 'none')));
    }

    function buildPlanTab() {
      const root = $('#plan-content');
      // Full meal names, with short ones for narrow phones (switched in style.css).
      const mealHead = plan.meals.map(m => el('th', { scope: 'col', 'data-meal': m.id, 'aria-label': m.label }, [
        el('span', { class: 'long', text: m.label }),
        el('span', { class: 'short', 'aria-hidden': 'true', text: m.short || m.label })
      ]));

      function card(title, children, note) {
        const kids = [el('h3', { text: title })];
        if (note) kids.push(el('p', { class: 'note', text: note }));
        return el('section', { class: 'card' }, kids.concat(children));
      }
      function table(headCells, rows) {
        return el('div', { class: 'table-wrap' }, [
          el('table', { class: 'plan-table' }, [
            el('thead', {}, [el('tr', {}, headCells)]),
            el('tbody', {}, rows)
          ])
        ]);
      }
      const cloneHead = () => mealHead.map(th => th.cloneNode(true));

      root.append(el('section', { class: 'card plan-intro' }, [
        el('p', { class: 'plan-name', text: plan.planTitle }),
        el('p', { text: 'Plan dated ' + plan.planDate + ' · Rapid insulin: ' + plan.rapidInsulin }),
        el('p', { class: 'note', text: 'Read-only. Compare with the written plan you have now. The highlighted column is the meal time chosen on the Calculator.' })
      ]));

      root.append(card('Insulin-to-carb ratio', [
        table([el('th', { scope: 'col', text: '' })].concat(cloneHead()), [
          el('tr', {}, [el('th', { scope: 'row', text: 'Grams per 1 unit' })].concat(
            plan.meals.map(m => el('td', { 'data-meal': m.id, text: String(plan.carbRatio[m.id]) }))))
        ])
      ]));

      root.append(card('Carbs → dose (units)', [
        table([el('th', { scope: 'col', text: 'Carbs (g)' })].concat(cloneHead()),
          plan.carbTableRows.map(g => el('tr', {}, [el('th', { scope: 'row', text: String(g) })].concat(
            plan.meals.map(m => el('td', { 'data-meal': m.id, text: String(api.roundHalfUp(g / plan.carbRatio[m.id])) }))))))
      ], 'Carbs ÷ ratio, rounded to the nearest unit (.5 rounds up). A food row needs both a name and carbs.'));

      root.append(card('Glucose correction (units)', [
        table([el('th', { scope: 'col', text: 'Glucose (mg/dL)' })].concat(cloneHead()),
          plan.correctionTable.map(row => el('tr', { 'data-from': String(row.from) }, [el('th', { scope: 'row', text: row.label })].concat(
            plan.meals.map(m => el('td', { 'data-meal': m.id, text: String(row[m.id]) }))))))
      ], 'The highlighted row is the one used for the current reading.'));

      root.append(card('Trend arrow adjustment', [
        table([el('th', { scope: 'col', text: 'Arrow' }), el('th', { scope: 'col', text: 'Change' }), el('th', { scope: 'col', text: 'Colour' })],
          plan.arrows.map(a => {
            const swatch = el('span', { class: 'swatch', text: a.colourName });
            swatch.style.setProperty('--sw-bg', a.bg);
            swatch.style.setProperty('--sw-fg', a.fg);
            return el('tr', { 'data-arrow': a.id }, [
              el('th', { scope: 'row', class: 'arrow-cell', text: a.symbol }),
              el('td', { text: api.signedNumber(a.adjust, true) + ' u' }),
              el('td', {}, [swatch])
            ]);
          }).concat([el('tr', { 'data-arrow': 'none' }, [
            el('th', { scope: 'row', text: 'No arrow' }), el('td', { text: '0 u' }), el('td', { text: '' })
          ])]))
      ], 'Added to the correction dose. The result can be below zero.'));

      root.append(card('Blood sugar colours', [
        table([el('th', { scope: 'col', text: 'Reading (mg/dL)' }), el('th', { scope: 'col', text: 'Colour' })],
          plan.readingColours.map(c => {
            const swatch = el('span', { class: 'swatch', text: c.name });
            swatch.style.setProperty('--sw-bg', c.bg);
            swatch.style.setProperty('--sw-fg', c.fg);
            return el('tr', {}, [el('th', { scope: 'row', text: c.label }), el('td', {}, [swatch])]);
          }))
      ]));

      root.append(card('Not included in the calculation', [
        el('ul', { class: 'reminders' }, [
          el('li', { text: 'Hypoglycaemia: ' + plan.hypoRapidCarbsGrams + ' g rapid carbs.' }),
          el('li', { text: 'Before exercise: reduce insulin by ' + plan.exerciseReductionUnits + ' units.' }),
          el('li', { text: 'Check ketones if glucose is over ' + plan.ketonesAbove + ' mg/dL, particularly if unwell.' }),
          el('li', { text: 'Long-acting insulin: ' + plan.longActingInsulin + ' (follow the written plan).' })
        ])
      ]));
    }

    function registerServiceWorker() {
      if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;          // first install: nothing to refresh
        if (!hasInput()) { reloading = true; location.reload(); return; }
        $('#update-bar').hidden = false;                  // don't wipe numbers being typed
      });
      $('#update-bar').addEventListener('click', () => location.reload());
      navigator.serviceWorker.register('./service-worker.js').catch(() => { /* offline or unsupported */ });
    }
  }
})();
