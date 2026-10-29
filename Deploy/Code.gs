// ==========================================
// File: Code.gs  (เวอร์ชันแก้ไข: เสถียร + ปลอดภัยขึ้น)
// ==========================================
// กฎสำคัญ: ฟังก์ชันที่ "ไม่ลงท้ายด้วย _" ทุกตัว หน้าเว็บเรียกได้ (google.script.run)
// ฟังก์ชันที่ไม่ควรให้ใครเรียกจึงต้องลงท้าย _ หรือมี ownerOnly_() ครอบ

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("ระบบจัดการเครื่องมือ")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==================== สิทธิ์ผู้ใช้ (บังคับที่เซิร์ฟเวอร์) ====================
// USER = เบิกของอย่างเดียว | ADMIN = เบิก/คืน/เพิ่ม-แก้อุปกรณ์/ตรวจสอบ/ดูประวัติ | IT = ทำได้ทุกอย่าง
// รหัสผ่านตั้งที่ Project Settings > Script properties: ADMIN_PASSWORD, IT_PASSWORD
// (ไม่มีค่า fallback ในโค้ดแล้ว ถ้าไม่ตั้งจะล็อกอินไม่ได้)
const ROLE_ = { USER: 0, ADMIN: 1, IT: 2 };
const USER_CAN_RETURN = false; // true = ผู้ใช้ทั่วไปคืนของตัวเองได้
const ADMIN_NAMES_ = ["Admin-NOON", "Admin-SOM", "Admin-Macgie", "Admin-AON"]; // PASS : btt12345
const IT_NAMES_ = ["IT-STANG", "IT-KENG", "IT-GOTJI", "IT-Macgie", "IT-AON"]; // PASS : btt12345
const MAX_BORROW_ITEMS_ = 50;

function clean_(v) {
  return String(v || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function pwFor_(role) {
  return clean_(
    PropertiesService.getScriptProperties().getProperty(role + "_PASSWORD"),
  );
}

function roleOfName_(name) {
  var n = normName_(name);
  if (
    IT_NAMES_.some(function (x) {
      return normName_(x) === n;
    })
  )
    return "IT";
  if (
    ADMIN_NAMES_.some(function (x) {
      return normName_(x) === n;
    })
  )
    return "ADMIN";
  return "";
}

function login(name, password) {
  try {
    name = clean_(name);
    password = clean_(password);
    if (!name)
      return {
        success: false,
        message: "กรุณาเลือกหรือพิมพ์ชื่อผู้ใช้งานก่อน",
      };

    var role = roleOfName_(name);
    if (!role)
      return {
        success: false,
        message:
          "ชื่อนี้ไม่มีสิทธิ์เข้าสู่ระบบผู้ดูแล (ใช้งานในฐานะ User ปกติได้)",
      };

    var cache = CacheService.getScriptCache();
    var failKey = "FAIL_" + normName_(name);
    var fails = Number(cache.get(failKey) || 0);
    if (fails >= 5)
      return {
        success: false,
        message: "ใส่รหัสผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่",
      };

    var expected = pwFor_(role); // IT ใช้ IT_PASSWORD เท่านั้น, ADMIN ใช้ ADMIN_PASSWORD
    if (!expected)
      return {
        success: false,
        message:
          "ยังไม่ได้ตั้งรหัสผ่านสิทธิ์ " + role + " ใน Script Properties",
      };

    if (password !== expected) {
      cache.put(failKey, String(fails + 1), 900);
      return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };
    }
    cache.remove(failKey);

    var token = Utilities.getUuid() + Utilities.getUuid();
    cache.put("S_" + token, JSON.stringify({ role: role, name: name }), 21600);
    logActivity_("เข้าสู่ระบบ", "สิทธิ์: " + role, name);
    return { success: true, token: token, role: role, name: name };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function logout(tk) {
  if (tk) CacheService.getScriptCache().remove("S_" + tk);
}

function session_(tk) {
  var s = tk ? CacheService.getScriptCache().get("S_" + tk) : null;
  return s ? JSON.parse(s) : { role: "USER", name: "" };
}

// เช็คสิทธิ์ขั้นต่ำ ถ้าไม่ถึงจะ throw (ต้องเรียกภายใน try ของแต่ละฟังก์ชัน)
function need_(tk, role) {
  var s = session_(tk);
  if (ROLE_[s.role] < ROLE_[role])
    throw new Error(
      "ไม่มีสิทธิ์ทำรายการนี้ (ต้องเป็น " +
        role +
        " ขึ้นไป) กรุณาเข้าสู่ระบบใหม่",
    );
  return s;
}

// ใช้ได้เฉพาะตอนรันจาก Apps Script Editor โดยเจ้าของโปรเจกต์เท่านั้น
// (ผู้เยี่ยมชมเว็บ: active user ว่าง หรือไม่ตรงกับ effective user = เจ้าของ)
function ownerOnly_() {
  var active = "",
    eff = "";
  try {
    active = Session.getActiveUser().getEmail();
  } catch (e) {}
  try {
    eff = Session.getEffectiveUser().getEmail();
  } catch (e) {}
  if (!active || !eff || active.toLowerCase() !== eff.toLowerCase())
    throw new Error("ใช้ได้เฉพาะเจ้าของโปรเจกต์ผ่าน Apps Script Editor");
}

// ---------- Helpers & Utilities ----------
function appUrl_() {
  var stored = PropertiesService.getScriptProperties().getProperty("APP_URL");
  return stored || CONFIG.APP_URL || ScriptApp.getService().getUrl();
}

function getSS_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function ghRawBase_() {
  var gh = CONFIG.GITHUB;
  return (
    "https://raw.githubusercontent.com/" +
    gh.OWNER +
    "/" +
    gh.REPO +
    "/" +
    gh.BRANCH +
    "/"
  );
}

function fixImageFormulas() {
  ownerOnly_();
  var sh = assetSheet_(),
    last = sh.getLastRow();
  if (last < 2) return;
  var f =
    '=IF($D2="","",IMAGE("' +
    ghRawBase_() +
    '"&ENCODEURL($D2)&"/"&ENCODEURL($D2)&".jpg"))';
  sh.getRange(2, CONFIG.COL.IMG + 1, last - 1, 1).setFormula(f);
}

// ดึงรายชื่อไฟล์ใน pic/ จาก GitHub (แคช 5 นาที)
function picIndex_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("PIC_INDEX");
  if (hit) {
    try {
      return JSON.parse(hit);
    } catch (e) {}
  }
  var gh = CONFIG.GITHUB,
    paths = [];
  try {
    var token =
      PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
    var headers = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = "token " + token;
    var r = UrlFetchApp.fetch(
      "https://api.github.com/repos/" +
        gh.OWNER +
        "/" +
        gh.REPO +
        "/git/trees/" +
        gh.BRANCH +
        "?recursive=1",
      { headers: headers, muteHttpExceptions: true },
    );
    if (r.getResponseCode() === 200) {
      JSON.parse(r.getContentText()).tree.forEach(function (t) {
        if (
          t.type === "blob" &&
          /^[^\/]+\/[^\/]+\.(jpe?g|png|webp)$/i.test(t.path)
        )
          paths.push(t.path);
      });
      try {
        cache.put("PIC_INDEX", JSON.stringify(paths), 300);
      } catch (e) {}
    }
  } catch (e) {}
  return paths;
}

// หาทุกรูปของรหัสนี้ เรียง base, (2), (3)... คืนเป็น URL
function picsFor_(code, files) {
  var base = ghRawBase_(),
    key = picKey_(code),
    found = [];
  files.forEach(function (p) {
    var i = p.indexOf("/");
    if (i < 0) return;
    var dir = p.substring(0, i),
      f = p.substring(i + 1);
    if (picKey_(dir) !== key) return;
    var m = PIC_RE_.exec(f);
    if (!m) return;
    found.push({ n: m[2] ? Number(m[2]) : 1, dir: dir, f: f });
  });
  found.sort(function (a, b) {
    return a.n - b.n;
  });
  return found.map(function (x) {
    return base + encodeURIComponent(x.dir) + "/" + encodeURIComponent(x.f);
  });
}

// path ถัดไปของรหัสนี้: ยังไม่มี -> "รหัส/รหัส.jpg", มีแล้ว -> "รหัส/รหัส (n+1).jpg"
function nextPicPath_(code, files, offset) {
  var key = picKey_(code),
    max = 0;
  files.forEach(function (p) {
    var i = p.indexOf("/");
    if (i < 0 || picKey_(p.substring(0, i)) !== key) return;
    var m = PIC_RE_.exec(p.substring(i + 1));
    if (m) max = Math.max(max, m[2] ? Number(m[2]) : 1);
  });
  var n = max + 1 + (offset || 0),
    c = String(code).trim();
  return c + "/" + c + (n > 1 ? " (" + n + ")" : "") + ".jpg";
}

function assetSheet_() {
  return getSS_().getSheetByName(CONFIG.SHEETS.ASSETS);
}

function auditSheet_() {
  return ensureSheet_(CONFIG.SHEETS.AUDIT, "ตรวจสอบข้อมูล (นำเข้า)");
}

// กัน formula injection: ข้อความที่ขึ้นต้นด้วย = + - @ จะถูกใส่ ' นำหน้า
function sanitizeInput_(str) {
  var s = String(str == null ? "" : str).trim();
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function auditVals_(p) {
  return [
    sanitizeInput_(p.issue),
    sanitizeInput_(p.source || p.date),
    sanitizeInput_(p.code),
    sanitizeInput_(p.name),
    sanitizeInput_(p.detail || p.status),
  ];
}

var AUDIT_LABELS_ = ["ประเด็น", "ต้นทาง", "รหัส", "ชื่อรายการ", "รายละเอียด"];

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000))
    throw new Error(
      "ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณารอ 1 นาทีแล้วตรวจว่ารายการก่อนหน้าบันทึกแล้วหรือยัง ก่อนลองใหม่",
    );
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function findAssetRow_(sheet, code) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, CONFIG.COL.ID + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(code).trim()) return i + 2;
  }
  return -1;
}

