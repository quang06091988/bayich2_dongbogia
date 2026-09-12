/**
 * Apps Script STANDALONE "bayich2_dongbogia" — backend của trang Đồng Bộ Giá
 * (bayich2-dongbogia.vercel.app).
 *
 * Đồng bộ giá từ tab Retail (sheet bayich2) sang:
 *   - tab Menu    (sheet bayich2)  : Giá     = Giá Làm Tròn          ← giá bán
 *   - tab SanPham (sheet vanbaobi) : Giá Lẻ  = Giá Làm Tròn          ← giá bán
 *                                    Giá Sỉ  = Giá Nhập Lẻ
 * theo khối ánh xạ trong tab DongBo (sheet bayich2).
 *
 *  ĐỌC : doGet?viec=xemTruoc → danh sách món và giá dự kiến, KHÔNG ghi gì.
 *  GHI : doPost {hanhDong:'dongBo', chon:[{dich, ten, cot, cu, moi}]}
 *        rồi tô dòng vừa ghi:  ĐỎ = có đổi giá bán · XANH = chỉ đổi Giá Sỉ
 *
 * An toàn dù web app mở cho "Bất kỳ ai": máy chủ TỰ TÍNH giá từ Retail, client không bao giờ gửi giá
 * để ghi. `cu`/`moi` chỉ để đối chiếu: một ô chỉ được ghi khi giá đang có == cu VÀ giá tính lại == moi.
 *
 * Tab DongBo có 2 khối, tìm theo CHỮ TIÊU ĐỀ (không theo vị trí cột):
 *   Khối ánh xạ : Đích | Tên ở đích | Nguồn (Retail) | Hệ số
 *     → món ghép: nguồn "A + B" (giá = tổng) · món nửa ký: hệ số 0,5
 *   Khối cấu hình: Trường | Giá trị | Ghi chú (sheet Vân Bao Bì, bước làm tròn, ngưỡng cảnh báo, màu…)
 *
 * CÀI / NÂNG CẤP: chọn hàm caiDat → Run (thêm khối còn thiếu; chạy lại không tạo trùng).
 * CẬP NHẬT CODE: clasp push → clasp deploy -i <deploymentId> (link /exec giữ nguyên).
 */

var ID_BAYICH2 = '1Wd4Zvq2xiIiEzou_dvE2YtOk-bJJhAD7se0yREYe9c8';   // nơi có Retail + DongBo (cấu hình)

var TAB_RETAIL = 'Retail';
var TAB_DONGBO = 'DongBo';
var COT_RETAIL = { ten: 'Mặt Hàng', giaNhapLe: 'Giá Nhập Lẻ', giaLamTron: 'Giá Làm Tròn' };

var TD_DICH = 'Đích', TD_TEN = 'Tên ở đích', TD_NGUON = 'Nguồn (Retail)', TD_HESO = 'Hệ số';
var TD_TRUONG = 'Trường', TD_GIA_TRI = 'Giá trị', TD_GHI_CHU = 'Ghi chú';

/* Trường trong khối cấu hình → khoá dùng trong code */
var TRUONG = [
  { khoa: 'sheetVanBaoBi', ten: 'Sheet Vân Bao Bì',      kieu: 'idSheet' },
  { khoa: 'buocLamTron',   ten: 'Bước làm tròn',         kieu: 'so' },
  { khoa: 'nguongNhay',    ten: 'Cảnh báo giá nhảy (%)', kieu: 'so' },
  { khoa: 'mauDo',         ten: 'Màu đổi giá bán',       kieu: 'mau' },
  { khoa: 'mauXanh',       ten: 'Màu chỉ đổi giá sỉ',    kieu: 'mau' },
  { khoa: 'xoaMauCu',      ten: 'Xoá màu cũ khi ghi',    kieu: 'coKhong' }
];

