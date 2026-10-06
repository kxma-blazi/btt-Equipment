// BTT Field Tool Manager - Backend (final)
function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("ระบบจัดการเครื่องมือ - BTT")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// ---------- helpers ----------
function getSS_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}
function assetSheet_() {
  return getSS_().getSheetByName(CONFIG.SHEETS.ASSETS);
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
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
  for (var i = 0; i < ids.length; i++)
    if (String(ids[i][0]).trim() === String(code).trim()) return i + 2;
  return -1;
}
function lastDataRow_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return 1;
  var ids = sheet.getRange(2, CONFIG.COL.ID + 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--)
    if (String(ids[i][0]).trim() !== "") return i + 2;
  return 1;
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
  val = String(val || "").trim();
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
  ];
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEETS.BORROW);
    sh.appendRow(head);
  } else {
    for (var i = 8; i < head.length; i++)
      if (String(sh.getRange(1, i + 1).getValue()).trim() === "")
        sh.getRange(1, i + 1).setValue(head[i]);
  }
  return sh;
}

// บันทึกลิงก์ Web app (/exec) จากหน้าเว็บ เก็บใน Script Properties
function saveAppUrl(url) {
  try {
    url = String(url || "").trim();
    if (
      !/^https:\/\/script\.google\.com\/(a\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(
        url,
      )
    )
      return {
        success: false,
        message: "ลิงก์ไม่ถูกต้อง ต้องเป็นลิงก์ Web app ที่ลงท้ายด้วย /exec",
      };
    PropertiesService.getScriptProperties().setProperty("APP_URL", url);
    logActivity("ตั้งค่าลิงก์ระบบ", url);
    return { success: true, message: "บันทึกลิงก์ระบบแล้ว" };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function appUrl_() {
  var u = CONFIG.APP_URL || "";
  if (!u)
    u = PropertiesService.getScriptProperties().getProperty("APP_URL") || "";
  if (!u) {
    try {
      u = ScriptApp.getService().getUrl() || "";
    } catch (e) {}
  }
  return String(u).trim();
}

// ---------- รันครั้งเดียวจาก Editor ----------
// สร้างสูตร QR ในชีต Asset คอลัมน์ A ให้เป็นลิงก์ ?code=รหัส (สแกนด้วยกล้องมือถือแล้วเปิดระบบ)
function setupQrFormulas() {
  var sh = assetSheet_(),
    last = sh.getLastRow(),
    url = appUrl_();
  if (!url) throw new Error("ยังไม่ได้ตั้ง CONFIG.APP_URL ใน Config.gs");
  if (last < 2) return;
  var f =
    '=IF($D2="","",IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=150x150&data="&ENCODEURL("' +
    url +
    '?code="&$D2)))';
  sh.getRange(2, CONFIG.COL.QR + 1, last - 1, 1).setFormula(f);
  logActivity("ตั้งค่า QR", "อัปเดตสูตร QR เป็นลิงก์ " + url);
}
function setupAll() {
  borrowSheet_();
  ensureSheet_(CONFIG.SHEETS.CATEGORIES, "หมวดหมู่");
  ensureSheet_(CONFIG.SHEETS.LOCATIONS, "สถานที่");
  archiveLegacySheets();
}
// ซ่อนชีตเก่าที่ซ้ำและว่าง (ไม่ลบข้อมูล)
function archiveLegacySheets() {
  var ss = getSS_();
  CONFIG.LEGACY.forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() <= 2 && !sh.isSheetHidden()) sh.hideSheet();
  });
}

