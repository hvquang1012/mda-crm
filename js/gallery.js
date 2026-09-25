// ============================================================
// Khung ảnh báo cáo dùng chung (hộp duyệt, vướng mắc). Bố cục theo số ảnh:
//   1 ảnh   → ảnh lớn 4:3
//   4 ảnh   → lưới 2×2 khe mỏng
//   còn lại → slide vuốt ngang (scroll-snap), chấm + nhãn "1/n";
//             trên máy tính 2–3 ảnh xếp thành 1 hàng, ≥5 ảnh có nút ‹ ›.
// Chỉ dựng khung + <img> rỗng; nơi gọi vẫn tự gán src (URL ký) và
// onclick mở lightbox như trước — module này không biết URL ảnh.
// ============================================================
const MAX_DOTS = 7;

// imgAttrs(i) → chuỗi thuộc tính cho ảnh thứ i (data-*, alt) — nơi gọi tự escape
export function galleryHtml(n, imgAttrs) {
  if (!n) return '';
  const img = i => `<img ${imgAttrs(i)} loading="lazy" decoding="async" draggable="false">`;
  const idx = [...Array(n).keys()];
  if (n === 1) return `<div class="pg pg-single">${img(0)}</div>`;
  if (n === 4) return `<div class="pg pg-grid4">${idx.map(img).join('')}</div>`;
  return `
    <div class="pg pg-slider" data-n="${n}">
      <div class="pg-track">${idx.map(i => `<div class="pg-slide">${img(i)}</div>`).join('')}</div>
      <span class="pg-count" aria-hidden="true">1/${n}</span>
      ${n <= MAX_DOTS ? `<div class="pg-dots" aria-hidden="true">${idx.map(i => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>` : ''}
      <button type="button" class="pg-nav prev" aria-label="Ảnh trước" hidden>‹</button>
      <button type="button" class="pg-nav next" aria-label="Ảnh sau">›</button>
    </div>`;
}

export function wireGalleries(root) {
  root.querySelectorAll('.pg img').forEach(im => {
    const done = () => im.classList.add('loaded');
    if (im.complete && im.naturalWidth) done(); else im.addEventListener('load', done, { once: true });
  });
  root.querySelectorAll('.pg-slider').forEach(wireSlider);
}

function wireSlider(pg) {
  if (pg.dataset.wired) return;
  pg.dataset.wired = '1';
  const track = pg.querySelector('.pg-track');
  const slides = [...track.children];
  const count = pg.querySelector('.pg-count');
  const dots = [...pg.querySelectorAll('.pg-dots i')];
  const prev = pg.querySelector('.pg-nav.prev');
  const next = pg.querySelector('.pg-nav.next');
  const step = () => (slides[1] ? slides[1].offsetLeft - slides[0].offsetLeft : track.clientWidth);

  let raf = 0;
  const update = () => {
    raf = 0;
    const max = track.scrollWidth - track.clientWidth;
    // Cuộn tới sát cuối thì coi là ảnh cuối (ảnh cuối không căn trái được hết)
    const i = track.scrollLeft >= max - 2 ? slides.length - 1 : Math.round(track.scrollLeft / step());
    count.textContent = `${i + 1}/${slides.length}`;
    dots.forEach((d, j) => d.classList.toggle('on', j === i));
    prev.hidden = track.scrollLeft <= 2;
    next.hidden = track.scrollLeft >= max - 2;
  };
  track.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  prev.onclick = () => track.scrollBy({ left: -step(), behavior: 'smooth' });
  next.onclick = () => track.scrollBy({ left: step(), behavior: 'smooth' });
  // Panel đang ẩn lúc dựng → kích thước 0; đo lại khi hiện ra / đổi cỡ màn hình
  if (window.ResizeObserver) new ResizeObserver(() => update()).observe(track);
  update();
}