function setTotal_(sheet, row, total) {
  var cell = sheet.getRange(row, CONFIG.COL.TOTAL + 1);
  if (!cell.getFormula()) cell.setValue(total);
}

function listFrom_(name) {
  var sh = getSS_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh
    .getRange(2, 1, sh.getLastRow() - 1, 1)
    .getValues()
    .map(function (r) {
      return String(r[0]).trim();
    })
    .filter(function (v) {
      return v;
    });
}

function ensureSheet_(name, header) {
  var ss = getSS_(),
    sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow([header]);
  }
  return sh;
}

function addLookup_(name, val) {
  val = sanitizeInput_(val);
  if (!val) return;
  var sh = ensureSheet_(name, name);
  if (listFrom_(name).indexOf(val) < 0) sh.appendRow([val]);
}

function borrowSheet_() {
  var ss = getSS_(),
    sh = ss.getSheetByName(CONFIG.SHEETS.BORROW);
  var head = [
    "ลำดับ",
    "รหัส",
    "ชื่อโครงการ",
    "จำนวน",
    "วันที่เบิก",
    "วันที่คืน",
    "ผู้เบิก",
    "สถานที่",
    "สถานะ",
    "หักจาก BTT",
    "หักจาก TKE",
    "ผู้คืน",
  ];
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEETS.BORROW);
    sh.appendRow(head);
  } else {
    for (var i = 8; i < head.length; i++) {
      if (String(sh.getRange(1, i + 1).getValue()).trim() === "") {
        sh.getRange(1, i + 1).setValue(head[i]);
      }
    }
  }
  return sh;
}

