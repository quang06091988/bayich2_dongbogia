/**
 * Apps Script STANDALONE "bayich2_dongbogia"
 *
 * Đồng bộ giá từ tab Retail (sheet bayich2) sang:
 *   - tab Menu    (sheet bayich2)  : Giá     = Giá Làm Tròn
 *   - tab SanPham (sheet vanbaobi) : Giá Lẻ  = Giá Làm Tròn
 *                                    Giá Sỉ  = Giá Nhập Lẻ
 * theo bảng ánh xạ ở tab DongBo (sheet bayich2).
 *
 *  ĐỌC : doGet?viec=xemTruoc → danh sách thay đổi dự kiến, KHÔNG ghi gì.
 *  GHI : doPost {hanhDong:'dongBo', chon:[{dich, ten, cot, cu, moi}]}
 *
 * An toàn dù web app mở cho "Bất kỳ ai": máy chủ TỰ TÍNH giá từ Retail,
 * client không bao giờ gửi giá để ghi. `cu`/`moi` chỉ dùng để đối chiếu:
 * một ô chỉ được ghi khi giá đang có == cu VÀ giá tính lại == moi.
 * Người lạ gọi được endpoint cũng chỉ làm được đúng việc "áp dụng đồng bộ
 * theo Retail", không chèn được giá tuỳ ý.
 *
 * CÔNG THỨC (lamTron = làm tròn tới 1.000):
 *   Menu    : Giá    = lamTron(hệ số × Σ Giá Làm Tròn của các nguồn)
 *   SanPham : Giá Lẻ = lamTron(hệ số × Σ Giá Làm Tròn)
 *             Giá Sỉ = làm tròn đồng (hệ số × Σ Giá Nhập Lẻ)
 *   → món ghép (Ly Cà Phê = Ly + Nắp): nguồn "A + B"
 *   → món nửa ký: hệ số 0,5
 *
 * CÀI LẦN ĐẦU: mở script → chọn hàm caiDat → Run → Cho phép.
 */

var ID_BAYICH2  = '1Wd4Zvq2xiIiEzou_dvE2YtOk-bJJhAD7se0yREYe9c8';
var ID_VANBAOBI = '1_uLLmtux8CgvGLZTHgK8oE6EdjOAppXC934Ro7Dv5o8';

var TAB_RETAIL = 'Retail';
var TAB_DONGBO = 'DongBo';

/* Cột trong Retail (1 = A) */
var R_TEN = 1;            // A — Mặt Hàng
var R_GIA_NHAP_LE = 6;    // F — Giá Nhập Lẻ   (công thức)
var R_GIA_LAM_TRON = 9;   // I — Giá Làm Tròn  (công thức)

/* Mỗi đích: sheet nào, tab nào, cột tên, các cột giá được ghi và cách tính.
   Cột tìm theo TÊN TIÊU ĐỀ nên có đảo thứ tự cột cũng không ghi nhầm. */
var DICH = {
  Menu: {
    idSheet: ID_BAYICH2, tab: 'Menu', cotTen: 'Tên sản phẩm',
    cot: [{ ten: 'Giá', tinh: 'lamTron' }]
  },
  SanPham: {
    idSheet: ID_VANBAOBI, tab: 'SanPham', cotTen: 'Tên',
    cot: [{ ten: 'Giá Lẻ', tinh: 'lamTron' }, { ten: 'Giá Sỉ', tinh: 'nhapLe' }]
  }
};

var TOI_DA_DONG_GHI = 300;

/* Bảng ánh xạ điền sẵn khi tạo tab DongBo lần đầu (Đích, Tên ở đích, Nguồn, Hệ số) */
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
  return {
    ok: true,
    thayDoi: kq.thayDoi.map(congKhai),
    canhBao: kq.canhBao,
    thoiGian: new Date().toISOString()
  };
}

/* ══════════════════ GHI ══════════════════ */
function doPost(e) {
  var khoa = LockService.getScriptLock();
  if (!khoa.tryLock(15000))
    return traLoi({ ok: false, loi: 'Đang có một lần ghi khác chạy, thử lại sau ít giây' });
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.hanhDong !== 'dongBo') return traLoi({ ok: false, loi: 'Hành động không hợp lệ' });
    if (!Array.isArray(d.chon) || !d.chon.length) return traLoi({ ok: false, loi: 'Chưa chọn dòng nào để ghi' });
    if (d.chon.length > TOI_DA_DONG_GHI) return traLoi({ ok: false, loi: 'Quá nhiều dòng trong một lần ghi' });

    /* Tính lại từ đầu — không tin bất kỳ con số nào client gửi lên */
    var kq = tinhToan();
    var theoKhoa = {};
    kq.thayDoi.forEach(function (t) { theoKhoa[khoaDong(t.dich, t.ten, t.cot)] = t; });

    var daGhi = [], boQua = [];
    d.chon.forEach(function (c) {
      c = c || {};
      var nhan = { dich: String(c.dich || ''), ten: String(c.ten || ''), cot: String(c.cot || '') };
      var t = theoKhoa[khoaDong(nhan.dich, nhan.ten, nhan.cot)];
      if (!t) { boQua.push(gan(nhan, { lyDo: 'Không còn trong bảng ánh xạ DongBo' })); return; }
      if (!t.doi) { boQua.push(gan(nhan, { lyDo: 'Đã đúng giá, không cần ghi' })); return; }
      if (t.cu !== c.cu) { boQua.push(gan(nhan, { lyDo: 'Giá trong sheet đã khác lúc xem trước', trongSheet: t.cu })); return; }
      if (t.moi !== c.moi) { boQua.push(gan(nhan, { lyDo: 'Retail vừa đổi, giá tính lại đã khác', tinhLai: t.moi })); return; }

      var o = t._sh.getRange(t._dong, t._cot);
      if (typeof o.getValue() === 'string') o.setNumberFormat('#,##0');   // ô đang lưu chữ → chuyển sang số
      o.setValue(t.moi);
      daGhi.push({ dich: t.dich, ten: t.ten, cot: t.cot, cu: t.cu, moi: t.moi });
    });
    SpreadsheetApp.flush();

    return traLoi({ ok: true, daGhi: daGhi, boQua: boQua, xemTruoc: tinhThayDoi() });
  } catch (err) {
    return traLoi({ ok: false, loi: String(err) });
  } finally {
    khoa.releaseLock();
  }
}

