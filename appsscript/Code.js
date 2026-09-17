/**
 * Apps Script STANDALONE "bayich2_dongbogia" — backend của trang Đồng Bộ Giá
 * (bayich2-dongbogia.vercel.app).
 *
 * Đồng bộ giá từ tab Retail (sheet bayich2) sang tab Menu (sheet bayich2): Giá = Giá Làm Tròn ← giá bán,
 * theo khối ánh xạ trong tab DongBo (sheet bayich2).
 *
 *  ĐỌC : doPost {hanhDong:'xemTruoc', pin} → danh sách món và giá dự kiến, KHÔNG ghi gì — cần Mã PIN chung.
 *  GHI : doPost {hanhDong:'dongBo', pin, chon:[{dich, ten, cot, cu, moi}]} — cần Mã PIN chung (tab CauHinh)
 *        rồi tô dòng vừa ghi:  ĐỎ = có đổi giá bán · XANH = chỉ đổi cột không phải giá bán (Menu hiện chỉ có giá bán)
 *
 * An toàn dù web app mở cho "Bất kỳ ai": máy chủ TỰ TÍNH giá từ Retail, client không bao giờ gửi giá
 * để ghi. `cu`/`moi` chỉ để đối chiếu: một ô chỉ được ghi khi giá đang có == cu VÀ giá tính lại == moi.
 *
 * Tab DongBo: bảng ánh xạ Đích | Tên ở đích | Nguồn (Retail) (tìm theo CHỮ TIÊU ĐỀ)
 *     → món ghép: "A + B" (giá = tổng) · món nửa ký: "Bị Ngang Lớn ÷ 2" (phép tính ở cuối, áp cho cả tổng)
 * Tab CauHinh: cấu hình dùng chung cho mọi công cụ — Trường | Giá trị | Ghi chú | Dùng cho
 *     (bước làm tròn, ngưỡng cảnh báo, màu…) — tab riêng tư, KHÔNG xuất bản lên web.
 *
 * CÀI / NÂNG CẤP: chọn hàm caiDat → Run. Tạo tab còn thiếu, thêm trường còn thiếu vào CauHinh; bản cũ để cấu hình
 * trong tab DongBo (cột F:H) thì chép sang CauHinh rồi xoá khối cũ (bảng ánh xạ giữ nguyên). Chạy lại không sao.
 * CẬP NHẬT CODE: clasp push → clasp deploy -i <deploymentId> (link /exec giữ nguyên).
 */

var ID_BAYICH2 = '1Wd4Zvq2xiIiEzou_dvE2YtOk-bJJhAD7se0yREYe9c8';   // nơi có Retail + DongBo (cấu hình)

var TAB_RETAIL = 'Retail';
var TAB_DONGBO = 'DongBo';
var COT_RETAIL = { ten: 'Mặt Hàng', giaNhapLe: 'Giá Nhập Lẻ', giaLamTron: 'Giá Làm Tròn' };

var TD_DICH = 'Đích', TD_TEN = 'Tên ở đích', TD_NGUON = 'Nguồn (Retail)';
var TAB_CAU_HINH = 'CauHinh';
var TD_TRUONG = 'Trường', TD_GIA_TRI = 'Giá trị', TD_GHI_CHU = 'Ghi chú', TD_DUNG_CHO = 'Dùng cho';

/* Trường trong tab CauHinh → khoá dùng trong code (bietDanh: tên cũ vẫn nhận) */
var TRUONG = [
  { khoa: 'buocLamTron',   ten: 'Bước làm tròn',         kieu: 'so' },
  { khoa: 'nguongNhay',    ten: 'Cảnh báo giá nhảy (%)', kieu: 'so' },
  { khoa: 'mauDo',         ten: 'Màu đổi giá bán',       kieu: 'mau' },
  { khoa: 'mauXanh',       ten: 'Màu chỉ đổi giá nhập',  kieu: 'mau', bietDanh: ['Màu chỉ đổi giá sỉ'] },
  { khoa: 'xoaMauCu',      ten: 'Xoá màu cũ khi ghi',    kieu: 'coKhong' }
];

/* Mỗi đích: tab nào, cột tên, các cột giá, cách tính và cột nào là GIÁ BÁN (quyết màu đỏ) */
var DICH = {
  Menu: {
    tab: 'Menu', cotTen: 'Tên sản phẩm',
    cot: [{ ten: 'Giá', tinh: 'lamTron', giaBan: true }]
  }
};

var TOI_DA_O_GHI = 300;

/* ══════════════════ ĐỌC ══════════════════ */
function doGet(e) {
  try {
    var viec = (e && e.parameter && e.parameter.viec) || 'ping';
    /* Xem trước đã chuyển sang doPost {hanhDong:'xemTruoc', pin} — GET không trả giá nữa (trang bản cũ thì báo tải lại) */
    if (viec === 'xemTruoc') return traLoi({ ok: false, maLoi: 'CU', loi: 'Trang đang là bản cũ — tải lại trang (xem giá giờ cần Mã PIN chung)' });
    return traLoi({ ok: true, ten: 'bayich2_dongbogia', thoiGian: new Date().toISOString() });
  } catch (err) {
    return traLoi({ ok: false, loi: String(err) });
  }
}