/* Mỗi đích: tab nào, cột tên, các cột giá, cách tính và cột nào là GIÁ BÁN (quyết màu đỏ) */
var DICH = {
  Menu: {
    tab: 'Menu', cotTen: 'Tên sản phẩm',
    cot: [{ ten: 'Giá', tinh: 'lamTron', giaBan: true }]
  },
  SanPham: {
    tab: 'SanPham', cotTen: 'Tên',
    cot: [{ ten: 'Giá Lẻ', tinh: 'lamTron', giaBan: true }, { ten: 'Giá Sỉ', tinh: 'nhapLe', giaBan: false }]
  }
};

var TOI_DA_O_GHI = 300;

/* ══════════════════ ĐỌC ══════════════════ */
function doGet(e) {
  try {
    var viec = (e && e.parameter && e.parameter.viec) || 'ping';
    if (viec === 'xemTruoc') return traLoi(tinhThayDoi());
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
function doPost(e) {
  var khoa = LockService.getScriptLock();
  if (!khoa.tryLock(15000)) return traLoi({ ok: false, loi: 'Đang có một lần ghi khác, thử lại sau ít giây' });
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.hanhDong !== 'dongBo') return traLoi({ ok: false, loi: 'Hành động không hợp lệ' });
    if (!Array.isArray(d.chon) || !d.chon.length) return traLoi({ ok: false, loi: 'Chưa chọn món nào để ghi' });
    if (d.chon.length > TOI_DA_O_GHI) return traLoi({ ok: false, loi: 'Quá nhiều ô trong một lần ghi' });
    return traLoi(dongBo(d.chon));
  } catch (err) {
    return traLoi({ ok: false, loi: String(err) });
  } finally {
    khoa.releaseLock();
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
    return { ok: false, loi: 'Tab DongBo chưa có "Bước làm tròn" trong khối cấu hình — mở Apps Script, chạy hàm caiDat một lần' };

  var retail = docRetail(ssB);
  if (retail.loi) return { ok: false, loi: retail.loi };

  var bang = { Menu: docDich(ssB, DICH.Menu, canhBao) };
  if (ch.sheetVanBaoBi) {
    try { bang.SanPham = docDich(SpreadsheetApp.openById(ch.sheetVanBaoBi), DICH.SanPham, canhBao); }
    catch (err) { canhBao.push(loi('Không mở được Sheet Vân Bao Bì: ' + err.message)); }
  }

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

    var nguon = [], thieu = [];
    m.nguon.forEach(function (n) {
      var r = retail.theoTen[chuanHoa(n)];
      if (r) { nguon.push(r); daDung[chuanHoa(n)] = true; } else thieu.push(n);
    });
    if (thieu.length) { canhBao.push(loi('DongBo dòng ' + m.dong + ': không thấy "' + thieu.join('", "') + '" trong Retail')); return; }

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
      var moi = c.tinh === 'lamTron' ? lamTron(m.heSo * tongTron, ch.buocLamTron) : Math.round(m.heSo * tongNhapLe);
      var cu = soHoa(b.hang[i][cotSo]), doi = cu !== moi;
      if (doi) {
        if (c.giaBan) doiBan = true; else doiSi = true;
        if (cu) nhay = Math.max(nhay, Math.abs(moi - cu) / cu);
      }
      gia[c.ten] = { cu: cu, moi: moi, doi: doi, _cot: cotSo + 1, _giaBan: c.giaBan };
    });
    mon.push({
      dich: m.dich, ten: String(b.hang[i][b.cotTen]).trim(),
      nguon: nguon.map(function (r) { return r.ten; }), heSo: m.heSo,
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
    dich: timCot(td, TD_DICH), ten: timCot(td, TD_TEN), nguon: timCot(td, TD_NGUON), heSo: timCot(td, TD_HESO),
    truong: timCot(td, TD_TRUONG), giaTri: timCot(td, TD_GIA_TRI)
  };

  var cauHinh = {};
  TRUONG.forEach(function (t) { cauHinh[t.khoa] = null; });
  if (c.truong < 0 || c.giaTri < 0) canhBao.push(loi('Tab DongBo chưa có khối cấu hình (' + TD_TRUONG + ' | ' + TD_GIA_TRI + ') — chạy hàm caiDat một lần'));
  else {
    var theoTruong = {};
    for (var i = 1; i < hang.length; i++) {
      var tr = chuanHoa(hang[i][c.truong]);
      if (tr) theoTruong[tr] = hang[i][c.giaTri];
    }
    TRUONG.forEach(function (t) {
      var v = theoTruong[chuanHoa(t.ten)];
      if (v === undefined) { canhBao.push(loi('Tab DongBo thiếu trường "' + t.ten + '"')); return; }
      cauHinh[t.khoa] = docGiaTri(v, t.kieu);
      if (cauHinh[t.khoa] == null && String(v).trim() !== '') canhBao.push(loi('Trường "' + t.ten + '" có giá trị không hợp lệ: ' + v));
      else if (cauHinh[t.khoa] == null && t.khoa === 'sheetVanBaoBi') canhBao.push(luuY('"Sheet Vân Bao Bì" để trống — không đồng bộ SanPham'));
    });
  }

  var anhXa = [];
  if (c.dich < 0 || c.ten < 0 || c.nguon < 0) canhBao.push(loi('Tab DongBo thiếu tiêu đề khối ánh xạ (' + [TD_DICH, TD_TEN, TD_NGUON].join(' | ') + ')'));
  else {
    for (var j = 1; j < hang.length; j++) {
      var dong = j + 1, d = hang[j];
      var dichTho = String(d[c.dich] || '').trim(), ten = String(d[c.ten] || '').trim(), nguonTho = String(d[c.nguon] || '').trim();
      var heSoTho = c.heSo < 0 ? '' : d[c.heSo];
      if (!dichTho && !ten && !nguonTho) continue;   // dòng trống (hoặc dòng chỉ thuộc khối cấu hình)

      var dich = null;
      Object.keys(DICH).forEach(function (k) { if (chuanHoa(k) === chuanHoa(dichTho)) dich = k; });
      if (!dich) { canhBao.push(loi('DongBo dòng ' + dong + ': Đích "' + dichTho + '" không hợp lệ (chỉ nhận Menu hoặc SanPham)')); continue; }
      if (!ten || !nguonTho) { canhBao.push(loi('DongBo dòng ' + dong + ': thiếu Tên ở đích hoặc Nguồn')); continue; }
      var heSo = heSoTho === '' || heSoTho == null ? 1 : soThuc(heSoTho);
      if (heSo == null || heSo <= 0) { canhBao.push(loi('DongBo dòng ' + dong + ': Hệ số "' + heSoTho + '" không hợp lệ')); continue; }
      anhXa.push({
        dong: dong, dich: dich, ten: ten, heSo: heSo,
        nguon: nguonTho.split('+').map(function (s) { return s.trim(); }).filter(Boolean)
      });
    }
  }
  return { anhXa: anhXa, cauHinh: cauHinh };
}

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
  if (kieu === 'idSheet') {   // nhận cả link lẫn ID trần
    var m = s.match(/\/d\/([a-zA-Z0-9_-]{25,})/) || s.match(/^([a-zA-Z0-9_-]{25,})$/);
    return m ? m[1] : null;
  }
  return s;
}