/* ══════════════════ TÍNH TOÁN ══════════════════ */
function tinhToan() {
  var ssB = SpreadsheetApp.openById(ID_BAYICH2);
  var ssV = SpreadsheetApp.openById(ID_VANBAOBI);
  var canhBao = [];

  var retail = docRetail(ssB, canhBao);
  var anhXa = docDongBo(ssB, canhBao);
  var bang = {
    Menu: docDich(ssB, DICH.Menu, canhBao),
    SanPham: docDich(ssV, DICH.SanPham, canhBao)
  };

  var thayDoi = [], daDung = {}, daKhai = {};
  anhXa.forEach(function (m) {
    var cfg = DICH[m.dich], b = bang[m.dich];
    if (!b) return;   // tab đích lỗi — đã có cảnh báo

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
      var r = retail[chuanHoa(n)];
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

    var i = dongs[0];   // chỉ số trong mảng giá trị (0 = tiêu đề)
    cfg.cot.forEach(function (c) {
      var moi = c.tinh === 'lamTron' ? lamTron(m.heSo * tongTron) : Math.round(m.heSo * tongNhapLe);
      var cu = soHoa(b.hang[i][b.cot[c.ten]]);
      thayDoi.push({
        dich: m.dich,
        ten: String(b.hang[i][b.cotTen]).trim(),
        cot: c.ten,
        nguon: nguon.map(function (r) { return r.ten; }),
        heSo: m.heSo,
        cu: cu, moi: moi, doi: cu !== moi,
        _sh: b.sh, _dong: i + 1, _cot: b.cot[c.ten] + 1
      });
    });
  });

  Object.keys(retail).forEach(function (k) {
    if (!daDung[k]) canhBao.push(luuY('Retail "' + retail[k].ten + '" chưa được đồng bộ đi đâu'));
  });

  return { thayDoi: thayDoi, canhBao: canhBao };
}

function docRetail(ss, canhBao) {
  var sh = ss.getSheetByName(TAB_RETAIL);
  if (!sh) { canhBao.push(loi('Không tìm thấy tab ' + TAB_RETAIL)); return {}; }
  var n = sh.getLastRow(), kq = {};
  if (n < 2) return kq;
  sh.getRange(2, 1, n - 1, R_GIA_LAM_TRON).getValues().forEach(function (d) {
    var ten = String(d[R_TEN - 1] || '').trim();
    if (!ten) return;
    kq[chuanHoa(ten)] = {
      ten: ten,
      nhapLe: soThuc(d[R_GIA_NHAP_LE - 1]),
      lamTron: soHoa(d[R_GIA_LAM_TRON - 1])
    };
  });
  return kq;
}

function docDongBo(ss, canhBao) {
  var sh = ss.getSheetByName(TAB_DONGBO);
  if (!sh) { canhBao.push(loi('Chưa có tab ' + TAB_DONGBO + ' trong sheet bayich2 — chạy hàm caiDat một lần')); return []; }
  var n = sh.getLastRow(), kq = [];
  if (n < 2) return kq;
  sh.getRange(2, 1, n - 1, 4).getValues().forEach(function (d, i) {
    var dong = i + 2;
    var dichTho = String(d[0] || '').trim(), ten = String(d[1] || '').trim(), nguonTho = String(d[2] || '').trim();
    if (!dichTho && !ten && !nguonTho) return;   // dòng trống

    var dich = null;
    Object.keys(DICH).forEach(function (k) { if (chuanHoa(k) === chuanHoa(dichTho)) dich = k; });
    if (!dich) { canhBao.push(loi('DongBo dòng ' + dong + ': Đích "' + dichTho + '" không hợp lệ (chỉ nhận Menu hoặc SanPham)')); return; }
    if (!ten || !nguonTho) { canhBao.push(loi('DongBo dòng ' + dong + ': thiếu Tên ở đích hoặc Nguồn')); return; }

    var heSo = d[3] === '' || d[3] == null ? 1 : soThuc(d[3]);
    if (heSo == null || heSo <= 0) { canhBao.push(loi('DongBo dòng ' + dong + ': Hệ số "' + d[3] + '" không hợp lệ')); return; }

    kq.push({
      dong: dong, dich: dich, ten: ten, heSo: heSo,
      nguon: nguonTho.split('+').map(function (s) { return s.trim(); }).filter(Boolean)
    });
  });
  return kq;
}