function tinhThayDoi() {
  var kq = tinhToan();
  if (!kq.ok) return { ok: false, loi: kq.loi };
  return { ok: true, mon: kq.mon.map(congKhai), canhBao: kq.canhBao, nguongNhay: kq.cauHinh.nguongNhay, thoiGian: new Date().toISOString() };
}

/* ══════════════════ GHI ══════════════════ */
/* Mọi lệnh GHI cần Mã PIN chung (tab CauHinh). Kiểm PIN TRƯỚC khi giữ khoá ghi — sai PIN (chờ 2 giây) không chặn người khác.
   {hanhDong:'kiemPin', pin} để trang kiểm PIN ngay lúc nhập. {hanhDong:'xemTruoc', pin} = ĐỌC — cũng cần PIN, không giữ khoá ghi. */
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var p = kiemPin(SpreadsheetApp.openById(ID_BAYICH2), d.pin);
    if (!p.ok) return traLoi(p);
    if (d.hanhDong === 'kiemPin') return traLoi({ ok: true });
    if (d.hanhDong === 'xemTruoc') return traLoi(tinhThayDoi());
    if (d.hanhDong !== 'dongBo') return traLoi({ ok: false, loi: 'Hành động không hợp lệ' });
    if (!Array.isArray(d.chon) || !d.chon.length) return traLoi({ ok: false, loi: 'Chưa chọn món nào để ghi' });
    if (d.chon.length > TOI_DA_O_GHI) return traLoi({ ok: false, loi: 'Quá nhiều ô trong một lần ghi' });
    var khoa = LockService.getScriptLock();
    if (!khoa.tryLock(15000)) return traLoi({ ok: false, loi: 'Đang có một lần ghi khác, thử lại sau ít giây' });
    try { return traLoi(dongBo(d.chon)); } finally { khoa.releaseLock(); }
  } catch (err) {
    return traLoi({ ok: false, loi: String(err) });
  }
}

function dongBo(chon) {
  /* Tính lại từ đầu — không tin bất kỳ con số nào client gửi lên */
  var kq = tinhToan();
  if (!kq.ok) return { ok: false, loi: kq.loi };
  var ch = kq.cauHinh;

  var theoKhoa = {};
  kq.mon.forEach(function (m) {
    Object.keys(m.gia).forEach(function (cot) { theoKhoa[khoaO(m.dich, m.ten, cot)] = { m: m, cot: cot }; });
  });

  var daGhiO = {}, theoMon = {}, danhSach = [], boQua = [];
  chon.forEach(function (c) {
    c = c || {};
    var nhan = { dich: String(c.dich || ''), ten: String(c.ten || ''), cot: String(c.cot || '') };
    var k = khoaO(nhan.dich, nhan.ten, nhan.cot), t = theoKhoa[k];
    if (!t) { boQua.push(gan(nhan, { lyDo: 'Không còn trong bảng ánh xạ DongBo' })); return; }
    if (daGhiO[k]) { boQua.push(gan(nhan, { lyDo: 'Trùng ô trong cùng lần ghi' })); return; }
    var g = t.m.gia[t.cot];
    if (!g.doi) { boQua.push(gan(nhan, { lyDo: 'Đã đúng giá, không cần ghi' })); return; }
    if (g.cu !== c.cu) { boQua.push(gan(nhan, { lyDo: 'Giá trong sheet đã khác lúc xem trước', trongSheet: g.cu })); return; }
    if (g.moi !== c.moi) { boQua.push(gan(nhan, { lyDo: 'Retail vừa đổi, giá tính lại đã khác', tinhLai: g.moi })); return; }

    var o = t.m._sh.getRange(t.m._dong, g._cot);
    if (typeof o.getValue() === 'string') o.setNumberFormat('#,##0');   // ô đang lưu chữ → chuyển sang số
    o.setValue(g.moi);
    daGhiO[k] = true;

    var km = t.m.dich + '|' + chuanHoa(t.m.ten);
    if (!theoMon[km]) { theoMon[km] = { m: t.m, ban: false, gia: {} }; danhSach.push(theoMon[km]); }
    if (g._giaBan) theoMon[km].ban = true;
    theoMon[km].gia[t.cot] = { cu: g.cu, moi: g.moi };
  });
  if (!danhSach.length) return { ok: false, loi: 'Không ghi được ô nào', boQua: boQua };
  SpreadsheetApp.flush();

  /* Tô màu: xoá màu cũ ở tab có ghi (nếu bật), rồi tô dòng vừa ghi — ĐỎ nếu có đổi giá bán, XANH nếu chỉ Giá Sỉ */
  var tabCoGhi = {};
  danhSach.forEach(function (x) { tabCoGhi[x.m.dich] = x.m; });
  if (ch.xoaMauCu) Object.keys(tabCoGhi).forEach(function (dich) {
    var m = tabCoGhi[dich];
    if (m._soDong > 1) m._sh.getRange(2, 1, m._soDong - 1, m._soCot).setBackground(null);
  });
  var daGhi = danhSach.map(function (x) {
    var mau = x.ban ? 'do' : 'xanh', mauSheet = x.ban ? ch.mauDo : ch.mauXanh;
    if (mauSheet) x.m._sh.getRange(x.m._dong, 1, 1, x.m._soCot).setBackground(mauSheet);
    return { dich: x.m.dich, ten: x.m.ten, mau: mau, gia: x.gia };
  });
  SpreadsheetApp.flush();

  return {
    ok: true, daGhi: daGhi, boQua: boQua,
    soDo: daGhi.filter(function (x) { return x.mau === 'do'; }).length,
    soXanh: daGhi.filter(function (x) { return x.mau === 'xanh'; }).length,
    xemTruoc: tinhThayDoi()
  };
}