// ---------- 1. ดึงข้อมูลระบบ ----------
function getInitialData(tk) {
  try {
    var sess = session_(tk);
    var isStaff = ROLE_[sess.role] >= ROLE_.ADMIN;
    var isIT = ROLE_[sess.role] >= ROLE_.IT;

    migrateBorrowersOnce_();
    var ss = getSS_(),
      C = CONFIG.COL,
      S = CONFIG.SHEETS;
    var aSheet = ss.getSheetByName(S.ASSETS),
      assets = [];
    if (aSheet && aSheet.getLastRow() > 1) {
      var n = aSheet.getLastRow() - 1;
      assets = aSheet.getRange(2, 1, n, 16).getDisplayValues();
      var picFiles = picIndex_();

      assets.forEach(function (r) {
        var code = String(r[C.ID] || "").trim();
        var rawImg = String(r[C.IMG] || "").trim();
        if (rawImg !== "") {
          r[C.IMG] = rawImg;
        } else if (code) {
          var found = picsFor_(code, picFiles);
          if (found.length) r[C.IMG] = found.join(",");
          else
            r[C.IMG] =
              ghRawBase_() +
              encodeURIComponent(code) +
              "/" +
              encodeURIComponent(code) +
              ".jpg";
        } else {
          r[C.IMG] = "";
        }
      });

      assets = assets.filter(function (r) {
        return String(r[C.ID]).trim() !== "";
      });
    }

    var bSheet = borrowSheet_(),
      borrows = [];
    if (bSheet.getLastRow() > 1) {
      borrows = bSheet
        .getRange(2, 1, bSheet.getLastRow() - 1, 12)
        .getDisplayValues();
      borrows.forEach(function (r, i) {
        var who = r[11];
        r[11] = String(i + 2); // เลขแถวจริงในชีต (ใช้ตอนคืน)
        r[12] = who; // ผู้คืน
      });
    }

    var lSheet = ss.getSheetByName(S.LOGS),
      logs = [];
    if (isStaff && lSheet && lSheet.getLastRow() > 1) {
      logs = lSheet
        .getRange(2, 1, lSheet.getLastRow() - 1, 5)
        .getDisplayValues()
        .reverse()
        .slice(0, 50);
    }

    var audit = [],
      uSheet = ss.getSheetByName(S.AUDIT);
    if (isStaff && uSheet && uSheet.getLastRow() > 1) {
      audit = uSheet
        .getRange(2, 1, uSheet.getLastRow() - 1, 5)
        .getDisplayValues()
        .map(function (r, i) {
          r.push(String(i + 2));
          return r;
        })
        .filter(function (r) {
          return r.slice(0, 5).join("").trim() !== "";
        });
    }

    var borrowers = listFrom_(S.BORROWERS);
    borrows.forEach(function (r) {
      var nm = String(r[6] || "").trim();
      if (
        nm &&
        nm !== "-" &&
        r[8] === "กำลังยืม" &&
        borrowers.indexOf(nm) < 0
      ) {
        borrowers.push(nm);
      }
    });
    borrowers.sort(function (a, b) {
      return a.localeCompare(b, "th");
    });

    var categories = listFrom_(S.CATEGORIES);
    assets.forEach(function (r) {
      if (r[C.CAT] && categories.indexOf(r[C.CAT]) < 0)
        categories.push(r[C.CAT]);
    });

    var unavailableDetail = {};
    assets.forEach(function (r) {
      var s = String(r[C.STATUS] || "").trim();
      if (s !== "พร้อมใช้งาน") {
        s = s || "ไม่ระบุ";
        unavailableDetail[s] = (unavailableDetail[s] || 0) + 1;
      }
    });
    var unavailableCount = 0;
    Object.keys(unavailableDetail).forEach(function (k) {
      unavailableCount += unavailableDetail[k];
    });

    var summary = {
      total: assets.length,
      available: assets.filter(function (r) {
        return r[C.STATUS] === "พร้อมใช้งาน";
      }).length,
      borrowed: borrows.filter(function (r) {
        return r[8] === "กำลังยืม";
      }).length,
      unavailable: unavailableCount,
      unavailableDetail: unavailableDetail,
      lowStockCount: assets.filter(function (r) {
        return r[C.NEEDBUY] === "ต้องซื้อเพิ่ม";
      }).length,
    };

    return {
      success: true,
      role: sess.role,
      name: sess.name,
      assets: assets,
      borrows: isStaff ? borrows : [],
      logs: logs,
      audit: audit,
      categories: categories,
      locations: listFrom_(S.LOCATIONS),
      borrowers: borrowers,
      summary: summary,
      appUrl: appUrl_(),
      sheetUrl: isIT ? ss.getUrl() : "",
      contact: CONFIG.CONTACT || {},
    };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// รันรหัส TO-XXX ถัดไปจากเลขสูงสุดในคอลัมน์รหัส (ประกาศครั้งเดียวเท่านั้น)
function generateNextAssetId_(sheet, colIndex) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return "TO-001";
  var ids = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
  var maxNum = 0;
  for (var i = 0; i < ids.length; i++) {
    var match = String(ids[i][0])
      .trim()
      .match(/^TO-0*(\d+)$/i);
    if (match) {
      var num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return "TO-" + String(maxNum + 1).padStart(3, "0");
}

// ---------- 2. บันทึก / แก้ไข อุปกรณ์ (รหัสว่าง = รันเลขอัตโนมัติ) ----------
function saveAssetData(f) {
  try {
    var sess = need_(f && f.token, "ADMIN");
    f.operator = sess.name || f.operator;
    return withLock_(function () {
      var C = CONFIG.COL,
        sheet = assetSheet_();
      var newId = sanitizeInput_(f.assetId);
      var assetName = sanitizeInput_(f.assetName);
      if (!assetName)
        return { success: false, message: "กรุณากรอกชื่ออุปกรณ์" };

      var oldRow = f.oldAssetId ? findAssetRow_(sheet, f.oldAssetId) : -1;
      var isEdit = oldRow > 0;
      var autoId = !newId;

      if (autoId) newId = generateNextAssetId_(sheet, C.ID);

      var dup = findAssetRow_(sheet, newId);
      // รหัสอัตโนมัติชนกัน -> ขยับเลขไปเรื่อยๆ (จำกัดรอบกัน loop ไม่จบ)
      var guard = 0;
      while (autoId && dup > 0 && dup !== oldRow && guard++ < 1000) {
        var mt = newId.match(/^TO-0*(\d+)$/i);
        var nx = mt ? parseInt(mt[1], 10) + 1 : guard + 1;
        newId = "TO-" + String(nx).padStart(3, "0");
        dup = findAssetRow_(sheet, newId);
      }
      if (dup > 0 && dup !== oldRow)
        return {
          success: false,
          message: "รหัส " + newId + " มีอยู่แล้วในระบบ",
        };

      var nums = [f.assetBtt, f.assetTke, f.assetMin, f.assetPrice];
      for (var k = 0; k < nums.length; k++) {
        var nv = Number(nums[k] || 0);
        if (isNaN(nv) || nv < 0)
          return { success: false, message: "ตัวเลขต้องไม่ติดลบ" };
      }

      var btt = Number(f.assetBtt || 0);
      var tke = Number(f.assetTke || 0);
      var total = btt + tke;
      var min = Number(f.assetMin || 0);
      var price = Number(f.assetPrice || 0);

      var status = sanitizeInput_(f.assetStatus);
      if (!status || status === "พร้อมใช้งาน" || status === "ถูกยืม") {
        status = total > 0 ? "พร้อมใช้งาน" : "ถูกยืม";
      }

      var needBuy = total < min ? "ต้องซื้อเพิ่ม" : "ปกติ";
      var nowStr = Utilities.formatDate(
        new Date(),
        "Asia/Bangkok",
        "yyyy-MM-dd HH:mm:ss",
      );
      var targetRow = isEdit ? oldRow : sheet.getLastRow() + 1;

      var oldVals = [];
      if (isEdit)
        oldVals = sheet.getRange(oldRow, 1, 1, 16).getDisplayValues()[0];
      var maxVal = isEdit ? Number(oldVals[C.MAX]) || 0 : 0;
      if (f.assetMax !== undefined && f.assetMax !== "")
        maxVal = Number(f.assetMax) || 0;

      var catVal = sanitizeInput_(f.assetCat || f.assetCategory);
      var locVal = sanitizeInput_(f.assetLoc || f.assetLocation);
      var remarkVal = sanitizeInput_(f.assetRemark);

      // กำหนดค่าลงในอาร์เรย์ตามลำดับ Index ของคอลัมน์ (คำนวณ Offset จาก C.TIME)
      var mid = [];
      mid[C.TIME - C.TIME] = nowStr;
      mid[C.IMG - C.TIME] = ""; // เว้นว่างไว้รอใส่สูตร IMAGE ในคอลัมน์ IMG
      mid[C.ID - C.TIME] = newId;
      mid[C.NAME - C.TIME] = assetName;
      mid[C.CAT - C.TIME] = catVal;
      mid[C.LOC - C.TIME] = locVal;
      mid[C.MAX - C.TIME] = maxVal;
      mid[C.MIN - C.TIME] = min;
      mid[C.PRICE - C.TIME] = price;
      mid[C.BTT - C.TIME] = btt;
      mid[C.TKE - C.TIME] = tke;

      // บันทึกข้อมูลช่วง C.TIME ถึง C.TKE
      sheet
        .getRange(targetRow, C.TIME + 1, 1, C.TKE - C.TIME + 1)
        .setValues([mid]);

      // ตั้งค่าสูตรแสดงรูปภาพจาก GitHub แบบอัตโนมัติ
      sheet
        .getRange(targetRow, C.IMG + 1)
        .setFormula(
          "=IF($D" +
            targetRow +
            '="","",IMAGE("' +
            ghRawBase_() +
            '"&ENCODEURL($D' +
            targetRow +
            ')&"/"&ENCODEURL($D' +
            targetRow +
            ')&".jpg"))',
        );

      // คำนวณ ยอดรวม (TOTAL) และ สถานะต้องซื้อเพิ่ม (NEEDBUY)
      setTotal_(sheet, targetRow, total);
      var nbCell = sheet.getRange(targetRow, C.NEEDBUY + 1);
      if (!nbCell.getFormula()) nbCell.setValue(needBuy);

      sheet.getRange(targetRow, C.STATUS + 1).setValue(status);
      sheet.getRange(targetRow, C.REMARK + 1).setValue(remarkVal);

      // ใส่สูตรสร้าง QR Code ถ้าเป็นการเพิ่มอุปกรณ์ใหม่
      var url = appUrl_();
      if (!isEdit && url) {
        sheet
          .getRange(targetRow, C.QR + 1)
          .setFormula(
            "=IF($D" +
              targetRow +
              '="","",IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=150x150&data="&ENCODEURL("' +
              url +
              '?code="&$D' +
              targetRow +
              ")))",
          );
      }

      // อัปเดตรายการ Lookup หมวดหมู่ และ สถานที่จัดเก็บ
      addLookup_(CONFIG.SHEETS.CATEGORIES, catVal);
      addLookup_(CONFIG.SHEETS.LOCATIONS, locVal);

      if (f.auditRow) {
        try {
          deleteAuditRowCore_(f.auditRow, newId, assetName, f.operator);
        } catch (e) {}
      }

      // บันทึก Log การทำงาน
      var actionType = isEdit ? "แก้ไขอุปกรณ์" : "เพิ่มอุปกรณ์";
      var logDetail = "";
      if (isEdit) {
        var changes = [];
        if (oldVals[C.ID] !== newId)
          changes.push("รหัส: " + oldVals[C.ID] + " ➔ " + newId);
        if (oldVals[C.NAME] !== assetName)
          changes.push("ชื่อ: " + oldVals[C.NAME] + " ➔ " + assetName);
        if (oldVals[C.CAT] !== catVal)
          changes.push(
            "หมวดหมู่: " + (oldVals[C.CAT] || "-") + " ➔ " + (catVal || "-"),
          );
        if (oldVals[C.LOC] !== locVal)
          changes.push(
            "สถานที่: " + (oldVals[C.LOC] || "-") + " ➔ " + (locVal || "-"),
          );
        if (Number(oldVals[C.BTT]) !== btt)
          changes.push("BTT: " + oldVals[C.BTT] + " ➔ " + btt);
        if (Number(oldVals[C.TKE]) !== tke)
          changes.push("TKE: " + oldVals[C.TKE] + " ➔ " + tke);
        if (Number(oldVals[C.PRICE]) !== price)
          changes.push("ราคา: " + oldVals[C.PRICE] + " ➔ " + price);
        if (oldVals[C.STATUS] !== status)
          changes.push("สถานะ: " + oldVals[C.STATUS] + " ➔ " + status);
        logDetail =
          "รหัส: " +
          newId +
          " (" +
          assetName +
          ") | การเปลี่ยนแปลง: [" +
          (changes.length ? changes.join(" | ") : "อัปเดตข้อมูลทั่วไป") +
          "]";
      } else {
        logDetail =
          "รหัส: " +
          newId +
          " (" +
          assetName +
          ") | หมวดหมู่: " +
          (catVal || "-") +
          " | สถานที่: " +
          (locVal || "-") +
          " | BTT: " +
          btt +
          ", TKE: " +
          tke;
      }
      logActivity_(actionType, logDetail, f.operator);

      // ย้ายรูปภาพใน GitHub หากมีการเปลี่ยนรหัสอุปกรณ์
      var picNote = "";
      if (isEdit && String(oldVals[C.ID]).trim() !== newId) {
        try {
          var mv = renamePicsForCode_(oldVals[C.ID], newId);
          if (mv) {
            picNote = " (ย้ายรูป " + mv + " ไฟล์ตามรหัสใหม่แล้ว)";
            logActivity_(
              "ย้ายรูปภาพ",
              oldVals[C.ID] + " → " + newId + " " + mv + " ไฟล์",
              f.operator,
            );
          }
        } catch (pe) {
          picNote = " (แต่ย้ายรูปไม่สำเร็จ: " + pe.message + ")";
        }
      }

      return {
        success: true,
        code: newId,
        message: isEdit
          ? "แก้ไขข้อมูลอุปกรณ์เรียบร้อยแล้ว" + picNote
          : "เพิ่มอุปกรณ์ใหม่เรียบร้อยแล้ว (รหัส: " + newId + ")",
      };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 3. อัปโหลดรูปภาพเข้า GitHub ----------
// รันใน Editor: setGitHubToken('ghp_...')  (แต่ดีที่สุดคือตั้งที่ Script Properties โดยตรง)
function setGitHubToken(token) {
  ownerOnly_();
  PropertiesService.getScriptProperties().setProperty(
    "GITHUB_TOKEN",
    String(token).trim(),
  );
  return "บันทึก GITHUB_TOKEN สำเร็จ";
}

function uploadImageToGitHub(dataUrl, code, operator, tk, mode) {
  try {
    var sess = need_(tk, "ADMIN");
    operator = sess.name || operator;

    code = String(code || "").trim();
    if (!code || /[\/\\]/.test(code))
      return { success: false, message: "รหัสอุปกรณ์ไม่ถูกต้อง" };
    if (!dataUrl || String(dataUrl).length > 4 * 1024 * 1024)
      return { success: false, message: "ไฟล์รูปใหญ่เกินไป" };

    var token =
      PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
    if (!token)
      return {
        success: false,
        message: "ยังไม่ได้ตั้ง GITHUB_TOKEN ใน Script Properties",
      };

    var base64Data = String(dataUrl).replace(
      /^data:image\/(png|jpeg|jpg|webp);base64,/,
      "",
    );
    var gh = CONFIG.GITHUB;
    var headers = {
      Authorization: "token " + token,
      Accept: "application/vnd.github.v3+json",
    };
    var isAdd = mode === "add";
    var files = [];
    if (isAdd) {
      CacheService.getScriptCache().remove("PIC_INDEX");
      files = picIndex_();
    }

    function urlOf(path) {
      return (
        "https://api.github.com/repos/" +
        gh.OWNER +
        "/" +
        gh.REPO +
        "/contents/" +
        encodeURI(path)
      );
    }
    // หาชื่อไฟล์ที่ว่างจริงบน GitHub (กันรายชื่อแคชเก่า) และเอา sha ถ้าเป็นโหมดทับรูปเดิม
    function resolveTarget() {
      for (var attempt = 0; attempt < 8; attempt++) {
        var path = isAdd
          ? nextPicPath_(code, files, attempt)
          : code + "/" + code + ".jpg";
        var chk = UrlFetchApp.fetch(urlOf(path) + "?ref=" + gh.BRANCH, {
          method: "get",
          headers: headers,
          muteHttpExceptions: true,
        });
        var cc = chk.getResponseCode();
        if (cc === 404) return { path: path, sha: "" };
        if (cc === 200) {
          if (!isAdd)
            return { path: path, sha: JSON.parse(chk.getContentText()).sha };
          continue; // ชื่อนี้มีแล้ว ลองเลขถัดไป
        }
        throw new Error("ตรวจไฟล์บน GitHub ไม่สำเร็จ (" + cc + ")");
      }
      throw new Error("หาชื่อไฟล์รูปที่ว่างไม่ได้ กรุณาลองใหม่");
    }

    var target, response, resCode;
    for (var tryNo = 0; tryNo < 3; tryNo++) {
      target = resolveTarget();
      var payload = {
        message: "Upload image for " + code + " by " + (operator || "system"),
        content: base64Data,
        branch: gh.BRANCH,
      };
      if (target.sha) payload.sha = target.sha;
      response = UrlFetchApp.fetch(urlOf(target.path), {
        method: "put",
        headers: {
          Authorization: headers.Authorization,
          Accept: headers.Accept,
          "Content-Type": "application/json",
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
      resCode = response.getResponseCode();
      if (resCode === 200 || resCode === 201) break;
      if (resCode === 409 || resCode === 422) {
        Utilities.sleep(700 * (tryNo + 1)); // branch ขยับ/ไฟล์ชน: รอแล้วลองใหม่
        continue;
      }
      break;
    }

    if (resCode === 200 || resCode === 201) {
      var rawUrl =
        "https://raw.githubusercontent.com/" +
        gh.OWNER +
        "/" +
        gh.REPO +
        "/" +
        gh.BRANCH +
        "/" +
        encodeURI(target.path);
      CacheService.getScriptCache().remove("PIC_INDEX");
      logActivity_(
        "อัปโหลดรูปภาพ",
        "รหัส: " + code + " → " + target.path + (isAdd ? " (เพิ่มรูป)" : ""),
        operator,
      );
      return {
        success: true,
        url: rawUrl,
        path: target.path,
        message: "อัปโหลดรูปภาพสำเร็จ",
      };
    }
    var msg = response.getContentText();
    try {
      msg = JSON.parse(msg).message || msg;
    } catch (e) {}
    return {
      success: false,
      message: "GitHub Error (" + resCode + "): " + msg,
    };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 4. ลบอุปกรณ์ (IT เท่านั้น) ----------
function deleteAssetData(assetId, operator, tk, deletePics) {
  try {
    var sess = need_(tk, "IT");
    operator = sess.name || operator;
    return withLock_(function () {
      var sheet = assetSheet_(),
        row = findAssetRow_(sheet, assetId);
      if (row < 0)
        return { success: false, message: "ไม่พบข้อมูลอุปกรณ์ที่ต้องการลบ" };
      var b = borrowSheet_();
      if (b.getLastRow() > 1) {
        var v = b.getRange(2, 1, b.getLastRow() - 1, 9).getValues();
        for (var i = 0; i < v.length; i++) {
          if (
            String(v[i][1]).trim() === String(assetId).trim() &&
            v[i][8] === "กำลังยืม"
          ) {
            return {
              success: false,
              message:
                "ลบไม่ได้ ยังมีรายการ " +
                assetId +
                " ที่กำลังยืมอยู่ (แถว " +
                (i + 2) +
                ") กรุณาคืนก่อน",
            };
          }
        }
      }

      sheet.deleteRow(row);
      logActivity_("ลบอุปกรณ์", "รหัส: " + assetId, operator);
      var picMsg = "";
      if (deletePics === true) {
        try {
          var pf = picFilesOf_(assetId),
            pm = {};
          pf.forEach(function (f) {
            pm[f.dir + "/" + f.name] = null;
          });
          if (pf.length) {
            picCommit_(pm, "Delete pics of " + assetId);
            logActivity_(
              "ลบรูปภาพ",
              "รหัส: " + assetId + " ทั้งหมด " + pf.length + " ไฟล์",
              operator,
            );
          }
          picMsg = " (ลบรูป " + pf.length + " ไฟล์)";
        } catch (pe) {
          picMsg = " (แต่ลบรูปไม่สำเร็จ: " + pe.message + ")";
        }
      }
      return {
        success: true,
        message: "ลบอุปกรณ์รหัส " + assetId + " เรียบร้อยแล้ว" + picMsg,
      };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 5. Log System (private: เรียกจากหน้าเว็บไม่ได้) ----------
function who_(user) {
  var w = sanitizeInput_(user).substring(0, 60);
  if (!w) {
    try {
      w = Session.getActiveUser().getEmail();
    } catch (e) {}
  }
  return w || "ไม่ระบุ";
}

function logActivity_(action, details, user) {
  try {
    var ss = getSS_();
    var logSheet = ss.getSheetByName(CONFIG.SHEETS.LOGS || "SystemLogs");
    if (!logSheet) {
      logSheet = ss.insertSheet(CONFIG.SHEETS.LOGS || "SystemLogs");
      logSheet.appendRow([
        "#",
        "วัน-เวลา",
        "ผู้ใช้งาน",
        "กิจกรรม",
        "รายละเอียด",
      ]);
    }
    var thaiTime = Utilities.formatDate(
      new Date(),
      "Asia/Bangkok",
      "yyyy-MM-dd HH:mm:ss",
    );
    logSheet.appendRow([
      logSheet.getLastRow(),
      thaiTime,
      who_(user),
      sanitizeInput_(action),
      sanitizeInput_(details),
    ]);
  } catch (e) {
    console.error(e);
  }
}

// ---------- 6. ระบบเบิก (ผู้ใช้ทั่วไปเบิกได้ ตามที่ออกแบบไว้) ----------
function saveBatchBorrowData(p) {
  try {
    return withLock_(function () {
      var C = CONFIG.COL,
        aSheet = assetSheet_(),
        bSheet = borrowSheet_(),
        items = (p && p.items) || [];
      var borrower = sanitizeInput_(p && p.borrowerName).substring(0, 80);
      if (!borrower) return { success: false, message: "กรุณาระบุชื่อผู้เบิก" };
      if (!items.length)
        return { success: false, message: "ไม่มีรายการที่เบิก" };
      if (items.length > MAX_BORROW_ITEMS_)
        return {
          success: false,
          message: "เบิกได้ครั้งละไม่เกิน " + MAX_BORROW_ITEMS_ + " รายการ",
        };

      for (var q = 0; q < items.length; q++) {
        var qn = Number(items[q].quantity);
        if (!(qn >= 1) || Math.floor(qn) !== qn) {
          return {
            success: false,
            message: "จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป",
          };
        }
      }
      // รวมจำนวนรหัสซ้ำก่อนเช็คสต็อก
      var sumByCode = {};
      items.forEach(function (it) {
        var k = String(it.itemCode).trim();
        sumByCode[k] = (sumByCode[k] || 0) + Number(it.quantity);
      });
      for (var i = 0; i < items.length; i++) {
        var r = findAssetRow_(aSheet, items[i].itemCode);
        if (r < 0)
          return { success: false, message: "ไม่พบรหัส " + items[i].itemCode };
        var st = String(aSheet.getRange(r, C.STATUS + 1).getValue()).trim();
        if (st !== "พร้อมใช้งาน")
          return {
            success: false,
            message: items[i].itemCode + " ไม่พร้อมเบิก (" + st + ")",
          };
        var v = aSheet.getRange(r, C.BTT + 1, 1, 2).getValues()[0];
        if (
          sumByCode[String(items[i].itemCode).trim()] >
          (Number(v[0]) || 0) + (Number(v[1]) || 0)
        ) {
          return {
            success: false,
            message: "สต็อก " + items[i].itemCode + " ไม่เพียงพอ",
          };
        }
      }

      var today = Utilities.formatDate(
        new Date(),
        "Asia/Bangkok",
        "dd/MM/yyyy HH:mm:ss",
      );
      var itemDetails = [];
      items.forEach(function (it) {
        var s = adjustStock_(it.itemCode, -Number(it.quantity));
        bSheet.appendRow([
          bSheet.getLastRow(),
          sanitizeInput_(it.itemCode),
          sanitizeInput_(p.projectName || "-"),
          Number(it.quantity),
          today,
          "-",
          borrower,
          sanitizeInput_(p.locationAddress || "-"),
          "กำลังยืม",
          s.fromBtt,
          s.fromTke,
          "-",
        ]);
        itemDetails.push(it.itemCode + " x" + it.quantity);
      });

      addLookup_(CONFIG.SHEETS.BORROWERS, borrower);

      logActivity_(
        "เบิกอุปกรณ์",
        "ผู้เบิก: " +
          borrower +
          " | โครงการ: " +
          (p.projectName || "-") +
          " | รายการ: [" +
          itemDetails.join(", ") +
          "]",
        p.operator || borrower,
      );
      return { success: true, message: "บันทึกการเบิกอุปกรณ์สำเร็จ" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function adjustStock_(code, delta, split) {
  var C = CONFIG.COL,
    sheet = assetSheet_(),
    row = findAssetRow_(sheet, code);
  var out = { fromBtt: 0, fromTke: 0 };
  if (row < 0) return out;
  var rng = sheet.getRange(row, C.BTT + 1, 1, 2),
    v = rng.getValues()[0];
  var btt = Number(v[0]) || 0,
    tke = Number(v[1]) || 0;

  if (delta < 0) {
    var need = -delta;
    out.fromBtt = Math.min(btt, need);
    out.fromTke = Math.min(tke, need - out.fromBtt);
    btt -= out.fromBtt;
    tke -= out.fromTke;
  } else if (split && split.btt + split.tke > 0) {
    btt += split.btt;
    tke += split.tke;
    var rest = delta - split.btt - split.tke;
    if (rest > 0) btt += rest;
  } else {
    btt += delta;
  }

  rng.setValues([[btt, tke]]);
  setTotal_(sheet, row, btt + tke);

  var st = sheet.getRange(row, C.STATUS + 1),
    cur = st.getValue();
  if (btt + tke === 0 && cur === "พร้อมใช้งาน") st.setValue("ถูกยืม");
  else if (btt + tke > 0 && cur === "ถูกยืม") st.setValue("พร้อมใช้งาน");
  return out;
}

// ---------- 7. ระบบคืน ----------
function normName_(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function returnAsset(itemCode, sheetRow, operator, returnedBy, tk) {
  try {
    var sess = session_(tk);
    var staff = ROLE_[sess.role] >= ROLE_.ADMIN;
    if (!staff && !USER_CAN_RETURN) {
      throw new Error(
        "ไม่มีสิทธิ์คืนอุปกรณ์ กรุณาให้แอดมินเป็นผู้ทำรายการ (หรือเข้าสู่ระบบแอดมิน)",
      );
    }
    if (staff && sess.name) operator = sess.name;

    return withLock_(function () {
      var b = borrowSheet_(),
        r = Number(sheetRow);
      if (!(r >= 2 && r <= b.getLastRow())) {
        return {
          success: false,
          message: "ไม่พบรายการ กรุณารีเฟรชแล้วลองใหม่",
        };
      }
      if (
        String(b.getRange(r, 2).getValue()).trim() !== String(itemCode).trim()
      ) {
        return {
          success: false,
          message: "ข้อมูลไม่ตรงกัน กรุณารีเฟรชแล้วลองใหม่",
        };
      }
      if (b.getRange(r, 9).getValue() === "คืนแล้ว") {
        return { success: false, message: "รายการนี้ถูกคืนไปแล้ว" };
      }

      var borrower = String(b.getRange(r, 7).getValue());
      var who = normName_(returnedBy);
      if (!who) return { success: false, message: "กรุณาเลือกชื่อผู้คืน" };

      if (!staff) {
        var opName = normName_(operator);
        if (!opName)
          return { success: false, message: "กรุณาเลือกชื่อผู้ใช้งานก่อนคืน" };
        if (opName !== normName_(borrower) || who !== normName_(borrower)) {
          return {
            success: false,
            message: "รายการนี้เป็นของ " + borrower + " คุณไม่สามารถคืนแทนได้",
          };
        }
      }

      var qty = Number(b.getRange(r, 4).getValue()) || 1;
      var split = {
        btt: Number(b.getRange(r, 10).getValue()) || 0,
        tke: Number(b.getRange(r, 11).getValue()) || 0,
      };

      b.getRange(r, 6).setValue(
        Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss"),
      );
      b.getRange(r, 9).setValue("คืนแล้ว");
      b.getRange(r, 12).setValue(sanitizeInput_(returnedBy));

      adjustStock_(itemCode, qty, split);
      logActivity_(
        "คืนอุปกรณ์",
        "รหัส: " +
          itemCode +
          " จำนวน: " +
          qty +
          " ผู้เบิก: " +
          borrower +
          " ผู้คืน: " +
          returnedBy,
        operator || returnedBy,
      );
      return { success: true, message: "คืนอุปกรณ์เข้าสต็อกเรียบร้อยแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 8. จัดการรายชื่อผู้เบิก ----------
function borrowerSheet_() {
  return ensureSheet_(CONFIG.SHEETS.BORROWERS, "รายชื่อผู้เบิก");
}

function migrateBorrowersOnce_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty("BORROWERS_SYNCED")) return;
    withLock_(function () {
      var sh = borrowerSheet_(),
        names = listFrom_(CONFIG.SHEETS.BORROWERS),
        b = borrowSheet_();
      if (b.getLastRow() > 1) {
        b.getRange(2, 7, b.getLastRow() - 1, 1)
          .getValues()
          .forEach(function (r) {
            var n = sanitizeInput_(r[0]);
            if (n && n !== "-" && names.indexOf(n) < 0) {
              sh.appendRow([n]);
              names.push(n);
            }
          });
      }
      props.setProperty("BORROWERS_SYNCED", "1");
    });
  } catch (e) {}
}

function activeBorrowCount_(name) {
  var b = borrowSheet_(),
    n = 0;
  if (b.getLastRow() < 2) return 0;
  b.getRange(2, 1, b.getLastRow() - 1, 9)
    .getValues()
    .forEach(function (v) {
      if (v[8] === "กำลังยืม" && normName_(v[6]) === normName_(name)) n++;
    });
  return n;
}

function addBorrowerName(name, operator, tk) {
  try {
    var sess = need_(tk, "ADMIN");
    operator = sess.name || operator;
    return withLock_(function () {
      name = sanitizeInput_(name);
      if (!name) return { success: false, message: "กรุณากรอกชื่อ" };
      var dup = listFrom_(CONFIG.SHEETS.BORROWERS).some(function (n) {
        return normName_(n) === normName_(name);
      });
      if (dup)
        return { success: false, message: "มีชื่อ " + name + " อยู่แล้ว" };
      borrowerSheet_().appendRow([name]);
      logActivity_("เพิ่มรายชื่อ", name, operator);
      return { success: true, message: "เพิ่มชื่อ " + name + " แล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function renameBorrowerName(oldName, newName, operator, tk) {
  try {
    var sess = need_(tk, "ADMIN");
    operator = sess.name || operator;
    return withLock_(function () {
      oldName = sanitizeInput_(oldName);
      newName = sanitizeInput_(newName);
      if (!oldName || !newName)
        return { success: false, message: "กรุณากรอกชื่อ" };
      if (oldName === newName)
        return { success: true, message: "ไม่มีการเปลี่ยนแปลง" };

      var sh = borrowerSheet_(),
        last = sh.getLastRow(),
        rng = last > 1 ? sh.getRange(2, 1, last - 1, 1) : null,
        vals = rng ? rng.getValues() : [];
      var dup = vals.some(function (r) {
        var n = sanitizeInput_(r[0]);
        return n !== oldName && normName_(n) === normName_(newName);
      });
      if (dup)
        return { success: false, message: "มีชื่อ " + newName + " อยู่แล้ว" };

      var found = false;
      vals.forEach(function (r) {
        if (sanitizeInput_(r[0]) === oldName) {
          r[0] = newName;
          found = true;
        }
      });
      if (found) rng.setValues(vals);
      else sh.appendRow([newName]);

      logActivity_("แก้ไขรายชื่อ", oldName + " ➔ " + newName, operator);
      return {
        success: true,
        message: "แก้ไขชื่อเป็น " + newName + " เรียบร้อยแล้ว",
      };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function deleteBorrowerName(name, operator, tk) {
  try {
    var sess = need_(tk, "IT");
    operator = sess.name || operator;
    return withLock_(function () {
      name = sanitizeInput_(name);
      if (!name) return { success: false, message: "ไม่พบชื่อที่ต้องการลบ" };
      var cnt = activeBorrowCount_(name);
      if (cnt > 0) {
        return {
          success: false,
          message:
            "ลบไม่ได้ " +
            name +
            " ยังมีรายการที่กำลังยืมอยู่ " +
            cnt +
            " รายการ กรุณาคืนก่อน",
        };
      }
      var sh = borrowerSheet_(),
        last = sh.getLastRow(),
        removed = 0;
      if (last > 1) {
        var vals = sh.getRange(2, 1, last - 1, 1).getValues();
        for (var i = vals.length - 1; i >= 0; i--) {
          if (normName_(vals[i][0]) === normName_(name)) {
            sh.deleteRow(i + 2);
            removed++;
          }
        }
      }
      if (!removed)
        return {
          success: false,
          message: "ไม่พบชื่อ " + name + " ในฐานข้อมูล",
        };
      logActivity_("ลบรายชื่อ", name, operator);
      return {
        success: true,
        message: "ลบชื่อ " + name + " ออกจากฐานข้อมูลแล้ว",
      };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 9. ตรวจสอบข้อมูล (Audit) (ADMIN ขึ้นไป) ----------
function addAuditRow(p, operator) {
  try {
    var sess = need_(p && p.token, "ADMIN");
    operator = sess.name || operator;
    return withLock_(function () {
      var v = auditVals_(p);
      if (!v[0] && !v[2] && !v[3]) {
        return {
          success: false,
          message: "กรุณากรอกอย่างน้อย ประเด็น / รหัส / ชื่อรายการ",
        };
      }
      var sh = auditSheet_(),
        row = sh.getLastRow() + 1,
        rng = sh.getRange(row, 1, 1, 5);
      rng.setNumberFormat("@");
      rng.setValues([v]);
      logActivity_(
        "เพิ่มรายการตรวจสอบ",
        "รหัส: " + (v[2] || "-") + " | " + (v[3] || "-"),
        operator,
      );
      return { success: true, message: "เพิ่มรายการตรวจสอบแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function checkAuditRow_(sh, p) {
  var r = Number(p.row);
  if (!(r >= 2 && r <= sh.getLastRow())) return null;
  var cur = sh.getRange(r, 1, 1, 5).getDisplayValues()[0];
  if (
    String(cur[2]).trim() !== String(p.expectCode || "").trim() ||
    String(cur[3]).trim() !== String(p.expectName || "").trim()
  )
    return null;
  return { row: r, cur: cur };
}

function updateAuditRow(p, operator) {
  try {
    var sess = need_(p && p.token, "ADMIN");
    operator = sess.name || operator;
    return withLock_(function () {
      var sh = auditSheet_(),
        hit = checkAuditRow_(sh, p);
      if (!hit) {
        return {
          success: false,
          message: "ไม่พบรายการหรือข้อมูลถูกแก้ไขไปก่อน กรุณารีเฟรชแล้วลองใหม่",
        };
      }
      var v = auditVals_(p);
      if (!v[0] && !v[2] && !v[3]) {
        return {
          success: false,
          message: "กรุณากรอกอย่างน้อย ประเด็น / รหัส / ชื่อรายการ",
        };
      }
      var ch = [];
      for (var i = 0; i < 5; i++) {
        if (String(hit.cur[i]).trim() !== v[i]) {
          ch.push(
            AUDIT_LABELS_[i] +
              ": " +
              (hit.cur[i] || "-") +
              " ➔ " +
              (v[i] || "-"),
          );
        }
      }
      if (!ch.length) return { success: true, message: "ไม่มีการเปลี่ยนแปลง" };
      var rng = sh.getRange(hit.row, 1, 1, 5);
      rng.setNumberFormat("@");
      rng.setValues([v]);
      logActivity_(
        "แก้ไขรายการตรวจสอบ",
        "แถว " + hit.row + " (" + (v[2] || "-") + "): " + ch.join(" | "),
        operator,
      );
      return { success: true, message: "บันทึกรายการตรวจสอบแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ตัวลบจริง (ไม่ล็อก ไม่เช็คสิทธิ์) ใช้ภายในเท่านั้น  [เดิมไม่ได้ประกาศไว้ -> เติมให้แล้ว]
function deleteAuditRowCore_(row, expectCode, expectName, operator) {
  var sh = auditSheet_();
  var hit = checkAuditRow_(sh, {
    row: row,
    expectCode: expectCode,
    expectName: expectName,
  });
  if (!hit) {
    return {
      success: false,
      message: "ไม่พบรายการหรือข้อมูลถูกแก้ไขไปก่อน กรุณารีเฟรชแล้วลองใหม่",
    };
  }
  sh.deleteRow(hit.row);
  logActivity_(
    "ลบรายการตรวจสอบ",
    "แถว " +
      hit.row +
      " | รหัส: " +
      (hit.cur[2] || "-") +
      " | " +
      (hit.cur[3] || "-"),
    operator,
  );
  return { success: true, message: "ลบรายการตรวจสอบแล้ว" };
}

function deleteAuditRow(row, expectCode, expectName, operator, tk) {
  try {
    var sess = need_(tk, "ADMIN");
    operator = sess.name || operator;
    return withLock_(function () {
      return deleteAuditRowCore_(row, expectCode, expectName, operator);
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ==================== Setup & Admin (รันจาก Editor เท่านั้น: มี ownerOnly_) ====================
function setupAll() {
  ownerOnly_();
  borrowSheet_();
  ensureSheet_(CONFIG.SHEETS.CATEGORIES, "หมวดหมู่");
  ensureSheet_(CONFIG.SHEETS.LOCATIONS, "สถานที่");
  ensureSheet_(CONFIG.SHEETS.BORROWERS, "รายชื่อผู้เบิก");
  archiveLegacySheets();
}

function setupQrFormulas() {
  ownerOnly_();
  var sh = assetSheet_(),
    last = sh.getLastRow(),
    url = appUrl_();
  if (!url)
    throw new Error(
      "ยังไม่ได้ตั้ง CONFIG.APP_URL ใน Config.gs หรือ Script Properties",
    );
  if (last < 2) return;
  var f =
    '=IF( $D2="","",IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=150x150&data="&ENCODEURL("' +
    url +
    '?code="&$D2)))';
  sh.getRange(2, CONFIG.COL.QR + 1, last - 1, 1).setFormula(f);
  logActivity_("ตั้งค่า QR", "อัปเดตสูตร QR เป็นลิงก์ " + url);
}

function archiveLegacySheets() {
  ownerOnly_();
  var ss = getSS_();
  if (CONFIG.LEGACY && Array.isArray(CONFIG.LEGACY)) {
    CONFIG.LEGACY.forEach(function (n) {
      var sh = ss.getSheetByName(n);
      if (sh && sh.getLastRow() <= 2 && !sh.isSheetHidden()) sh.hideSheet();
    });
  }
}

function saveAppUrl(url, tk) {
  try {
    var sess = need_(tk, "IT");
    url = String(url || "").trim();
    if (
      !/^https:\/\/script\.google\.com\/(a\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(
        url,
      )
    ) {
      return {
        success: false,
        message: "ลิงก์ไม่ถูกต้อง ต้องเป็นลิงก์ Web app ที่ลงท้ายด้วย /exec",
      };
    }
    PropertiesService.getScriptProperties().setProperty("APP_URL", url);
    logActivity_("ตั้งค่าลิงก์ระบบ", url, sess.name);
    return { success: true, message: "บันทึกลิงก์ระบบสำเร็จ" };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ==================== จัดการรูปอุปกรณ์ (หลายรูปต่อรหัส) ====================
// ต้องมี Pics.gs (ghApi_) และ GITHUB_TOKEN ใน Script Properties
var PIC_RE_ = /^(.*?)(?:\s*\((\d+)\))?\.(jpe?g|png|webp)$/i;

function picKey_(s) {
  return String(s).replace(/\s+/g, "").toLowerCase();
}

// ไฟล์ในโฟลเดอร์ของรหัสนี้แบบสด (มี sha) เรียงรูปหลักก่อน แล้ว (2), (3)...
function picFilesOf_(code) {
  var dir = String(code).trim(),
    list;
  try {
    list = ghApi_(
      "get",
      "/contents/" + encodeURIComponent(dir) + "?ref=" + CONFIG.GITHUB.BRANCH,
    );
  } catch (e) {
    if (String(e.message).indexOf("GitHub 404") >= 0) return []; // ยังไม่มีโฟลเดอร์
    throw e;
  }
  if (!Array.isArray(list)) return [];
  var out = [];
  list.forEach(function (f) {
    if (f.type !== "file") return;
    var m = PIC_RE_.exec(f.name);
    if (!m) return;
    out.push({
      dir: dir,
      name: f.name,
      sha: f.sha,
      n: m[2] ? Number(m[2]) : 1,
      base: m[1],
      ext: m[3],
    });
  });
  out.sort(function (a, b) {
    return a.n - b.n;
  });
  return out;
}

// map = { "โฟลเดอร์/ไฟล์": sha | null(ลบ) } -> commit เดียว ย้อนกลับได้จาก history
function picCommit_(map, message) {
  var gh = CONFIG.GITHUB,
    tree = [];
  Object.keys(map).forEach(function (p) {
    tree.push({ path: p, mode: "100644", type: "blob", sha: map[p] });
  });
  if (!tree.length) return;
  var commitSha = ghApi_("get", "/git/ref/heads/" + gh.BRANCH).object.sha;
  var commit = ghApi_("get", "/git/commits/" + commitSha);
  var nt = ghApi_("post", "/git/trees", {
    base_tree: commit.tree.sha,
    tree: tree,
  });
  var nc = ghApi_("post", "/git/commits", {
    message: message,
    tree: nt.sha,
    parents: [commitSha],
  });
  ghApi_("patch", "/git/refs/heads/" + gh.BRANCH, { sha: nc.sha });
  CacheService.getScriptCache().remove("PIC_INDEX");
}

function picName_(dir, base, n, ext) {
  return dir + "/" + base + (n > 1 ? " (" + n + ")" : "") + "." + ext;
}

// ดูรูปทั้งหมดของรหัส (ADMIN ขึ้นไป)
function listAssetPics(code, tk) {
  try {
    need_(tk, "ADMIN");
    var base = ghRawBase_();
    var pics = picFilesOf_(code).map(function (f, i) {
      return {
        name: f.name,
        url:
          base + encodeURIComponent(f.dir) + "/" + encodeURIComponent(f.name),
        main: i === 0,
      };
    });
    return { success: true, pics: pics };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ลบรูปหนึ่งรูป ถ้าลบรูปหลัก รูปถัดไปจะเลื่อนขึ้นเป็นรูปหลักอัตโนมัติ
function deleteAssetPic(code, fileName, tk) {
  try {
    var sess = need_(tk, "ADMIN");
    return withLock_(function () {
      var files = picFilesOf_(code),
        idx = -1;
      files.forEach(function (f, i) {
        if (f.name === fileName) idx = i;
      });
      if (idx < 0)
        return {
          success: false,
          message: "ไม่พบรูปนี้ของรหัส " + code + " (อาจถูกลบไปแล้ว)",
        };
      var t = files[idx],
        map = {};
      map[t.dir + "/" + t.name] = null;
      if (idx === 0 && files.length > 1) {
        var nx = files[1],
          mainPath = picName_(nx.dir, nx.base, 1, nx.ext);
        map[mainPath] = nx.sha;
        if (nx.dir + "/" + nx.name !== mainPath)
          map[nx.dir + "/" + nx.name] = null;
      }
      picCommit_(map, "Delete pic " + t.dir + "/" + t.name);
      logActivity_("ลบรูปภาพ", "รหัส: " + code + " ไฟล์: " + t.name, sess.name);
      return { success: true, message: "ลบรูปเรียบร้อยแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ตั้งรูปที่เลือกเป็นรูปหลัก (สลับกับรูปหลักเดิม)
function setMainAssetPic(code, fileName, tk) {
  try {
    var sess = need_(tk, "ADMIN");
    return withLock_(function () {
      var files = picFilesOf_(code),
        idx = -1;
      files.forEach(function (f, i) {
        if (f.name === fileName) idx = i;
      });
      if (idx < 0)
        return {
          success: false,
          message: "ไม่พบรูปนี้ กรุณารีเฟรชแล้วลองใหม่",
        };
      if (idx === 0)
        return { success: false, message: "รูปนี้เป็นรูปหลักอยู่แล้ว" };
      var main = files[0],
        t = files[idx],
        map = {};
      map[t.dir + "/" + t.name] = null;
      if (main.n === 1) {
        map[main.dir + "/" + main.name] = null;
        map[picName_(main.dir, main.base, 1, t.ext)] = t.sha;
        map[picName_(t.dir, t.base, t.n, main.ext)] = main.sha;
      } else {
        map[picName_(t.dir, t.base, 1, t.ext)] = t.sha;
      }
      picCommit_(map, "Set main pic " + t.dir + "/" + t.name);
      logActivity_(
        "ตั้งรูปหลัก",
        "รหัส: " + code + " ไฟล์: " + t.name,
        sess.name,
      );
      return { success: true, message: "ตั้งเป็นรูปหลักแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ย้ายรูปทั้งโฟลเดอร์เมื่อเปลี่ยนรหัส (เรียกจาก saveAssetData) คืนจำนวนไฟล์ที่ย้าย
function renamePicsForCode_(oldCode, newCode) {
  var files = picFilesOf_(oldCode);
  if (!files.length) return 0;
  var sameKey = picKey_(oldCode) === picKey_(newCode);
  if (!sameKey && picFilesOf_(newCode).length)
    throw new Error("รหัสใหม่มีรูปอยู่แล้ว ไม่ย้ายรูปเพื่อกันทับ");
  var nc = String(newCode).trim(),
    map = {},
    moved = 0;
  files.forEach(function (f) {
    var from = f.dir + "/" + f.name,
      to = picName_(nc, nc, f.n, f.ext);
    if (from === to) return;
    map[from] = null;
    moved++;
  });
  files.forEach(function (f) {
    var from = f.dir + "/" + f.name,
      to = picName_(nc, nc, f.n, f.ext);
    if (from !== to) map[to] = f.sha;
  });
  picCommit_(map, "Rename pics " + oldCode + " -> " + newCode);
  return moved;
}

// ==================== เครื่องมือเจ้าของระบบ (รันใน Editor เท่านั้น) ====================
// วิธีตั้งรหัสผ่านใหม่: แก้ 2 บรรทัดข้างล่าง (อย่างน้อย 8 ตัว) กด Run แล้ว "ลบรหัสออกจากโค้ดทันที"
function setPasswordsFromEditor() {
  ownerOnly_();
  var ADMIN_NEW = "";
  var IT_NEW = "";
  if (ADMIN_NEW.length < 8 || IT_NEW.length < 8)
    throw new Error(
      "ใส่รหัสใหม่ในโค้ดก่อน (อย่างน้อย 8 ตัวอักษรทั้งสองรหัส) แล้วค่อยรัน",
    );
  if (ADMIN_NEW === IT_NEW) throw new Error("รหัส Admin และ IT ต้องไม่ซ้ำกัน");
  var props = PropertiesService.getScriptProperties();
  props.setProperty("ADMIN_PASSWORD", ADMIN_NEW);
  props.setProperty("IT_PASSWORD", IT_NEW);
  ADMIN_NAMES_.concat(IT_NAMES_).forEach(function (n) {
    CacheService.getScriptCache().remove("FAIL_" + normName_(n));
  });
  Logger.log("ตั้งรหัสใหม่แล้ว อย่าลืมลบรหัสออกจากโค้ด");
}

function debugLogin() {
  ownerOnly_();
  var props = PropertiesService.getScriptProperties();
  ["ADMIN_PASSWORD", "IT_PASSWORD", "GITHUB_TOKEN"].forEach(function (k) {
    var v = props.getProperty(k);
    Logger.log(
      k +
        ": " +
        (v === null
          ? "ยังไม่ได้ตั้ง"
          : "ตั้งแล้ว ยาว " +
            v.length +
            " | ช่องว่างหัวท้าย: " +
            (v !== v.trim()) +
            " | อักขระนอก ASCII: " +
            /[^\x20-\x7E]/.test(v)),
    );
  });
}
