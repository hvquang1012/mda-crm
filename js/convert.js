// ============================================================
// Nhận diện định dạng ảnh và chuyển HEIC / RAW (DNG) về dạng trình
// duyệt vẽ được, để js/photos.js nén và upload như ảnh JPEG thường.
//
// Vì sao cần: iPhone mặc định chụp HEIC, chế độ ProRAW cho ra DNG.
// Chrome/Edge trên máy tính KHÔNG mở được cả hai — <img> và
// createImageBitmap đều thất bại, nên toàn bộ báo cáo hỏng theo.
//
// Hai đường xử lý khác nhau, cố ý không dùng chung một thư viện:
//   HEIC → giải mã bằng vendor/libheif@1.18.2.js (WebAssembly, ~960KB,
//          chỉ tải khi thật sự gặp ảnh HEIC — máy iPhone thường tự mở
//          được nên phần lớn người dùng không bao giờ tải file này).
//   DNG  → KHÔNG giải mã raw (cần thư viện vài MB và rất chậm). File
//          DNG của iPhone luôn nhúng sẵn một ảnh JPEG xem trước cỡ lớn;
//          ta bóc ảnh đó ra là đủ dùng cho ảnh hiện trường.
// ============================================================

// ---- Nhận diện bằng byte đầu file, không tin vào đuôi tên hay MIME ----
// Windows đặt type rỗng cho .dng, Zalo/OneDrive đổi tên file lung tung.
export async function sniffImageFormat(file) {
  let head;
  try {
    head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  } catch (e) { return 'unknown'; }
  if (head.length < 12) return 'unknown';

  const ascii = (start, len) => String.fromCharCode(...head.slice(start, start + len));

  if (head[0] === 0xFF && head[1] === 0xD8) return 'jpeg';
  if (head[0] === 0x89 && ascii(1, 3) === 'PNG') return 'png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (ascii(0, 2) === 'BM') return 'bmp';

  // ISOBMFF: [4 byte size]'ftyp'[brand]. HEIC, AVIF và cả video MOV đều
  // dùng khung này nên phải xem brand mới biết.
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand)) return 'heic';
    if (brand === 'avif' || brand === 'avis') return 'avif';
    return 'unknown';
  }

  // TIFF — cũng là khung của DNG (iPhone ProRAW), CR2, NEF, ARW...
  const le = head[0] === 0x49 && head[1] === 0x49;
  const be = head[0] === 0x4D && head[1] === 0x4D;
  if ((le || be) && (le ? head[2] === 0x2A && head[3] === 0x00 : head[2] === 0x00 && head[3] === 0x2A)) return 'tiff';

  return 'unknown';
}

export const FORMAT_LABEL = {
  heic: 'HEIC (iPhone)', tiff: 'RAW/DNG', avif: 'AVIF',
  jpeg: 'JPEG', png: 'PNG', webp: 'WebP', bmp: 'BMP'
};

// ============================================================
// EXIF — ngày giờ chụp gốc
// ============================================================

// Đọc DateTimeOriginal từ một khối TIFF bắt đầu tại tiffStart.
// Dùng chung cho JPEG (khối Exif trong APP1), HEIC (item Exif) và DNG
// (bản thân file đã là TIFF) — cùng một cấu trúc IFD.
export function parseTiffDate(view, tiffStart) {
  try {
    const little = view.getUint16(tiffStart) === 0x4949;
    const readU16 = o => view.getUint16(o, little);
    const readU32 = o => view.getUint32(o, little);
    const ifdOffset = tiffStart + readU32(tiffStart + 4);
    if (ifdOffset + 2 > view.byteLength) return null;

    const readDate = (offset) => {
      let str = '';
      for (let j = 0; j < 19 && offset + j < view.byteLength; j++) str += String.fromCharCode(view.getUint8(offset + j));
      const m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
    };

    const scanIfd = (ifd, tags) => {
      const entries = readU16(ifd);
      const found = {};
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > view.byteLength) break;
        const tag = readU16(e);
        if (tags.includes(tag)) found[tag] = readU32(e + 8);
      }
      return found;
    };

    // IFD0: 0x8769 = con trỏ tới Exif IFD, 0x0132 = DateTime (dự phòng)
    const ifd0 = scanIfd(ifdOffset, [0x8769, 0x0132]);
    if (ifd0[0x8769] != null) {
      const exifIfd = tiffStart + ifd0[0x8769];
      if (exifIfd + 2 <= view.byteLength) {
        // 0x9003 DateTimeOriginal, 0x9004 DateTimeDigitized
        const ex = scanIfd(exifIfd, [0x9003, 0x9004]);
        const off = ex[0x9003] ?? ex[0x9004];
        if (off != null) {
          const d = readDate(tiffStart + off);
          if (d) return d;
        }
      }
    }
    if (ifd0[0x0132] != null) return readDate(tiffStart + ifd0[0x0132]);
  } catch (e) { /* file cắt cụt hoặc EXIF hỏng — coi như không có */ }
  return null;
}