/* ══════════════════ TÍNH TOÁN ══════════════════ */
function tinhToan() {
  var ssB = SpreadsheetApp.openById(ID_BAYICH2);
  var canhBao = [];
  var db = docDongBo(ssB, canhBao);
  if (db.loi) return { ok: false, loi: db.loi };
  var ch = db.cauHinh;
  if (ch.buocLamTron == null)
    return { ok: false, loi: 'Chưa có "Bước làm tròn" trong tab ' + TAB_CAU_HINH + ' — mở Apps Script, chạy hàm caiDat một lần' };

  var retail = docRetail(ssB);
  if (retail.loi) return { ok: false, loi: retail.loi };

  var bang = { Menu: docDich(ssB, DICH.Menu, canhBao) };

  var mon = [], daDung = {}, daKhai = {};
  db.anhXa.forEach(function (m) {
    var cfg = DICH[m.dich], b = bang[m.dich];
    if (!b) return;   // đích không đọc được — đã có cảnh báo

    var khoaKhai = m.dich + '|' + chuanHoa(m.ten);
    if (daKhai[khoaKhai]) {
      canhBao.push(loi('DongBo dòng ' + m.dong + ': "' + m.ten + '" (' + m.dich + ') đã khai ở dòng ' + daKhai[khoaKhai] + ' — bỏ qua dòng này'));
      return;
    }
    daKhai[khoaKhai] = m.dong;

    var dongs = b.theoTen[chuanHoa(m.ten)];
    if (!dongs) { canhBao.push(loi('Không thấy "' + m.ten + '" trong tab ' + cfg.tab + ' (DongBo dòng ' + m.dong + ')')); return; }
    if (dongs.length > 1) { canhBao.push(loi('"' + m.ten + '" có ' + dongs.length + ' dòng trùng tên trong tab ' + cfg.tab + ' — không biết ghi dòng nào')); return; }

    var tach = tachNguon(m.nguonTho, retail.theoTen);
    if (tach.loi) { canhBao.push(loi('DongBo dòng ' + m.dong + ': ' + tach.loi)); return; }
    var heSo = tach.heSo, nguon = tach.nguon;
    nguon.forEach(function (r) { daDung[chuanHoa(r.ten)] = true; });

    var tongTron = 0, tongNhapLe = 0, thieuGia = [];
    nguon.forEach(function (r) {
      if (r.lamTron == null || r.nhapLe == null) thieuGia.push(r.ten);
      tongTron += r.lamTron || 0;
      tongNhapLe += r.nhapLe || 0;
    });
    if (thieuGia.length) { canhBao.push(loi('Retail "' + thieuGia.join('", "') + '" chưa có Giá Làm Tròn / Giá Nhập Lẻ')); return; }

    var i = dongs[0], gia = {}, doiBan = false, doiSi = false, nhay = 0;
    cfg.cot.forEach(function (c) {
      var cotSo = b.cot[c.ten];
      var moi = c.tinh === 'lamTron' ? lamTron(heSo * tongTron, ch.buocLamTron) : Math.round(heSo * tongNhapLe);
      var cu = soHoa(b.hang[i][cotSo]), doi = cu !== moi;
      if (doi) {
        if (c.giaBan) doiBan = true; else doiSi = true;
        if (cu) nhay = Math.max(nhay, Math.abs(moi - cu) / cu);
      }
      gia[c.ten] = { cu: cu, moi: moi, doi: doi, _cot: cotSo + 1, _giaBan: c.giaBan };
    });
    mon.push({
      dich: m.dich, ten: String(b.hang[i][b.cotTen]).trim(),
      nguon: nguon.map(function (r) { return r.ten; }), heSo: heSo,
      gia: gia, trangThai: doiBan ? 'do' : (doiSi ? 'xanh' : 'giu'), nhay: nhay,
      _sh: b.sh, _dong: i + 1, _soCot: b.soCot, _soDong: b.hang.length
    });
  });

  Object.keys(retail.theoTen).forEach(function (k) {
    if (!daDung[k]) canhBao.push(luuY('Retail "' + retail.theoTen[k].ten + '" chưa được đồng bộ đi đâu'));
  });

  return { ok: true, mon: mon, canhBao: canhBao, cauHinh: ch };
}

