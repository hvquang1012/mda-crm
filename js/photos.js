// ============================================================
// Nén ảnh phía client + đọc ngày chụp gốc (EXIF) + upload lên Storage
// qua signed URL cấp bởi Edge Function crew-upload.
//
// Bắt buộc nén: Supabase free chỉ 1GB. Ảnh gốc điện thoại ~3-5MB,
// nén xuống ~150KB (bản chính) + ~30KB (thumbnail) giảm 10-20 lần.
//
// Đầu vào có thể là JPEG, PNG, HEIC (iPhone mặc định) hoặc DNG (iPhone
// ProRAW) — xem js/convert.js. Đầu ra luôn là JPEG, nên phía duyệt và
// phía chủ nhà không cần biết ảnh gốc định dạng gì.
// ============================================================

import { sniffImageFormat, readTakenAt, extractPreviewJpeg, heicToCanvas, FORMAT_LABEL } from './convert.js';

const MAIN_MAX_DIM = 1280;
const MAIN_QUALITY = 0.7;
const THUMB_MAX_DIM = 400;
const THUMB_QUALITY = 0.6;

// Ngày giờ chụp gốc (EXIF) đọc trong js/convert.js — tín hiệu để phát
// hiện ảnh cũ lấy từ thư viện thay vì chụp trực tiếp, không bắt buộc có.

// ---- Lỗi có thông điệp đọc được cho người dùng cuối ----
// Toast chỉ hiện e.message, nên message phải viết bằng ngôn ngữ công
// trường, không phải thuật ngữ kỹ thuật.
export class PhotoError extends Error {
  constructor(message, cause) { super(message); this.name = 'PhotoError'; this.cause = cause; }
}

// ---- Giải mã ảnh về dạng vẽ được lên canvas ----
// Ưu tiên createImageBitmap: giải mã ngoài luồng chính, chịu được ảnh
// lớn hơn <img> trên máy yếu, và có imageOrientation để tự xoay ảnh dọc
// theo EXIF (nếu không ảnh chụp dọc bằng điện thoại sẽ bị nằm ngang).
async function decodeNative(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (e) { /* trình duyệt cũ không nhận option — thử lại không option */ }
    try {
      return await createImageBitmap(blob);
    } catch (e) { /* định dạng trình duyệt không hiểu — thử tiếp bằng <img> */ }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { img._objectUrl = url; resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('native_decode_failed')); };
    img.src = url;
  });
}

async function decodeImage(file, format) {
  const fmt = format || await sniffImageFormat(file);

  if (fmt === 'unknown') {
    throw new PhotoError(`"${file.name || 'tệp'}" không phải ảnh — chọn lại ảnh chụp công trình`);
  }

  // RAW/DNG: trình duyệt không bao giờ mở được, khỏi thử cho mất thời gian.
  // Ảnh JPEG nhúng trong DNG của iPhone là ảnh đủ nét cho hiện trường.
  if (fmt === 'tiff') {
    const jpeg = await extractPreviewJpeg(file);
    if (!jpeg) throw new PhotoError('Ảnh RAW này không có bản xem trước để chuyển đổi — chụp lại bằng chế độ ảnh thường giúp em');
    try { return await decodeNative(jpeg); }
    catch (e) { throw new PhotoError('Ảnh RAW hỏng, không chuyển đổi được — chụp lại giúp em', e); }
  }

  try {
    return await decodeNative(file);
  } catch (e) {
    // iPhone và Safari mở HEIC được ngay ở trên; tới đây gần như chắc
    // chắn là máy tính Windows — mới cần tải bộ giải mã HEIC.
    if (fmt === 'heic') {
      try { return await heicToCanvas(file); }
      catch (err) { throw new PhotoError('Không chuyển đổi được ảnh HEIC này — ' + (err?.message || 'thử gửi lại ảnh khác'), err); }
    }
    throw new PhotoError(`Không mở được ảnh "${file.name || ''}"${FORMAT_LABEL[fmt] ? ` (dạng ${FORMAT_LABEL[fmt]})` : ''} — ảnh có thể bị lỗi, chụp lại giúp em`, e);
  }
}

function releaseImage(img) {
  if (!img) return;
  if (typeof img.close === 'function') img.close();              // ImageBitmap
  else if (img._objectUrl) URL.revokeObjectURL(img._objectUrl);  // <img>
  else if (img.tagName === 'CANVAS') { img.width = 0; img.height = 0; } // canvas từ HEIC
}

function canvasToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function resizeToBlob(img, maxDim, quality) {
  let { width, height } = img;
  if (!width || !height) throw new PhotoError('Ảnh không đọc được kích thước — chụp lại giúp em');
  if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
  else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, quality);
  // toBlob trả null khi hết bộ nhớ (ảnh 48MP trên điện thoại đời mới,
  // iOS giới hạn ~16.7 triệu điểm ảnh). Không check thì blob null đi
  // thẳng vào upload và báo lỗi mơ hồ ở tầng dưới.
  if (!blob || !blob.size) throw new PhotoError('Ảnh quá lớn, máy không nén nổi — chụp ở chế độ ảnh thường (đừng dùng chế độ độ phân giải cao nhất)');
  return blob;
}