// ---------- 1. ดึงข้อมูล ----------
function getInitialData() {
  try {
    var ss = getSS_(),
      C = CONFIG.COL,
      S = CONFIG.SHEETS;
    var aSheet = ss.getSheetByName(S.ASSETS),
      assets = [];
    if (aSheet && aSheet.getLastRow() > 1) {
      var n = aSheet.getLastRow() - 1;
      assets = aSheet.getRange(2, 1, n, 16).getDisplayValues();
      var f = aSheet.getRange(2, C.IMG + 1, n, 1).getFormulas();
      assets.forEach(function (r, i) {
        var m = /"(https?:[^"]+)"/.exec(f[i][0] || "");
        r[C.IMG] = m ? m[1] : "";
      });
      assets = assets.filter(function (r) {
        return String(r[C.ID]).trim() !== "";
      });
    }
    var bSheet = borrowSheet_(),
      borrows = [];
    if (bSheet.getLastRow() > 1) {
      borrows = bSheet
        .getRange(2, 1, bSheet.getLastRow() - 1, 11)
        .getDisplayValues();
      // ต่อท้ายด้วยเลขแถวจริงในชีต (index 11) ใช้ตอนคืนของ
      borrows.forEach(function (r, i) {
        r.push(String(i + 2));
      });
    }

    var lSheet = ss.getSheetByName(S.LOGS),
      logs = [];
    if (lSheet && lSheet.getLastRow() > 1)
      logs = lSheet
        .getRange(2, 1, lSheet.getLastRow() - 1, 5)
        .getDisplayValues()
        .reverse()
        .slice(0, 50);

    var audit = [],
      uSheet = ss.getSheetByName(S.AUDIT);
    if (uSheet && uSheet.getLastRow() > 1)
      audit = uSheet
        .getRange(2, 1, uSheet.getLastRow() - 1, 5)
        .getDisplayValues()
        .filter(function (r) {
          return r[0] !== "";
        });

    var categories = listFrom_(S.CATEGORIES);
    assets.forEach(function (r) {
      if (r[C.CAT] && categories.indexOf(r[C.CAT]) < 0)
        categories.push(r[C.CAT]);
    });

    var summary = {
      total: assets.length,
      available: assets.filter(function (r) {
        return r[C.STATUS] === "พร้อมใช้งาน";
      }).length,
      borrowed: borrows.filter(function (r) {
        return r[8] === "กำลังยืม";
      }).length,
      lowStockCount: assets.filter(function (r) {
        return r[C.NEEDBUY] === "ต้องซื้อเพิ่ม";
      }).length,
    };
    return {
      success: true,
      assets: assets,
      borrows: borrows,
      logs: logs,
      audit: audit,
      categories: categories,
      locations: listFrom_(S.LOCATIONS),
      summary: summary,
      appUrl: appUrl_(),
    };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 2. เพิ่ม / แก้ไข ----------