function docRetail(ss) {
  var sh = ss.getSheetByName(TAB_RETAIL);
  if (!sh) return { loi: 'Không tìm thấy tab ' + TAB_RETAIL };
  var hang = sh.getDataRange().getValues();
  var cot = {}, thieu = [];
  Object.keys(COT_RETAIL).forEach(function (k) {
    cot[k] = timCot(hang[0] || [], COT_RETAIL[k]);
    if (cot[k] < 0) thieu.push(COT_RETAIL[k]);
  });
  if (thieu.length) return { loi: 'Tab ' + TAB_RETAIL + ' thiếu cột: ' + thieu.join(', ') };

  var theoTen = {};
  for (var i = 1; i < hang.length; i++) {
    var ten = String(hang[i][cot.ten] || '').trim();
    if (!ten) continue;
    theoTen[chuanHoa(ten)] = { ten: ten, nhapLe: soThuc(hang[i][cot.giaNhapLe]), lamTron: soHoa(hang[i][cot.giaLamTron]) };
  }
  return { theoTen: theoTen };
}

/* Đọc tab DongBo: khối ánh xạ + khối cấu hình. Trường thiếu/sai nhận null và có cảnh báo. */
function docDongBo(ss, canhBao) {
  var sh = ss.getSheetByName(TAB_DONGBO);
  if (!sh) return { loi: 'Chưa có tab ' + TAB_DONGBO + ' trong sheet bayich2 — mở Apps Script, chạy hàm caiDat một lần' };
  var hang = sh.getDataRange().getValues(), td = hang[0] || [];
  var c = {
    dich: timCot(td, TD_DICH), ten: timCot(td, TD_TEN), nguon: timCot(td, TD_NGUON),
    truong: timCot(td, TD_TRUONG), giaTri: timCot(td, TD_GIA_TRI)
  };

  /* Cấu hình: tab CauHinh trước; bản cũ còn khối cấu hình trong tab DongBo thì đọc tạm từ đó */
  var cauHinh = {};
  TRUONG.forEach(function (t) { cauHinh[t.khoa] = null; });
  var chung = docCauHinhChung(ss), cu = khoiCu(sh), conCu = false;
  TRUONG.forEach(function (t) {
    var v = layTheoTen(chung, tenCuaTruong(t));
    if (v === undefined && cu) { v = layTheoTen(cu.gt, tenCuaTruong(t)); if (v !== undefined) conCu = true; }
    if (v === undefined) { canhBao.push(loi('Tab ' + TAB_CAU_HINH + ' thiếu trường "' + t.ten + '" — mở Apps Script, chạy hàm caiDat một lần để thêm')); return; }
    cauHinh[t.khoa] = docGiaTri(v, t.kieu);
    if (cauHinh[t.khoa] == null && String(v).trim() !== '') canhBao.push(loi('Trường "' + t.ten + '" có giá trị không hợp lệ: ' + v));
  });
  if (conCu) canhBao.push(luuY('Cấu hình còn nằm ở tab ' + TAB_DONGBO + ' — mở Apps Script, chạy hàm caiDat một lần để chuyển sang tab ' + TAB_CAU_HINH));

  var anhXa = [];
  if (c.dich < 0 || c.ten < 0 || c.nguon < 0) canhBao.push(loi('Tab DongBo thiếu tiêu đề khối ánh xạ (' + [TD_DICH, TD_TEN, TD_NGUON].join(' | ') + ')'));
  else {
    for (var j = 1; j < hang.length; j++) {
      var dong = j + 1, d = hang[j];
      var dichTho = String(d[c.dich] || '').trim(), ten = String(d[c.ten] || '').trim(), nguonTho = String(d[c.nguon] || '').trim();
      if (!dichTho && !ten && !nguonTho) continue;   // dòng trống (hoặc dòng chỉ thuộc khối cấu hình)

      var dich = null;
      Object.keys(DICH).forEach(function (k) { if (chuanHoa(k) === chuanHoa(dichTho)) dich = k; });
      if (!dich) { canhBao.push(loi('DongBo dòng ' + dong + ': Đích "' + dichTho + '" không hợp lệ (chỉ nhận ' + Object.keys(DICH).join(', ') + ')')); continue; }
      if (!ten || !nguonTho) { canhBao.push(loi('DongBo dòng ' + dong + ': thiếu Tên ở đích hoặc Nguồn')); continue; }
      anhXa.push({ dong: dong, dich: dich, ten: ten, nguonTho: nguonTho });   // tách nguồn khi đã có Retail
    }
  }
  return { anhXa: anhXa, cauHinh: cauHinh };
}