function indexOfBytes(hay, needle, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

// Ngày chụp gốc, best-effort. Trả Date hoặc null.
// JPEG/HEIC: tìm chuỗi "Exif\0\0" rồi đọc khối TIFF ngay sau nó.
// DNG/TIFF : đọc thẳng từ byte 0.
export async function readTakenAt(file, format) {
  try {
    const fmt = format || await sniffImageFormat(file);
    if (fmt === 'tiff') {
      const buf = await file.slice(0, 256 * 1024).arrayBuffer();
      return parseTiffDate(new DataView(buf), 0);
    }
    // 1MB đầu đủ phủ khối metadata của JPEG lẫn HEIC iPhone; quét cả
    // file 5MB chỉ để tìm ngày chụp là không đáng.
    const buf = await file.slice(0, 1024 * 1024).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);

    // Đường chính: "Exif\0\0" rồi tới khối TIFF — đúng cho JPEG (APP1)
    // và cho HEIC của iPhone (item Exif giữ nguyên tiền tố này).
    const at = indexOfBytes(bytes, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
    if (at >= 0) {
      const d = parseTiffDate(view, at + 6);
      if (d) return d;
    }

    // Dự phòng cho máy ghi HEIC không kèm tiền tố: dò thẳng chữ ký TIFF.
    // parseTiffDate tự trả null nếu trúng byte rác nên dò vài chỗ là an toàn.
    let from = 0;
    for (let tried = 0; tried < 8; tried++) {
      const ii = indexOfBytes(bytes, [0x49, 0x49, 0x2A, 0x00], from);
      const mm = indexOfBytes(bytes, [0x4D, 0x4D, 0x00, 0x2A], from);
      const next = ii < 0 ? mm : (mm < 0 ? ii : Math.min(ii, mm));
      if (next < 0) break;
      const d = parseTiffDate(view, next);
      if (d) return d;
      from = next + 4;
    }
    return null;
  } catch (e) { return null; }
}

// ============================================================
// DNG / RAW → bóc ảnh JPEG xem trước nhúng bên trong
// ============================================================

// Duyệt cây IFD của TIFF, gom mọi ảnh JPEG nhúng rồi lấy cái lớn nhất.
// iPhone ProRAW để bản xem trước cỡ đầy đủ trong một SubIFD, còn IFD1
// thường chỉ là thumbnail 256px — lấy nhầm là ảnh vỡ nhoè.
function collectEmbeddedJpegs(view, bytes) {
  const little = view.getUint16(0) === 0x4949;
  const readU16 = o => view.getUint16(o, little);
  const readU32 = o => view.getUint32(o, little);
  const out = [];
  const seen = new Set();

  const walk = (ifdOffset, depth) => {
    if (depth > 4 || ifdOffset <= 0 || ifdOffset + 2 > view.byteLength || seen.has(ifdOffset)) return;
    seen.add(ifdOffset);
    const entries = readU16(ifdOffset);
    if (entries > 512) return; // IFD hỏng
    let jpegOffset = null, jpegLength = null, stripOffset = null, stripBytes = null, compression = null;
    const subIfds = [];

    for (let i = 0; i < entries; i++) {
      const e = ifdOffset + 2 + i * 12;
      if (e + 12 > view.byteLength) return;
      const tag = readU16(e);
      const type = readU16(e + 2);
      const count = readU32(e + 4);
      const valueAt = e + 8;
      const inline = (type === 3 ? 2 : 4) * count <= 4; // giá trị nhỏ nằm ngay trong entry
      const first = type === 3 ? readU16(valueAt) : readU32(valueAt);

      if (tag === 0x0103) compression = first;                       // Compression (7 = JPEG)
      else if (tag === 0x0201) jpegOffset = first;                   // JPEGInterchangeFormat
      else if (tag === 0x0202) jpegLength = first;                   // ...Length
      else if (tag === 0x0111 && count === 1) stripOffset = first;   // StripOffsets
      else if (tag === 0x0117 && count === 1) stripBytes = first;    // StripByteCounts
      else if (tag === 0x014A) {                                     // SubIFDs
        if (inline) subIfds.push(first);
        else {
          const base = readU32(valueAt);
          for (let k = 0; k < Math.min(count, 16); k++) subIfds.push(readU32(base + k * 4));
        }
      }
    }

    if (jpegOffset && jpegLength) out.push({ offset: jpegOffset, length: jpegLength });
    if (compression === 7 && stripOffset && stripBytes) out.push({ offset: stripOffset, length: stripBytes });

    for (const s of subIfds) walk(s, depth + 1);
    walk(readU32(ifdOffset + 2 + entries * 12), depth + 1); // IFD kế tiếp
  };

  walk(readU32(4), 0);

  return out.filter(c =>
    c.offset > 0 && c.length > 1024 && c.offset + c.length <= bytes.length &&
    bytes[c.offset] === 0xFF && bytes[c.offset + 1] === 0xD8   // phải bắt đầu bằng SOI
  );
}

// Phương án cuối khi cây IFD không theo chuẩn: quét thẳng chuỗi byte
// tìm đoạn FFD8FF...FFD9 dài nhất.
function scanLargestJpeg(bytes) {
  let best = null;
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] !== 0xFF || bytes[i + 1] !== 0xD8 || bytes[i + 2] !== 0xFF) continue;
    for (let j = i + 3; j < bytes.length - 1; j++) {
      if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
        const len = j + 2 - i;
        if (!best || len > best.length) best = { offset: i, length: len };
        i = j + 1;
        break;
      }
    }
  }
  return best && best.length > 1024 ? best : null;
}

