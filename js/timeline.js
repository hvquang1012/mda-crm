// ============================================================
// Timeline/Gantt rút gọn dùng chung cho giao diện.
// Chỉ tính toán + sinh HTML, không gọi Supabase và không giữ state.
// ============================================================
import { displayDate, escapeHtml } from './ui.js';

const DAY_MS = 86400000;

export function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(stamp / DAY_MS);
}

function localTodayDay() {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

function dayDate(day) {
  return new Date(day * DAY_MS);
}

function dayLabel(day) {
  const date = dayDate(day);
  return `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
}

export function makeWindow(project, rows) {
  const starts = [parseDay(project?.start_date), ...(rows || []).map(row => parseDay(row.start))]
    .filter(Number.isInteger);
  const ends = [parseDay(project?.end_date), ...(rows || []).map(row => parseDay(row.end))]
    .filter(Number.isInteger);
  if (!starts.length || !ends.length) return null;

  let from = Math.min(...starts) - 3;
  let to = Math.max(...ends) + 3;
  if (to < from) return null;
  const currentDays = to - from + 1;
  if (currentDays < 14) {
    const missing = 14 - currentDays;
    from -= Math.floor(missing / 2);
    to += Math.ceil(missing / 2);
  }
  return { from, to, days: to - from + 1 };
}

export function barGeometry(startValue, endValue, window) {
  const start = parseDay(startValue);
  const end = parseDay(endValue);
  if (!window || start == null || end == null || end < start) return null;

  const visibleStart = Math.max(start, window.from);
  const visibleEnd = Math.min(end, window.to);
  if (visibleEnd < visibleStart) return null;

  const left = 100 * (visibleStart - window.from) / window.days;
  const right = 100 * (visibleEnd - window.from + 1) / window.days;
  return {
    left: Math.max(0, Math.min(100, left)),
    width: Math.max(0, Math.min(100, right) - Math.max(0, left))
  };
}

export function expectedProgress(row, today = localTodayDay()) {
  const start = parseDay(row?.start);
  const end = parseDay(row?.end);
  const qtyPlan = Number(row?.qtyPlan);
  const qtyDone = Number(row?.qtyDone || 0);
  if (start == null || end == null || end < start || !(qtyPlan > 0)) return null;
  if (row.status === 'done' || today < start) return null;

  const totalDays = Math.max(end - start, 1);
  const elapsedDays = Math.max(today - start, 0);
  const expectedPct = Math.min(100, 100 * elapsedDays / totalDays);
  const actualPct = 100 * qtyDone / qtyPlan;
  return { expectedPct, actualPct, gap: expectedPct - actualPct };
}

export function makeTicks(window) {
  if (!window) return [];
  const ticks = [];
  if (window.days < 45) {
    for (let day = window.from; day <= window.to; day += 7) {
      ticks.push({ day, label: dayLabel(day) });
    }
  } else {
    const first = dayDate(window.from);
    ticks.push({ day: window.from, label: `Th${first.getUTCMonth() + 1}` });
    let year = first.getUTCFullYear();
    let month = first.getUTCMonth() + 1;
    while (true) {
      if (month > 11) { month = 0; year += 1; }
      const day = Math.floor(Date.UTC(year, month, 1) / DAY_MS);
      if (day > window.to) break;
      if (day > window.from) ticks.push({ day, label: `Th${month + 1}` });
      month += 1;
    }
  }
  return ticks.map(tick => ({
    ...tick,
    left: 100 * (tick.day - window.from) / window.days
  }));
}

function clampPercent(value) {
  const number = Number(value || 0);
  return Math.max(0, Math.min(100, Number.isFinite(number) ? number : 0));
}

function visualState(row, expected, today) {
  if (row.status === 'done' || clampPercent(row.percent) >= 100) {
    return { className: 'is-done', label: 'Hoàn thành', signalClass: 'done' };
  }
  // Quá hạn kế hoạch là tín hiệu quan trọng nhất — phải hiện được kể cả khi
  // đầu việc không có qty_plan (nên expectedProgress() trả null) hoặc khi
  // expectedPct đã bị Math.min(100,...) che mất phần trễ thêm. Không được
  // kẹp/bỏ qua tín hiệu này (xem AGENTS.md mục 3 về daysUntil()).
  const end = parseDay(row.end);
  if (end != null && today > end) {
    return { className: 'is-delayed', label: `Trễ ${today - end} ngày`, signalClass: 'delayed' };
  }
  if (expected?.gap > 20) {
    return { className: 'is-delayed', label: `Chậm ${Math.round(expected.gap)}%`, signalClass: 'delayed' };
  }
  if (expected?.gap > 10) {
    return { className: 'is-warning', label: `Chậm ${Math.round(expected.gap)}%`, signalClass: 'warning' };
  }
  if (expected && expected.actualPct > expected.expectedPct + 10) {
    return { className: 'is-ahead', label: `Vượt ${Math.round(expected.actualPct - expected.expectedPct)}%`, signalClass: 'ahead' };
  }
  const start = parseDay(row.start);
  if (clampPercent(row.percent) === 0 && start != null && today < start) {
    return { className: 'is-not-started', label: 'Chưa bắt đầu', signalClass: '' };
  }
  return { className: 'is-on-track', label: 'Đúng kế hoạch', signalClass: '' };
}

function renderTickLines(ticks) {
  return ticks.map(tick => `<span class="timeline-tick" style="left:${tick.left.toFixed(3)}%"></span>`).join('');
}

function renderRow(row, window, ticks, today) {
  const geometry = barGeometry(row.start, row.end, window);
  if (!geometry) return '';
  const expected = expectedProgress(row, today);
  const visual = visualState(row, expected, today);
  const fill = clampPercent(row.percent);
  const expectedMarker = expected
    ? `<span class="timeline-expected" style="--tl-expected:${clampPercent(expected.expectedPct).toFixed(2)}%"></span>`
    : '';
  const todayLeft = today >= window.from && today <= window.to
    ? 100 * (today - window.from + 0.5) / window.days
    : null;
  const todayLine = todayLeft == null ? '' : `<span class="timeline-today" style="left:${todayLeft.toFixed(3)}%"></span>`;
  const meta = `${displayDate(row.start)} → ${displayDate(row.end)}${row.meta ? ` · ${escapeHtml(row.meta)}` : ''}`;
  const aria = `${row.name}, ${fill} phần trăm, ${visual.label}, từ ${displayDate(row.start)} đến ${displayDate(row.end)}`;

  return `
    <button type="button" class="timeline-row ${visual.className}" data-item-id="${escapeHtml(row.id)}" aria-label="${escapeHtml(aria)}">
      <span class="timeline-row-head">
        <span class="timeline-row-name">${escapeHtml(row.name)}</span>
        <span class="timeline-row-pct">${Math.round(fill)}%</span>
      </span>
      <span class="timeline-track">
        ${renderTickLines(ticks)}${todayLine}
        <span class="timeline-bar" style="--tl-left:${geometry.left.toFixed(3)}%;--tl-width:${geometry.width.toFixed(3)}%">
          <span class="timeline-fill" style="--tl-fill:${fill.toFixed(2)}%"></span>${expectedMarker}
        </span>
      </span>
      <span class="timeline-row-meta">
        <span>${meta}</span>
        <span class="timeline-signal ${visual.signalClass}">${escapeHtml(visual.label)}</span>
      </span>
    </button>`;
}

export function renderTimeline(groups, { project, today = localTodayDay() } = {}) {
  const allRows = (groups || []).flatMap(group => group.rows || []);
  const window = makeWindow(project, allRows);
  if (!window) return '<div class="timeline-error">Dự án chưa có khung ngày hợp lệ.</div>';

  const ticks = makeTicks(window);
  const todayLeft = today >= window.from && today <= window.to
    ? 100 * (today - window.from + 0.5) / window.days
    : null;
  const axis = `
    <div class="timeline-axis" aria-hidden="true">
      ${ticks.map(tick => `<span class="timeline-axis-label" style="left:${tick.left.toFixed(3)}%">${escapeHtml(tick.label)}</span>`).join('')}
      ${todayLeft == null ? '' : `<span class="timeline-today-label" style="left:${todayLeft.toFixed(3)}%">Hôm nay</span>`}
    </div>`;

  const unscheduled = [];
  const renderedGroups = (groups || []).map(group => {
    const scheduledRows = [];
    (group.rows || []).forEach(row => {
      if (barGeometry(row.start, row.end, window)) scheduledRows.push(row);
      else unscheduled.push({ ...row, groupTitle: group.title });
    });
    if (!scheduledRows.length) return '';
    return `
      <section class="timeline-group">
        <div class="timeline-group-head">
          <div>
            <div class="timeline-group-title">${escapeHtml(group.title)}</div>
            ${group.subtitle ? `<div class="timeline-group-subtitle">${escapeHtml(group.subtitle)}</div>` : ''}
          </div>
        </div>
        ${scheduledRows.map(row => renderRow(row, window, ticks, today)).join('')}
      </section>`;
  }).join('');

  const unscheduledHtml = unscheduled.length ? `
    <section class="timeline-unscheduled-wrap">
      <div class="timeline-unscheduled-title">Chưa lên lịch (${unscheduled.length})</div>
      ${unscheduled.map(row => `
        <button type="button" class="timeline-unscheduled" data-item-id="${escapeHtml(row.id)}">
          <span>${escapeHtml(row.name)} <small>· ${escapeHtml(row.groupTitle)}</small></span>
          <small>Đặt ngày →</small>
        </button>`).join('')}
    </section>` : '';

  return `<div class="timeline">${axis}${renderedGroups || '<div class="empty-hint">Chưa có đầu việc đã lên lịch.</div>'}${unscheduledHtml}</div>`;
}