/* Cột Nguồn: "A + B" = tổng giá các món Retail. Cuối có thể kèm phép tính áp cho CẢ TỔNG:
   "÷ 2", "/ 2", ": 2", "× 0,5", "x 0,5", "* 0.5" — hoặc "½" ở đầu. Tên Retail được khớp trước, nên tên có dấu phẩy,
   chữ số hay chữ "x" không bao giờ bị hiểu nhầm là phép tính. Trả { nguon: [món Retail], heSo } hoặc { loi }. */
function tachNguon(tho, theoTen) {
  function khop(s) {
    var ten = String(s).split('+').map(function (x) { return x.trim(); }).filter(Boolean), ds = [], thieu = [];
    ten.forEach(function (n) { var r = theoTen[chuanHoa(n)]; if (r) ds.push(r); else thieu.push(n); });
    return { ds: ds, thieu: ten.length ? thieu : [String(s).trim()] };
  }
  var s = String(tho || '').trim(), heSo = 1, m;
  if ((m = s.match(/^½\s*(.+)$/))) { s = m[1]; heSo = 0.5; }   // xét trước: chuanHoa bỏ mất ký tự "½"
  else {
    var goc = khop(s);
    if (!goc.thieu.length) return { nguon: goc.ds, heSo: 1 };
    if ((m = s.match(/^(.+?)\s*[÷\/:]\s*(\d+(?:[.,]\d+)?)$/))) { s = m[1]; var chia = soPhepTinh(m[2]); heSo = chia > 0 ? 1 / chia : 0; }
    else if ((m = s.match(/^(.+?)\s*[×xX*]\s*(\d+(?:[.,]\d+)?)$/))) { s = m[1]; heSo = soPhepTinh(m[2]); }
    else return { loi: 'không thấy "' + goc.thieu.join('", "') + '" trong Retail' };
    if (!(heSo > 0)) return { loi: 'phép tính trong "' + tho + '" không hợp lệ — hệ số phải lớn hơn 0' };
  }
  var k = khop(s);
  if (k.thieu.length) return { loi: 'không thấy "' + k.thieu.join('", "') + '" trong Retail' };
  return { nguon: k.ds, heSo: heSo };
}
function soPhepTinh(s) { return parseFloat(String(s).replace(',', '.')); }   // "0,5" / "0.5" → 0,5 (không có dấu nghìn)


function docDich(ss, cfg, canhBao) {
  var sh = ss.getSheetByName(cfg.tab);
  if (!sh) { canhBao.push(loi('Không tìm thấy tab ' + cfg.tab + ' trong sheet ' + ss.getName())); return null; }
  var hang = sh.getDataRange().getValues();
  if (!hang.length) { canhBao.push(loi('Tab ' + cfg.tab + ' đang trống')); return null; }

  var tieuDe = hang[0], cotTen = timCot(tieuDe, cfg.cotTen);
  if (cotTen < 0) { canhBao.push(loi('Tab ' + cfg.tab + ' không có cột "' + cfg.cotTen + '"')); return null; }
  var cot = {};
  for (var j = 0; j < cfg.cot.length; j++) {
    var idx = timCot(tieuDe, cfg.cot[j].ten);
    if (idx < 0) { canhBao.push(loi('Tab ' + cfg.tab + ' không có cột "' + cfg.cot[j].ten + '"')); return null; }
    cot[cfg.cot[j].ten] = idx;
  }
  var soCot = tieuDe.length;   // tô màu từ cột A tới cột tiêu đề cuối
  while (soCot > 1 && String(tieuDe[soCot - 1]).trim() === '') soCot--;

  var theoTen = {};
  for (var i = 1; i < hang.length; i++) {
    var k = chuanHoa(hang[i][cotTen]);
    if (k) (theoTen[k] = theoTen[k] || []).push(i);
  }
  return { sh: sh, hang: hang, cotTen: cotTen, cot: cot, soCot: soCot, theoTen: theoTen };
}

function docGiaTri(v, kieu) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (kieu === 'so') { var n = soThuc(v); return n != null && n > 0 ? n : null; }
  if (kieu === 'mau') return /^#[0-9a-f]{6}$/i.test(s) ? s : null;
  if (kieu === 'coKhong') { var c = chuanHoa(s); return c === 'co' ? true : c === 'khong' ? false : null; }
  return s;
}

/* ══════════════════ CÀI / NÂNG CẤP ══════════════════ */
/* Chạy tay trong trình soạn Apps Script. Thêm khối nào còn thiếu; khối đã có thì giữ nguyên.
   Dữ liệu dưới đây chỉ để điền lần đầu — sau đó sửa trong Sheet, không sửa ở đây. */
/* Trường của công cụ này trong tab CauHinh: [Trường, Giá trị mặc định, Ghi chú, Dùng cho].
   Trường dùng chung với Đối chiếu toa (bước làm tròn, cảnh báo, màu, xoá màu cũ) có cùng tên, cùng dòng ở cả 2 script. */