// Trả Blob JPEG bóc từ file RAW, hoặc null nếu không có ảnh nhúng.
export async function extractPreviewJpeg(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  let candidates = [];
  try { candidates = collectEmbeddedJpegs(view, bytes); } catch (e) { candidates = []; }
  let best = candidates.sort((a, b) => b.length - a.length)[0] || null;
  if (!best) best = scanLargestJpeg(bytes);
  if (!best) return null;

  return new Blob([bytes.subarray(best.offset, best.offset + best.length)], { type: 'image/jpeg' });
}

// ============================================================
// HEIC → canvas, giải mã bằng libheif (WebAssembly)
// ============================================================

let heifLibPromise = null;

function loadHeifLib() {
  if (heifLibPromise) return heifLibPromise;
  heifLibPromise = (async () => {
    const base = new URL('../vendor/', import.meta.url);
    if (!window.libheif) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL('libheif@1.18.2.js', base).href;
        s.onload = resolve;
        s.onerror = () => reject(new Error('không tải được bộ giải mã, kiểm tra mạng'));
        document.head.appendChild(s);
      });
    }
    let lib = window.libheif;
    if (typeof lib === 'function') {
      // Bản wasm mặc định nạp file .wasm bằng XHR đồng bộ — trình duyệt
      // chặn cách này trên luồng chính. Tải sẵn rồi đưa vào wasmBinary.
      const wasm = await fetch(new URL('libheif.wasm', base).href).then(r => {
        if (!r.ok) throw new Error('thiếu file libheif.wasm trên máy chủ');
        return r.arrayBuffer();
      });
      lib = lib({ wasmBinary: wasm });
    }
    lib = await lib;
    if (!lib || !lib.HeifDecoder) throw new Error('bộ giải mã HEIC không khởi động được');
    return lib;
  })().catch(err => { heifLibPromise = null; throw err; });   // cho phép thử lại lần sau
  return heifLibPromise;
}

// Trả về <canvas> đã vẽ sẵn ảnh (drawImage dùng được như <img>).
export async function heicToCanvas(file) {
  const lib = await loadHeifLib();
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
  if (!images || !images.length) throw new Error('ảnh HEIC không đọc được nội dung');

  // File HEIC của iPhone chứa nhiều ảnh (ảnh chính + bản xem trước, hoặc
  // các khung Live Photo). Lấy tấm lớn nhất, không lấy tấm đầu tiên.
  const image = images.reduce((a, b) =>
    (b.get_width() * b.get_height() > a.get_width() * a.get_height() ? b : a));
  const width = image.get_width();
  const height = image.get_height();
  if (!width || !height) throw new Error('ảnh HEIC không có kích thước hợp lệ');

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);

  await new Promise((resolve, reject) => {
    image.display(imageData, (data) => data ? resolve() : reject(new Error('Giải mã ảnh HEIC thất bại')));
  });
  ctx.putImageData(imageData, 0, 0);

  // Giải phóng bộ nhớ WebAssembly ngay — ảnh 12MP chiếm ~48MB, để lại
  // vài tấm là tab treo trên điện thoại.
  for (const im of images) { try { im.free?.(); } catch (e) { /* bản cũ không có free */ } }

  return canvas;
}