/* ══════════════════ CÀI / NÂNG CẤP ══════════════════ */
/* Chạy tay trong trình soạn Apps Script. Thêm khối nào còn thiếu; khối đã có thì giữ nguyên.
   Dữ liệu dưới đây chỉ để điền lần đầu — sau đó sửa trong Sheet, không sửa ở đây. */
var CAU_HINH_BAN_DAU = [
  ['Sheet Vân Bao Bì', 'https://docs.google.com/spreadsheets/d/1_uLLmtux8CgvGLZTHgK8oE6EdjOAppXC934Ro7Dv5o8/edit', 'Link hoặc ID sheet có tab SanPham. Để trống = không đồng bộ SanPham'],
  ['Bước làm tròn', 1000, 'Giá bán (Menu, Giá Lẻ) làm tròn tới bội số này'],
  ['Cảnh báo giá nhảy (%)', 30, 'Giá đổi từ mức này trở lên → bỏ tích sẵn để xem lại'],
  ['Màu đổi giá bán', '#f4cccc', 'Tô dòng có đổi giá bán (Menu Giá / SanPham Giá Lẻ). Để trống = không tô'],
  ['Màu chỉ đổi giá sỉ', '#d9ead3', 'Tô dòng chỉ đổi Giá Sỉ. Để trống = không tô'],
  ['Xoá màu cũ khi ghi', 'Có', 'Có / Không — áp cho cả Menu và SanPham']
];
var ANH_XA_MAC_DINH = [
  ['Menu', 'Ly 360ml', 'Ly Trơn 360ml', ''],
  ['Menu', 'Ly 500ml', 'Ly Trơn 500ml', ''],
  ['Menu', 'Ly 650ml', 'Ly Trơn 650ml', ''],
  ['Menu', 'Ly 720ml', 'Ly Trơn 720ml', ''],
  ['Menu', 'Nắp Hữu Phong 95mm', 'Nắp Hữu Phong 95mm', ''],
  ['Menu', 'Nắp Cầu Tròn 95mm', 'Nắp Cầu Tròn 95mm', ''],
  ['Menu', 'Nắp Bằng Cao 95mm', 'Nắp Bằng Cao 95mm', ''],
  ['Menu', 'Nắp Hữu Phong 116mm', 'Nắp Hữu Phong 116mm', ''],
  ['Menu', 'Ly Cà Phê (Nắp Thường)', 'Ly Trơn 360ml + Nắp Hữu Phong 95mm', ''],
  ['Menu', 'Ly Cà Phê (Nắp Cầu)', 'Ly Trơn 360ml + Nắp Cầu Tròn 95mm', ''],
  ['Menu', 'Ly Sinh Tố (Kèm Nắp)', 'Ly Trơn 650ml + Nắp Cầu Tròn 95mm', ''],
  ['Menu', 'Ly Trà Tắc (Kèm Nắp)', 'Ly Trơn 720ml + Nắp Hữu Phong 116mm', ''],
  ['Menu', 'Ống Cà Phê', 'Ống Hút Trong 6mm, 8mm', ''],
  ['Menu', 'Ống Sinh Tố', 'Ống Hút Trong 6mm, 8mm', ''],
  ['Menu', 'Muỗng Ngắn', 'Muỗng GT 150mm', ''],
  ['Menu', 'Muỗng Dài', 'Muỗng GT 200mm', ''],
  ['Menu', 'Bị 1 Ly', 'Bị 1 Ly, 2 Ly Lớn', ''],
  ['Menu', 'Bị 2 Ly', 'Bị 1 Ly, 2 Ly Lớn', ''],
  ['Menu', 'Bị Ngang', 'Bị Ngang Lớn', ''],
  ['Menu', 'Bị 1 Ly (Nửa Ký)', 'Bị 1 Ly, 2 Ly Lớn', 0.5],
  ['Menu', 'Bị 2 Ly (Nửa Ký)', 'Bị 1 Ly, 2 Ly Lớn', 0.5],
  ['Menu', 'Bị Ngang (Nửa Ký)', 'Bị Ngang Lớn', 0.5],
  ['SanPham', 'Ly Trơn 360ml', 'Ly Trơn 360ml', ''],
  ['SanPham', 'Ly Trơn 500ml', 'Ly Trơn 500ml', ''],
  ['SanPham', 'Ly Trơn 650ml', 'Ly Trơn 650ml', ''],
  ['SanPham', 'Ly Trơn 720ml', 'Ly Trơn 720ml', ''],
  ['SanPham', 'Nắp Hữu Phong 95mm', 'Nắp Hữu Phong 95mm', ''],
  ['SanPham', 'Nắp Cầu Tròn 95mm', 'Nắp Cầu Tròn 95mm', ''],
  ['SanPham', 'Nắp Bằng Cao 95mm', 'Nắp Bằng Cao 95mm', ''],
  ['SanPham', 'Nắp Hữu Phong 116mm', 'Nắp Hữu Phong 116mm', ''],
  ['SanPham', 'Ống Hút Trong 6mm', 'Ống Hút Trong 6mm, 8mm', ''],
  ['SanPham', 'Ống Hút Trong 8mm', 'Ống Hút Trong 6mm, 8mm', ''],
  ['SanPham', 'Muỗng GT 150mm', 'Muỗng GT 150mm', ''],
  ['SanPham', 'Muỗng GT 200mm', 'Muỗng GT 200mm', ''],
  ['SanPham', 'Bị 1 Ly Lớn', 'Bị 1 Ly, 2 Ly Lớn', ''],
  ['SanPham', 'Bị 2 Ly Lớn', 'Bị 1 Ly, 2 Ly Lớn', ''],
  ['SanPham', 'Bị Ngang Lớn', 'Bị Ngang Lớn', ''],
  ['SanPham', 'Bị 40 Dương', 'Bị 40 Dương', ''],
  ['SanPham', 'Bị 50 Dương', 'Bị 50 Dương', '']
];