function saveAssetData(f) {
  try {
    return withLock_(function () {
      var C = CONFIG.COL,
        sheet = assetSheet_();
      var newId = String(f.assetId || "").trim();
      if (!newId || !String(f.assetName || "").trim())
        return { success: false, message: "กรุณากรอกรหัสและชื่ออุปกรณ์" };
      var nums = [f.assetBtt, f.assetTke, f.assetMin, f.assetPrice];
      for (var k = 0; k < nums.length; k++) {
        var nv = Number(nums[k] || 0);
        if (isNaN(nv) || nv < 0)
          return { success: false, message: "ตัวเลขต้องไม่ติดลบ" };
      }
      var oldRow = f.oldAssetId ? findAssetRow_(sheet, f.oldAssetId) : -1;
      var isEdit = oldRow > 0;
      var dup = findAssetRow_(sheet, newId);
      if (dup > 0 && dup !== oldRow)
        return { success: false, message: "รหัส " + newId + " มีอยู่แล้ว" };

      var row = isEdit ? oldRow : lastDataRow_(sheet) + 1;
      if (!isEdit) {
        [C.QR, C.TOTAL, C.NEEDBUY].forEach(function (c) {
          if (row > 2) {
            var src = sheet.getRange(row - 1, c + 1);
            if (src.getFormula()) src.copyTo(sheet.getRange(row, c + 1));
          }
        });
        sheet.getRange(row, C.TIME + 1).setValue(new Date());
      }
      var btt = Number(f.assetBtt || 0),
        tke = Number(f.assetTke || 0);
      sheet
        .getRange(row, C.ID + 1, 1, 4)
        .setValues([
          [newId, f.assetName, f.assetCategory || "", f.assetLocation || ""],
        ]);
      sheet
        .getRange(row, C.MIN + 1, 1, 4)
        .setValues([
          [Number(f.assetMin || 0), Number(f.assetPrice || 0), btt, tke],
        ]);
      sheet
        .getRange(row, C.STATUS + 1)
        .setValue(f.assetStatus || "พร้อมใช้งาน");
      sheet.getRange(row, C.REMARK + 1).setValue(f.assetRemark || "");
      setTotal_(sheet, row, btt + tke);
      if (
        /^https:\/\/raw\.githubusercontent\.com\//.test(f.assetImageUrl || "")
      )
        sheet
          .getRange(row, C.IMG + 1)
          .setFormula('=IMAGE("' + f.assetImageUrl + '")');

      addLookup_(CONFIG.SHEETS.CATEGORIES, f.assetCategory);
      addLookup_(CONFIG.SHEETS.LOCATIONS, f.assetLocation);

      // เปลี่ยนรหัส (เช่น NEW-0001 -> รหัสจริง) ให้ประวัติเบิกตามไปด้วย
      if (isEdit && String(f.oldAssetId).trim() !== newId) {
        var b = borrowSheet_();
        if (b.getLastRow() > 1) {
          var rng = b.getRange(2, 2, b.getLastRow() - 1, 1),
            v = rng.getValues();
          v.forEach(function (x) {
            if (String(x[0]).trim() === String(f.oldAssetId).trim())
              x[0] = newId;
          });
          rng.setValues(v);
        }
      }
      logActivity(
        isEdit ? "แก้ไขอุปกรณ์" : "เพิ่มอุปกรณ์",
        newId + " - " + f.assetName,
      );
      return { success: true, message: "บันทึกข้อมูลอุปกรณ์สำเร็จ" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 3. ลบ ----------
function deleteAssetData(assetId) {
  try {
    return withLock_(function () {
      var sheet = assetSheet_(),
        row = findAssetRow_(sheet, assetId);
      if (row < 0)
        return { success: false, message: "ไม่พบข้อมูลอุปกรณ์ที่ต้องการลบ" };
      sheet.deleteRow(row);
      logActivity("ลบอุปกรณ์", "ลบรหัส " + assetId);
      return { success: true, message: "ลบข้อมูลสำเร็จ" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 4. อัปโหลดรูป GitHub ----------
// ตั้งค่า token: Project Settings > Script Properties > GITHUB_TOKEN
function uploadImageToGitHub(dataUrl, code) {
  try {
    var token =
      PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
    if (!token)
      return {
        success: false,
        message: "ยังไม่ได้ตั้งค่า GITHUB_TOKEN ใน Script Properties",
      };
    var base64 = String(dataUrl).replace(/^data:.*?;base64,/, "");
    var safe = String(code).replace(/[^A-Za-z0-9_-]/g, "") || "item";
    var stamp = Utilities.formatDate(
      new Date(),
      "Asia/Bangkok",
      "yyMMddHHmmss",
    );
    var path = "uploads/" + safe + "-" + stamp + ".jpg";
    var G = CONFIG.GITHUB;
    var res = UrlFetchApp.fetch(
      "https://api.github.com/repos/" +
        G.OWNER +
        "/" +
        G.REPO +
        "/contents/" +
        path,
      {
        method: "put",
        contentType: "application/json",
        muteHttpExceptions: true,
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
        },
        payload: JSON.stringify({
          message: "Upload image " + code,
          content: base64,
          branch: G.BRANCH,
        }),
      },
    );
    var rc = res.getResponseCode();
    if (rc === 200 || rc === 201) {
      logActivity("อัปโหลดรูป", String(code));
      return {
        success: true,
        url:
          "https://raw.githubusercontent.com/" +
          G.OWNER +
          "/" +
          G.REPO +
          "/" +
          G.BRANCH +
          "/" +
          path,
      };
    }
    return {
      success: false,
      message: JSON.parse(res.getContentText()).message || "อัปโหลดไม่สำเร็จ",
    };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 5. Log ----------
function logActivity(action, detail) {
  try {
    var ss = getSS_(),
      sh = ss.getSheetByName(CONFIG.SHEETS.LOGS);
    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEETS.LOGS);
      sh.appendRow(["#", "วัน-เวลา", "ผู้ใช้งาน", "กิจกรรม", "รายละเอียด"]);
    }
    sh.appendRow([
      sh.getLastRow(),
      new Date(),
      Session.getActiveUser().getEmail() || "User",
      action,
      detail,
    ]);
  } catch (e) {}
}

// ---------- 6. เบิก ----------
function saveBatchBorrowData(p) {
  try {
    return withLock_(function () {
      var C = CONFIG.COL,
        aSheet = assetSheet_(),
        bSheet = borrowSheet_(),
        items = p.items || [];
      if (!String(p.borrowerName || "").trim())
        return { success: false, message: "กรุณาระบุชื่อผู้เบิก" };
      if (!items.length)
        return { success: false, message: "ไม่มีรายการที่เบิก" };
      for (var q = 0; q < items.length; q++) {
        var qn = Number(items[q].quantity);
        if (!(qn >= 1) || Math.floor(qn) !== qn)
          return {
            success: false,
            message: "จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป",
          };
      }
      for (var i = 0; i < items.length; i++) {
        var r = findAssetRow_(aSheet, items[i].itemCode);
        if (r < 0)
          return { success: false, message: "ไม่พบรหัส " + items[i].itemCode };
        var v = aSheet.getRange(r, C.BTT + 1, 1, 2).getValues()[0];
        if (
          Number(items[i].quantity) >
          (Number(v[0]) || 0) + (Number(v[1]) || 0)
        )
          return {
            success: false,
            message: "สต็อก " + items[i].itemCode + " ไม่พอ",
          };
      }
      var today = Utilities.formatDate(
        new Date(),
        "Asia/Bangkok",
        "dd/MM/yyyy",
      );
      items.forEach(function (it) {
        var s = adjustStock_(it.itemCode, -Number(it.quantity));
        bSheet.appendRow([
          bSheet.getLastRow(),
          it.itemCode,
          p.projectName || "-",
          Number(it.quantity),
          today,
          "-",
          p.borrowerName,
          p.locationAddress || "-",
          "กำลังยืม",
          s.fromBtt,
          s.fromTke,
        ]);
      });
      logActivity(
        "เบิกอุปกรณ์",
        "ผู้เบิก: " + p.borrowerName + " โครงการ: " + (p.projectName || "-"),
      );
      return { success: true, message: "บันทึกการเบิกอุปกรณ์สำเร็จ" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// delta ลบ = เบิก (หัก BTT ก่อน แล้ว TKE) / delta บวก = คืน
// split = {btt, tke} ที่เคยหักไว้ตอนเบิก เพื่อคืนเข้าช่องเดิม
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

// ---------- 7. คืน ----------
// sheetRow = เลขแถวจริงในชีต BorrowData
function returnAsset(itemCode, sheetRow) {
  try {
    return withLock_(function () {
      var b = borrowSheet_(),
        r = Number(sheetRow);
      if (!(r >= 2 && r <= b.getLastRow()))
        return {
          success: false,
          message: "ไม่พบรายการ กรุณารีเฟรชแล้วลองใหม่",
        };
      if (
        String(b.getRange(r, 2).getValue()).trim() !== String(itemCode).trim()
      )
        return {
          success: false,
          message: "ข้อมูลไม่ตรงกัน กรุณารีเฟรชแล้วลองใหม่",
        };
      if (b.getRange(r, 9).getValue() === "คืนแล้ว")
        return { success: false, message: "รายการนี้คืนแล้ว" };
      var qty = Number(b.getRange(r, 4).getValue()) || 1;
      var split = {
        btt: Number(b.getRange(r, 10).getValue()) || 0,
        tke: Number(b.getRange(r, 11).getValue()) || 0,
      };
      b.getRange(r, 6).setValue(
        Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy"),
      );
      b.getRange(r, 9).setValue("คืนแล้ว");
      adjustStock_(itemCode, qty, split);
      logActivity("คืนอุปกรณ์", "รหัส: " + itemCode);
      return { success: true, message: "คืนอุปกรณ์เข้าสต็อกเรียบร้อยแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}
