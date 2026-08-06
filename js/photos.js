// ============================================================
// Nén ảnh phía client + đọc ngày chụp gốc (EXIF) + upload lên Storage
// qua signed URL cấp bởi Edge Function crew-upload.
//
// Bắt buộc nén: Supabase free chỉ 1GB. Ảnh gốc điện thoại ~3-5MB,
// nén xuống ~150KB (bản chính) + ~30KB (thumbnail) giảm 10-20 lần.
// ============================================================

const MAIN_MAX_DIM = 1280;
const MAIN_QUALITY = 0.7;
const THUMB_MAX_DIM = 400;
const THUMB_QUALITY = 0.6;

// ---- Đọc EXIF DateTimeOriginal (JPEG only) — không dùng thư viện ngoài ----
// Trả về Date hoặc null nếu không đọc được (ảnh PNG, HEIC đã convert, hoặc
// không có EXIF). Đây là tín hiệu để phát hiện ảnh cũ lấy từ thư viện thay
// vì chụp trực tiếp — không phải yêu cầu bắt buộc phải có.
export async function readExifTakenAt(file) {
  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint16(0) !== 0xFFD8) return null; // không phải JPEG

    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      if (marker === 0xFFE1) { // APP1 = EXIF
        return parseExifDate(view, offset + 4);
      }
      if ((marker & 0xFF00) !== 0xFF00) break;
      offset += 2 + view.getUint16(offset + 2);
    }
  } catch (e) { /* ảnh không đọc được EXIF, bỏ qua */ }
  return null;
}

function parseExifDate(view, start) {
  if (view.getUint32(start) !== 0x45786966) return null; // "Exif"
  const tiffStart = start + 6;
  const little = view.getUint16(tiffStart) === 0x4949;
  const readU16 = o => view.getUint16(o, little);
  const readU32 = o => view.getUint32(o, little);
  const ifdOffset = tiffStart + readU32(tiffStart + 4);
  const entries = readU16(ifdOffset);

  let exifIfdOffset = null;
  for (let i = 0; i < entries; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (readU16(entryOffset) === 0x8769) { // ExifIFDPointer
      exifIfdOffset = tiffStart + readU32(entryOffset + 8);
    }
  }
  if (exifIfdOffset == null) return null;

  const exifEntries = readU16(exifIfdOffset);
  for (let i = 0; i < exifEntries; i++) {
    const entryOffset = exifIfdOffset + 2 + i * 12;
    const tag = readU16(entryOffset);
    if (tag === 0x9003 || tag === 0x9004) { // DateTimeOriginal / DateTimeDigitized
      const valueOffset = tiffStart + readU32(entryOffset + 8);
      let str = '';
      for (let j = 0; j < 19; j++) str += String.fromCharCode(view.getUint8(valueOffset + j));
      // format: "2026:08:01 14:32:00"
      const m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
  }
  return null;
}

// ---- Resize + nén qua canvas ----
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function resizeToBlob(img, maxDim, quality) {
  let { width, height } = img;
  if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
  else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvasToBlob(canvas, quality);
}

// Nén 1 file ảnh thành {mainBlob, thumbBlob, takenAt}
export async function prepareImage(file) {
  const [img, takenAt] = await Promise.all([loadImage(file), readExifTakenAt(file)]);
  const [mainBlob, thumbBlob] = await Promise.all([
    resizeToBlob(img, MAIN_MAX_DIM, MAIN_QUALITY),
    resizeToBlob(img, THUMB_MAX_DIM, THUMB_QUALITY)
  ]);
  URL.revokeObjectURL(img.src);
  return { mainBlob, thumbBlob, takenAt: takenAt ? takenAt.toISOString() : null };
}

// ---- Upload qua Edge Function crew-upload (signed URL, không cần đăng nhập) ----
// supabaseClient: instance từ js/supabase.js
// token: crew_link token của người đang gửi báo cáo
// Trả về {path, thumb_path, taken_at} để đính vào progress_reports.photos
export async function uploadCrewPhoto(supabaseClient, token, file) {
  const { mainBlob, thumbBlob, takenAt } = await prepareImage(file);
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  const { data: signed, error: signErr } = await supabaseClient.functions.invoke('crew-upload', {
    body: { token, filenames: [stamp + '.jpg', stamp + '-thumb.jpg'] }
  });
  if (signErr) throw signErr;

  await Promise.all([
    supabaseClient.storage.from('site-photos').uploadToSignedUrl(signed.paths[0], signed.tokens[0], mainBlob),
    supabaseClient.storage.from('site-photos').uploadToSignedUrl(signed.paths[1], signed.tokens[1], thumbBlob)
  ]);

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

  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabaseClient.storage.from('site-photos').upload(mainPath, mainBlob, { contentType: 'image/jpeg' }),
    supabaseClient.storage.from('site-photos').upload(thumbPath, thumbBlob, { contentType: 'image/jpeg' })
  ]);
  if (e1 || e2) throw (e1 || e2);

  return { path: mainPath, thumb_path: thumbPath, taken_at: takenAt };
}

// ---- Đổi path (staff, đã đăng nhập) thành signed URL xem được ----
export async function signStaffPhotoUrl(supabaseClient, path, expiresIn = 3600) {
  const { data, error } = await supabaseClient.storage.from('site-photos').createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}