function caiDat() {
  var ss = SpreadsheetApp.openById(ID_BAYICH2);
  var sh = ss.getSheetByName(TAB_DONGBO);
  if (!sh) {
    sh = ss.insertSheet(TAB_DONGBO, ss.getNumSheets());
    var dong = [[TD_DICH, TD_TEN, TD_NGUON, TD_HESO]].concat(ANH_XA_MAC_DINH);
    sh.getRange(1, 1, dong.length, 4).setValues(dong);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#2f5233').setFontColor('#f6f1e4');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 90); sh.setColumnWidth(2, 210); sh.setColumnWidth(3, 300); sh.setColumnWidth(4, 70);
    Logger.log('Đã tạo tab ' + TAB_DONGBO + ' với khối ánh xạ ' + ANH_XA_MAC_DINH.length + ' dòng');
  }

  var tieuDe = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (timCot(tieuDe, TD_TRUONG) >= 0) {
    Logger.log('Khối cấu hình đã có — giữ nguyên');
  } else {
    var cot = Math.max(6, sh.getLastColumn() + 2);   // chừa 1 cột trống bên phải khối ánh xạ
    var o = [[TD_TRUONG, TD_GIA_TRI, TD_GHI_CHU]].concat(CAU_HINH_BAN_DAU);
    sh.getRange(1, cot, o.length, 3).setValues(o);
    sh.getRange(1, cot, 1, 3).setFontWeight('bold').setBackground('#2f5233').setFontColor('#f6f1e4');
    sh.setColumnWidth(cot, 170); sh.setColumnWidth(cot + 1, 300); sh.setColumnWidth(cot + 2, 320);
    Logger.log('Đã thêm khối cấu hình (' + CAU_HINH_BAN_DAU.length + ' trường) vào tab ' + TAB_DONGBO + ', từ cột ' + cot);
  }

  var kq = tinhThayDoi();
  if (!kq.ok) { Logger.log('Lỗi: ' + kq.loi); return; }
  var doi = kq.mon.filter(function (m) { return m.trangThai !== 'giu'; });
  Logger.log('Đọc thử: ' + kq.mon.length + ' món được đồng bộ · cần đổi: ' + doi.length);
  kq.canhBao.forEach(function (c) { Logger.log('  [' + c.loai + '] ' + c.noiDung); });
}

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