var DUNG_CHUNG = 'Đối chiếu toa, Đồng bộ giá';
var CAU_HINH_BAN_DAU = [
  ['Bước làm tròn', 1000, 'Giá bán làm tròn tới bội số này — cột Giá Làm Tròn của Retail, Đối chiếu toa và Đồng bộ giá cùng theo dòng này. Ghi số liền, không dấu chấm (vd 1000)', 'Retail, ' + DUNG_CHUNG],
  ['Cảnh báo giá nhảy (%)', 30, 'Giá đổi từ mức này trở lên → bỏ tích sẵn để xem lại', DUNG_CHUNG],
  ['Màu đổi giá bán', '#f4cccc', 'Tô dòng có đổi giá bán. Để trống = không tô', DUNG_CHUNG],
  ['Màu chỉ đổi giá nhập', '#d9ead3', 'Tô dòng chỉ đổi giá nhập / giá sỉ. Để trống = không tô', DUNG_CHUNG],
  ['Xoá màu cũ khi ghi', 'Có', 'Có / Không — để màu chỉ phản ánh lần ghi gần nhất', DUNG_CHUNG]
];
var ANH_XA_MAC_DINH = [
  ['Menu', 'Ly 360ml', 'Ly Trơn 360ml'],
  ['Menu', 'Ly 500ml', 'Ly Trơn 500ml'],
  ['Menu', 'Ly 650ml', 'Ly Trơn 650ml'],
  ['Menu', 'Ly 720ml', 'Ly Trơn 720ml'],
  ['Menu', 'Nắp Hữu Phong 95mm', 'Nắp Hữu Phong 95mm'],
  ['Menu', 'Nắp Cầu Tròn 95mm', 'Nắp Cầu Tròn 95mm'],
  ['Menu', 'Nắp Bằng Cao 95mm', 'Nắp Bằng Cao 95mm'],
  ['Menu', 'Nắp Hữu Phong 116mm', 'Nắp Hữu Phong 116mm'],
  ['Menu', 'Ly Cà Phê (Nắp Thường)', 'Ly Trơn 360ml + Nắp Hữu Phong 95mm'],
  ['Menu', 'Ly Cà Phê (Nắp Cầu)', 'Ly Trơn 360ml + Nắp Cầu Tròn 95mm'],
  ['Menu', 'Ly Sinh Tố (Kèm Nắp)', 'Ly Trơn 650ml + Nắp Cầu Tròn 95mm'],
  ['Menu', 'Ly Trà Tắc (Kèm Nắp)', 'Ly Trơn 720ml + Nắp Hữu Phong 116mm'],
  ['Menu', 'Ống Cà Phê', 'Ống Hút Trong 6mm, 8mm'],
  ['Menu', 'Ống Sinh Tố', 'Ống Hút Trong 6mm, 8mm'],
  ['Menu', 'Muỗng Ngắn', 'Muỗng GT 150mm'],
  ['Menu', 'Muỗng Dài', 'Muỗng GT 200mm'],
  ['Menu', 'Bị 1 Ly', 'Bị 1 Ly, 2 Ly Lớn'],
  ['Menu', 'Bị 2 Ly', 'Bị 1 Ly, 2 Ly Lớn'],
  ['Menu', 'Bị Ngang', 'Bị Ngang Lớn'],
  ['Menu', 'Bị 1 Ly (Nửa Ký)', 'Bị 1 Ly, 2 Ly Lớn ÷ 2'],
  ['Menu', 'Bị 2 Ly (Nửa Ký)', 'Bị 1 Ly, 2 Ly Lớn ÷ 2'],
  ['Menu', 'Bị Ngang (Nửa Ký)', 'Bị Ngang Lớn ÷ 2']
];

function caiDat() {
  var ss = SpreadsheetApp.openById(ID_BAYICH2);
  var sh = ss.getSheetByName(TAB_DONGBO);
  if (!sh) {
    sh = ss.insertSheet(TAB_DONGBO, ss.getNumSheets());
    var dong = [[TD_DICH, TD_TEN, TD_NGUON]].concat(ANH_XA_MAC_DINH);
    sh.getRange(1, 1, dong.length, 3).setValues(dong);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#2f5233').setFontColor('#f6f1e4');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 90); sh.setColumnWidth(2, 210); sh.setColumnWidth(3, 320);
    Logger.log('Đã tạo tab ' + TAB_DONGBO + ' với khối ánh xạ ' + ANH_XA_MAC_DINH.length + ' dòng');
  } else {
    Logger.log('Tab ' + TAB_DONGBO + ' đã có — giữ nguyên bảng ánh xạ');
  }
  chuyenCauHinh(layTabCauHinh(ss), sh, CAU_HINH_BAN_DAU);

  var kq = tinhThayDoi();
  if (!kq.ok) { Logger.log('Lỗi: ' + kq.loi); return; }
  var doi = kq.mon.filter(function (m) { return m.trangThai !== 'giu'; });
  Logger.log('Đọc thử: ' + kq.mon.length + ' món được đồng bộ · cần đổi: ' + doi.length);
  kq.canhBao.forEach(function (c) { Logger.log('  [' + c.loai + '] ' + c.noiDung); });
}

