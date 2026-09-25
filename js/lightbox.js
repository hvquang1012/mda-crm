// ============================================================
// Xem ảnh toàn màn hình, vuốt trái/phải hoặc phím ← → để chuyển ảnh.
// Dùng chung cho hộp duyệt và vướng mắc (staff). Tự dựng DOM lần đầu
// gọi, không cần thêm HTML vào index.html.
// ============================================================
let box, img, counter, urls = [], idx = 0;

function ensureDom() {
  if (box) return;
  box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `
    <button type="button" class="lb-btn lb-close" aria-label="Đóng">✕</button>
    <button type="button" class="lb-btn lb-prev" aria-label="Ảnh trước">‹</button>
    <img alt="ảnh hiện trường">
    <button type="button" class="lb-btn lb-next" aria-label="Ảnh sau">›</button>
    <div class="lb-counter"></div>`;
  document.body.appendChild(box);
  img = box.querySelector('img');
  counter = box.querySelector('.lb-counter');
  box.querySelector('.lb-close').onclick = close;
  box.querySelector('.lb-prev').onclick = (e) => { e.stopPropagation(); go(-1); };
  box.querySelector('.lb-next').onclick = (e) => { e.stopPropagation(); go(1); };
  box.onclick = (e) => { if (e.target === box) close(); };

  let startX = null;
  box.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    startX = null;
  });
  document.addEventListener('keydown', e => {
    if (!box.classList.contains('show')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  });
}

function render() {
  img.src = urls[idx] || '';
  counter.textContent = urls.length > 1 ? `${idx + 1} / ${urls.length}` : '';
  box.querySelector('.lb-prev').hidden = urls.length < 2;
  box.querySelector('.lb-next').hidden = urls.length < 2;
}
function go(step) {
  if (!urls.length) return;
  idx = (idx + step + urls.length) % urls.length;
  render();
}
function close() { box.classList.remove('show'); img.src = ''; }

// list: mảng URL (có thể còn null nếu ảnh chưa ký xong — bị bỏ qua)
export function openLightbox(list, start = 0) {
  ensureDom();
  urls = list.filter(Boolean);
  if (!urls.length) return;
  idx = Math.min(Math.max(0, list.slice(0, start).filter(Boolean).length), urls.length - 1);
  render();
  box.classList.add('show');
}