// Nén 1 file ảnh thành {mainBlob, thumbBlob, takenAt}
export async function prepareImage(file) {
  const fmt = await sniffImageFormat(file);
  const [img, takenAt] = await Promise.all([decodeImage(file, fmt), readTakenAt(file, fmt)]);
  try {
    const mainBlob = await resizeToBlob(img, MAIN_MAX_DIM, MAIN_QUALITY);
    const thumbBlob = await resizeToBlob(img, THUMB_MAX_DIM, THUMB_QUALITY);
    return { mainBlob, thumbBlob, takenAt: takenAt ? takenAt.toISOString() : null };
  } finally {
    releaseImage(img);
  }
}

// ---- Thử lại khi mạng công trường chập chờn ----
// Upload hỏng vì sóng yếu là chuyện thường ở công trình; bắt thợ nhập
// lại cả báo cáo chỉ vì rớt mạng 1 giây là lý do họ bỏ dùng app.
async function withRetry(fn, label, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (e instanceof PhotoError) throw e;            // lỗi ảnh, thử lại vô ích
      if (i < tries - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw new PhotoError(`${label} thất bại — sóng yếu hoặc mất mạng, thử lại giúp em`, lastErr);
}

// Đọc thông điệp lỗi thật từ Edge Function. functions.invoke trả
// FunctionsHttpError với body nằm trong e.context (Response) — nếu không
// đọc ra thì mọi lỗi đều hiện chung một câu vô nghĩa.
async function edgeErrorDetail(err) {
  try {
    const res = err?.context;
    if (res && typeof res.json === 'function') {
      const body = await res.clone().json();
      return body?.detail || body?.error || null;
    }
  } catch (e) { /* body không phải JSON */ }
  return null;
}

// ---- Upload qua Edge Function crew-upload (signed URL, không cần đăng nhập) ----
// supabaseClient: instance từ js/supabase.js
// token: crew_link token của người đang gửi báo cáo
// Trả về {path, thumb_path, taken_at} để đính vào progress_reports.photos
export async function uploadCrewPhoto(supabaseClient, token, file) {
  return uploadPreparedCrewPhoto(supabaseClient, token, await prepareImage(file));
}

// Tách riêng bước gửi: hàng đợi offline (js/outbox.js) nén ảnh ngay lúc
// thợ bấm gửi, cất bản nén vào máy, có sóng mới gọi hàm này.
export async function uploadPreparedCrewPhoto(supabaseClient, token, { mainBlob, thumbBlob, takenAt }) {
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const { data: signed, error: signErr } = await supabaseClient.functions.invoke('crew-upload', {
    body: { token, filenames: [stamp + '.jpg', stamp + '-thumb.jpg'] }
  });
  if (signErr) {
    const detail = await edgeErrorDetail(signErr);
    if (detail === 'invalid_or_expired_token') {
      const err = new PhotoError('Link của đội đã hết hạn hoặc bị thu hồi — báo giám sát cấp link mới', signErr);
      err.code = 'invalid_or_expired_token';   // hàng đợi offline dựa vào mã này để ngừng gửi lại
      throw err;
    }
    throw new PhotoError('Không xin được chỗ lưu ảnh trên máy chủ' + (detail ? ` (${detail})` : ''), signErr);
  }
  if (!signed?.paths?.length || !signed?.tokens?.length) {
    throw new PhotoError('Máy chủ không trả về chỗ lưu ảnh — thử lại sau ít phút');
  }

  const put = (i, blob) => withRetry(async () => {
    const { error } = await supabaseClient.storage.from('site-photos')
      .uploadToSignedUrl(signed.paths[i], signed.tokens[i], blob, { contentType: 'image/jpeg' });
    if (error) throw error;
  }, 'Tải ảnh lên');

  await put(0, mainBlob);
  await put(1, thumbBlob);

  return { path: signed.paths[0], thumb_path: signed.paths[1], taken_at: takenAt };
}

// ---- Upload trực tiếp cho staff (đã đăng nhập, dùng khi nhập thay đội
// không dùng app) — không cần qua Edge Function vì storage.objects đã
// có policy cho phép authenticated insert vào bucket site-photos.
export async function uploadStaffPhoto(supabaseClient, file, projectId, subcontractorId) {
  const { mainBlob, thumbBlob, takenAt } = await prepareImage(file);
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const dateFolder = new Date().toISOString().slice(0, 10);
  const mainPath = `${projectId}/${subcontractorId}/${dateFolder}/staff-${stamp}.jpg`;
  const thumbPath = `${projectId}/${subcontractorId}/${dateFolder}/staff-${stamp}-thumb.jpg`;

  const put = (path, blob) => withRetry(async () => {
    const { error } = await supabaseClient.storage.from('site-photos')
      .upload(path, blob, { contentType: 'image/jpeg' });
    if (error) {
      // 403 ở đây = thiếu policy insert cho authenticated trên bucket
      // site-photos (xem schema.sql mục STORAGE), không phải lỗi mạng.
      const msg = String(error.message || '');
      if (/row-level security|Unauthorized|403/i.test(msg)) {
        throw new PhotoError('Tài khoản không có quyền tải ảnh lên kho — báo kỹ thuật kiểm tra quyền bucket site-photos', error);
      }
      throw error;
    }
  }, 'Tải ảnh lên');

  await put(mainPath, mainBlob);
  await put(thumbPath, thumbBlob);

  return { path: mainPath, thumb_path: thumbPath, taken_at: takenAt };
}

// ---- Đổi path (staff, đã đăng nhập) thành signed URL xem được ----
export async function signStaffPhotoUrl(supabaseClient, path, expiresIn = 3600) {
  const { data, error } = await supabaseClient.storage.from('site-photos').createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}