/* ══════════════════ TAB CauHinh (dùng chung cho mọi công cụ — cùng đoạn code ở mọi script) ══════════════════ */
/* { chuanHoa(tên trường): giá trị } — chưa có tab thì rỗng */
function docCauHinhChung(ss) {
  var sh = ss.getSheetByName(TAB_CAU_HINH), gt = {};
  if (!sh) return gt;
  var hang = sh.getDataRange().getValues(), td = hang[0] || [];
  var cTr = timCot(td, TD_TRUONG), cGt = timCot(td, TD_GIA_TRI);
  if (cTr < 0 || cGt < 0) return gt;
  for (var i = 1; i < hang.length; i++) { var t = chuanHoa(hang[i][cTr]); if (t && !(t in gt)) gt[t] = hang[i][cGt]; }
  return gt;
}

function tenCuaTruong(t) { return [t.ten].concat(t.bietDanh || []); }

function timTruong(ten) {
  for (var i = 0; i < TRUONG.length; i++) if (chuanHoa(TRUONG[i].ten) === chuanHoa(ten)) return TRUONG[i];
  return null;
}

function layTheoTen(gt, ds) {
  for (var i = 0; i < ds.length; i++) { var k = chuanHoa(ds[i]); if (k in gt) return gt[k]; }
  return undefined;
}

/* Khối cấu hình kiểu cũ (Trường | Giá trị | Ghi chú) nằm trong tab riêng của công cụ — null nếu không có */
function khoiCu(sh) {
  if (!sh) return null;
  var hang = sh.getDataRange().getValues(), td = hang[0] || [];
  var k = { cTr: timCot(td, TD_TRUONG), cGt: timCot(td, TD_GIA_TRI), cGc: timCot(td, TD_GHI_CHU), gt: {}, cuoi: 1 };
  if (k.cTr < 0 || k.cGt < 0) return null;
  for (var i = 1; i < hang.length; i++) { var t = chuanHoa(hang[i][k.cTr]); if (t) { k.gt[t] = hang[i][k.cGt]; k.cuoi = i + 1; } }
  return k;
}

function layTabCauHinh(ss) {
  var sh = ss.getSheetByName(TAB_CAU_HINH);
  if (sh) return sh;
  sh = ss.insertSheet(TAB_CAU_HINH, ss.getNumSheets());
  sh.getRange(1, 1, 1, 4).setValues([[TD_TRUONG, TD_GIA_TRI, TD_GHI_CHU, TD_DUNG_CHO]])
    .setFontWeight('bold').setBackground('#2f5233').setFontColor('#f6f1e4');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 320); sh.setColumnWidth(3, 420); sh.setColumnWidth(4, 170);
  Logger.log('Đã tạo tab ' + TAB_CAU_HINH + ' — KHÔNG đưa tab này vào "Xuất bản lên web"');
  return sh;
}

/* Đưa các trường của công cụ này vào tab CauHinh:
   - CauHinh chưa có trường → thêm dòng, giá trị lấy từ khối cũ (nếu có) hoặc mặc định
   - CauHinh đã có (do công cụ khác thêm) → giữ nguyên giá trị; khối cũ khác giá trị thì ghi log cho biết.
     Ghi chú / Dùng cho thì cập nhật theo bản mới (trường dùng chung có cùng chữ ở mọi script)
   Xong thì xoá khối cũ trong tab của công cụ để chỉ còn một chỗ sửa. Dòng khác trong CauHinh (PIN…) không đụng tới. */