function docDich(ss, cfg, canhBao) {
  var sh = ss.getSheetByName(cfg.tab);
  if (!sh) { canhBao.push(loi('Không tìm thấy tab ' + cfg.tab + ' trong sheet ' + ss.getName())); return null; }
  var hang = sh.getDataRange().getValues();
  if (!hang.length) { canhBao.push(loi('Tab ' + cfg.tab + ' đang trống')); return null; }

  var tieuDe = hang[0];
  var cotTen = timCot(tieuDe, cfg.cotTen);
  if (cotTen < 0) { canhBao.push(loi('Tab ' + cfg.tab + ' không có cột "' + cfg.cotTen + '"')); return null; }
  var cot = {};
  for (var j = 0; j < cfg.cot.length; j++) {
    var idx = timCot(tieuDe, cfg.cot[j].ten);
    if (idx < 0) { canhBao.push(loi('Tab ' + cfg.tab + ' không có cột "' + cfg.cot[j].ten + '"')); return null; }
    cot[cfg.cot[j].ten] = idx;
  }

  var theoTen = {};
  for (var i = 1; i < hang.length; i++) {
    var k = chuanHoa(hang[i][cotTen]);
    if (!k) continue;
    (theoTen[k] = theoTen[k] || []).push(i);
  }
  return { sh: sh, hang: hang, cotTen: cotTen, cot: cot, theoTen: theoTen };
}

/* ══════════════════ CÀI LẦN ĐẦU ══════════════════ */
/* Chạy tay 1 lần trong trình soạn Apps Script: tạo tab DongBo (nếu chưa có)
   và để Google xin quyền mở cả 2 sheet. Chạy lại không sao — tab có rồi thì giữ nguyên. */
function caiDat() {
  var ss = SpreadsheetApp.openById(ID_BAYICH2);
  var sh = ss.getSheetByName(TAB_DONGBO);
  if (!sh) {
    sh = ss.insertSheet(TAB_DONGBO, ss.getNumSheets());
    var dong = [['Đích', 'Tên ở đích', 'Nguồn (Retail)', 'Hệ số']].concat(ANH_XA_MAC_DINH);
    sh.getRange(1, 1, dong.length, 4).setValues(dong);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#2f5233').setFontColor('#f6f1e4');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 90);
    sh.setColumnWidth(2, 210);
    sh.setColumnWidth(3, 300);
    sh.setColumnWidth(4, 70);
    sh.getRange(1, 1).setNote('Menu = tab Menu (sheet bayich2)\nSanPham = tab SanPham (sheet vanbaobi)');
    sh.getRange(1, 2).setNote('Tên đúng như trong tab đích. Mỗi món một dòng.');
    sh.getRange(1, 3).setNote('Tên "Mặt Hàng" trong Retail.\nMón ghép: nối bằng dấu +\nvd: Ly Trơn 360ml + Nắp Hữu Phong 95mm');
    sh.getRange(1, 4).setNote('Để trống = 1.\nMón nửa ký: 0,5');
    Logger.log('Đã tạo tab ' + TAB_DONGBO + ' với ' + ANH_XA_MAC_DINH.length + ' dòng');
  } else {
    Logger.log('Tab ' + TAB_DONGBO + ' đã có — giữ nguyên');
  }

  Logger.log('Mở được sheet vanbaobi: ' + SpreadsheetApp.openById(ID_VANBAOBI).getName());

  var kq = tinhThayDoi();
  var doi = kq.thayDoi.filter(function (t) { return t.doi; });
  Logger.log('Ô được đồng bộ: ' + kq.thayDoi.length + ' · cần đổi: ' + doi.length);
  doi.forEach(function (t) { Logger.log('  ' + t.dich + ' · ' + t.ten + ' · ' + t.cot + ': ' + t.cu + ' → ' + t.moi); });
  kq.canhBao.forEach(function (c) { Logger.log('  [' + c.loai + '] ' + c.noiDung); });
}

/* ══════════════════ phụ trợ ══════════════════ */
function lamTron(v) { return Math.round(v / 1000) * 1000; }

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

function khoaDong(dich, ten, cot) { return dich + '|' + chuanHoa(ten) + '|' + cot; }

function congKhai(t) {
  return { dich: t.dich, ten: t.ten, cot: t.cot, nguon: t.nguon, heSo: t.heSo, cu: t.cu, moi: t.moi, doi: t.doi };
}

function gan(a, b) { for (var k in b) a[k] = b[k]; return a; }
function loi(noiDung) { return { loai: 'loi', noiDung: noiDung }; }
function luuY(noiDung) { return { loai: 'luuY', noiDung: noiDung }; }

function traLoi(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