function chuyenCauHinh(shCH, shCu, banDau) {
  var hang = shCH.getDataRange().getValues(), td = hang[0] || [];
  var cTr = timCot(td, TD_TRUONG), cGt = timCot(td, TD_GIA_TRI), cGc = timCot(td, TD_GHI_CHU), cDc = timCot(td, TD_DUNG_CHO);
  if (cTr < 0 || cGt < 0) { Logger.log('Tab ' + TAB_CAU_HINH + ' thiếu tiêu đề Trường / Giá trị — chưa chuyển được cấu hình'); return false; }
  var coCH = {}, dongCH = {}, cuoi = 1;
  for (var i = 1; i < hang.length; i++) { var t = String(hang[i][cTr] || '').trim(); if (t) { coCH[chuanHoa(t)] = hang[i][cGt]; dongCH[chuanHoa(t)] = i; cuoi = i + 1; } }
  var cu = khoiCu(shCu), soThem = 0;
  banDau.forEach(function (row) {
    var tr = timTruong(row[0]), ds = tr ? tenCuaTruong(tr) : [row[0]];
    var vCH = layTheoTen(coCH, ds), vCu = cu ? layTheoTen(cu.gt, ds) : undefined;
    if (vCH !== undefined) {
      if (vCu !== undefined && String(vCu).trim() !== String(vCH).trim())
        Logger.log('  ! "' + row[0] + '": tab ' + TAB_CAU_HINH + ' đang là "' + vCH + '", khối cũ là "' + vCu + '" — giữ giá trị ở ' + TAB_CAU_HINH);
      var d = layTheoTen(dongCH, ds);
      [[cGc, row[2]], [cDc, row[3]]].forEach(function (x) {
        if (x[0] >= 0 && String(hang[d][x[0]] == null ? '' : hang[d][x[0]]) !== String(x[1])) {
          shCH.getRange(d + 1, x[0] + 1).setValue(x[1]);
          Logger.log('  ~ ' + row[0] + ': cập nhật cột ' + td[x[0]]);
        }
      });
      return;
    }
    var r = cuoi + 1 + soThem++;
    shCH.getRange(r, cTr + 1).setValue(row[0]);
    shCH.getRange(r, cGt + 1).setNumberFormat('@').setValue(vCu !== undefined ? vCu : row[1]);
    if (cGc >= 0) shCH.getRange(r, cGc + 1).setValue(row[2]);
    if (cDc >= 0) shCH.getRange(r, cDc + 1).setValue(row[3]);
    Logger.log('  + ' + row[0] + (vCu !== undefined ? ' — chép từ khối cũ' : ' — giá trị mặc định'));
  });
  if (!soThem) Logger.log('Tab ' + TAB_CAU_HINH + ' đủ trường của công cụ này');
  if (cu) {
    xoaKhoiCu(shCu, cu);
    Logger.log('Đã xoá khối cấu hình cũ ở tab ' + shCu.getName() + ' — từ nay sửa ở tab ' + TAB_CAU_HINH);
  }
  return true;
}

function xoaKhoiCu(sh, k) {
  [k.cTr, k.cGt, k.cGc].forEach(function (c) {
    if (c >= 0) sh.getRange(1, c + 1, k.cuoi, 1).clearContent().setBackground(null).setFontWeight('normal');
  });
  sh.getRange(1, k.cTr + 1).setValue('Cấu hình → tab ' + TAB_CAU_HINH).setFontWeight('bold');
}

/* Mã PIN chung (tab CauHinh) — cần cho mọi lệnh đọc và ghi. Sai / thiếu thì chờ 2 giây như sổ bán hàng (chống dò PIN). */
var TRUONG_PIN = 'Mã PIN chung';
function kiemPin(ss, pin) {
  var dung = layTheoTen(docCauHinhChung(ss), [TRUONG_PIN]);
  if (dung === undefined || chuanPin(dung) === '')
    return { ok: false, maLoi: 'THIEU_PIN', loi: 'Chưa có "' + TRUONG_PIN + '" trong tab ' + TAB_CAU_HINH + ' — chưa ghi được' };
  if (chuanPin(pin) !== chuanPin(dung)) {
    Utilities.sleep(2000);
    return { ok: false, maLoi: 'PIN', loi: 'Sai mã PIN — xem ô "' + TRUONG_PIN + '" ở tab ' + TAB_CAU_HINH };
  }
  return { ok: true };
}

/* So PIN giống sổ bán hàng (bayich2_pos/appsscript): bỏ mọi khoảng trắng và số 0 đầu — ô PIN bị Sheet đổi thành số vẫn khớp */
function chuanPin(s) { return String(s == null ? '' : s).replace(/\s+/g, '').replace(/^0+(?=\d)/, ''); }

/* ══════════════════ phụ trợ ══════════════════ */
function lamTron(v, buoc) { return Math.round(v / buoc) * buoc; }

/* Số từ ô Sheet: số giữ nguyên, chữ kiểu "17.000" / "0,5" thì bóc ra. Trống → null */
function soThuc(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function soHoa(v) {
  var n = soThuc(v);
  return n == null ? null : Math.round(n);
}

function chuanHoa(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function timCot(tieuDe, ten) {
  var can = chuanHoa(ten);
  for (var i = 0; i < tieuDe.length; i++) if (chuanHoa(tieuDe[i]) === can) return i;
  return -1;
}

function khoaO(dich, ten, cot) { return dich + '|' + chuanHoa(ten) + '|' + cot; }

function congKhai(m) {
  var gia = {};
  Object.keys(m.gia).forEach(function (c) { gia[c] = { cu: m.gia[c].cu, moi: m.gia[c].moi, doi: m.gia[c].doi }; });
  return { dich: m.dich, ten: m.ten, nguon: m.nguon, heSo: m.heSo, gia: gia, trangThai: m.trangThai, nhay: m.nhay };
}

function gan(a, b) { for (var k in b) a[k] = b[k]; return a; }
function loi(noiDung) { return { loai: 'loi', noiDung: noiDung }; }
function luuY(noiDung) { return { loai: 'luuY', noiDung: noiDung }; }

function traLoi(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
