// ==========================================
// File: Code.gs
// ==========================================

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('BTT Field Tool')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------- Helpers & Utilities ----------
function appUrl_() {
  var stored = PropertiesService.getScriptProperties().getProperty("APP_URL");
  return stored || CONFIG.APP_URL || ScriptApp.getService().getUrl();
}

function getSS_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function assetSheet_() {
  return getSS_().getSheetByName(CONFIG.SHEETS.ASSETS);
}

function auditSheet_() {
  return ensureSheet_(CONFIG.SHEETS.AUDIT, "ตรวจสอบข้อมูล (นำเข้า)");
}

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
    sanitizeInput_(p.detail || p.status)
  ];
}

var AUDIT_LABELS_ = ["ประเด็น", "ต้นทาง", "รหัส", "ชื่อรายการ", "รายละเอียด"];

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
    .map(function (r) { return String(r[0]).trim(); })
    .filter(function (v) { return v; });
}

function ensureSheet_(name, header) {
  var ss = getSS_(), sh = ss.getSheetByName(name);
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
  var ss = getSS_(), sh = ss.getSheetByName(CONFIG.SHEETS.BORROW);
  var head = [
    "ลำดับ", "รหัส", "ชื่อโครงการ", "จำนวน", "วันที่เบิก", "วันที่คืน",
    "ผู้เบิก", "สถานที่", "สถานะ", "หักจาก BTT", "หักจาก TKE", "ผู้คืน"
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
function getInitialData() {
  try {
    migrateBorrowersOnce_();
    var ss = getSS_(), C = CONFIG.COL, S = CONFIG.SHEETS;
    var aSheet = ss.getSheetByName(S.ASSETS), assets = [];
    if (aSheet && aSheet.getLastRow() > 1) {
      var n = aSheet.getLastRow() - 1;
      assets = aSheet.getRange(2, 1, n, 16).getDisplayValues();

      assets.forEach(function (r) {
        var code = String(r[C.ID] || "").trim();
        if (code) {
          r[C.IMG] = "https://raw.githubusercontent.com/" + CONFIG.GITHUB.OWNER + "/" + CONFIG.GITHUB.REPO + "/" + CONFIG.GITHUB.BRANCH + "/pic/" + code + ".jpg";
        } else {
          r[C.IMG] = "";
        }
      });

      assets = assets.filter(function (r) {
        return String(r[C.ID]).trim() !== "";
      });
    }

    var bSheet = borrowSheet_(), borrows = [];
    if (bSheet.getLastRow() > 1) {
      borrows = bSheet
        .getRange(2, 1, bSheet.getLastRow() - 1, 12)
        .getDisplayValues();
      borrows.forEach(function (r, i) {
        var who = r[11];
        r[11] = String(i + 2);
        r[12] = who;
      });
    }

    var lSheet = ss.getSheetByName(S.LOGS), logs = [];
    if (lSheet && lSheet.getLastRow() > 1) {
      logs = lSheet
        .getRange(2, 1, lSheet.getLastRow() - 1, 5)
        .getDisplayValues()
        .reverse()
        .slice(0, 50);
    }

    var audit = [], uSheet = ss.getSheetByName(S.AUDIT);
    if (uSheet && uSheet.getLastRow() > 1) {
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
      var n = String(r[6] || "").trim();
      if (n && n !== "-" && r[8] === "กำลังยืม" && borrowers.indexOf(n) < 0) {
        borrowers.push(n);
      }
    });
    borrowers.sort(function (a, b) {
      return a.localeCompare(b, "th");
    });

    var categories = listFrom_(S.CATEGORIES);
    assets.forEach(function (r) {
      if (r[C.CAT] && categories.indexOf(r[C.CAT]) < 0) {
        categories.push(r[C.CAT]);
      }
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
      assets: assets,
      borrows: borrows,
      logs: logs,
      audit: audit,
      categories: categories,
      locations: listFrom_(S.LOCATIONS),
      borrowers: borrowers,
      summary: summary,
      appUrl: appUrl_(),
      sheetUrl: ss.getUrl(),
      contact: CONFIG.CONTACT || {},
    };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 2. บันทึก / แก้ไข อุปกรณ์ ---------
function saveAssetData(f) {
  try {
    return withLock_(function () {
      var C = CONFIG.COL,
        sheet = assetSheet_();
      var newId = sanitizeInput_(f.assetId);
      var assetName = sanitizeInput_(f.assetName);
      if (!newId || !assetName) {
        return { success: false, message: "กรุณากรอกรหัสและชื่ออุปกรณ์" };
      }

      var nums = [f.assetBtt, f.assetTke, f.assetMin, f.assetPrice];
      for (var k = 0; k < nums.length; k++) {
        var nv = Number(nums[k] || 0);
        if (isNaN(nv) || nv < 0)
          return { success: false, message: "ตัวเลขต้องไม่ติดลบ" };
      }

      var oldRow = f.oldAssetId ? findAssetRow_(sheet, f.oldAssetId) : -1;
      var isEdit = oldRow > 0;
      var dup = findAssetRow_(sheet, newId);
      if (dup > 0 && dup !== oldRow) {
        return { success: false, message: "รหัส " + newId + " มีอยู่แล้วในระบบ" };
      }

      var btt = Number(f.assetBtt || 0);
      var tke = Number(f.assetTke || 0);
      var total = btt + tke;
      var min = Number(f.assetMin || 0);
      var price = Number(f.assetPrice || 0);

      // รองรับสถานะพิเศษ เช่น ส่งซ่อม, ชำรุด, สูญหาย
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

      // ดึงข้อมูลเดิมเพื่อทำ Diff Logging
      var oldVals = [];
      if (isEdit) {
        oldVals = sheet.getRange(oldRow, 1, 1, 16).getDisplayValues()[0];
      }
      var oldMax = isEdit ? Number(oldVals[C.MAX]) || 0 : 0;
      var maxVal = oldMax;
      if (f.assetMax !== undefined && f.assetMax !== "") {
        maxVal = Number(f.assetMax) || 0;
      }

      var catVal = sanitizeInput_(f.assetCat || f.assetCategory);
      var locVal = sanitizeInput_(f.assetLoc || f.assetLocation);
      var remarkVal = sanitizeInput_(f.assetRemark);

      // ✅ แก้ไขเครื่องหมายลบ (-) ในการคำนวณ Index ให้ถูกต้องครบถ้วน
      var mid = [];
      mid[C.TIME - C.TIME] = nowStr;
      mid[C.IMG - C.TIME] = ""; // เว้นว่างไว้เพื่อใส่สูตร IMAGE ด้านล่าง
      mid[C.ID - C.TIME] = newId;
      mid[C.NAME - C.TIME] = assetName;
      mid[C.CAT - C.TIME] = catVal;
      mid[C.LOC - C.TIME] = locVal;
      mid[C.MAX - C.TIME] = maxVal;
      mid[C.MIN - C.TIME] = min;
      mid[C.PRICE - C.TIME] = price;
      mid[C.BTT - C.TIME] = btt;
      mid[C.TKE - C.TIME] = tke;

      sheet
        .getRange(targetRow, C.TIME + 1, 1, C.TKE - C.TIME + 1)
        .setValues([mid]);

      // 🌟 Pro Max Dynamic Image Formula: ผูกสูตรดึงรูปภาพอ้างอิงจากคอลัมน์รหัส (Col D) อัตโนมัติ
      var gh = CONFIG.GITHUB;
      var rawBaseUrl =
        "https://raw.githubusercontent.com/" +
        gh.OWNER +
        "/" +
        gh.REPO +
        "/" +
        gh.BRANCH +
        "/pic/";
      sheet
        .getRange(targetRow, C.IMG + 1)
        .setFormula(
          '=IF($D' +
            targetRow +
            '="", "", IMAGE("' +
            rawBaseUrl +
            '" & $D' +
            targetRow +
            ' & ".jpg"))',
        );

      // TOTAL / ต้องซื้อเพิ่ม
      setTotal_(sheet, targetRow, total);
      var nbCell = sheet.getRange(targetRow, C.NEEDBUY + 1);
      if (!nbCell.getFormula()) nbCell.setValue(needBuy);

      sheet.getRange(targetRow, C.STATUS + 1).setValue(status);
      sheet.getRange(targetRow, C.REMARK + 1).setValue(remarkVal);

      // แถวใหม่: ใส่สูตร QR ให้อัตโนมัติ
      var url = appUrl_();
      if (!isEdit && url) {
        sheet
          .getRange(targetRow, C.QR + 1)
          .setFormula(
            '=IF($D' +
              targetRow +
              '="","",IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=150x150&data="&ENCODEURL("' +
              url +
              '?code="&$D' +
              targetRow +
              ")))",
          );
      }

      addLookup_(CONFIG.SHEETS.CATEGORIES, catVal);
      addLookup_(CONFIG.SHEETS.LOCATIONS, locVal);

      if (f.auditRow) {
        try {
          deleteAuditRow(f.auditRow, newId, assetName, f.operator);
        } catch (e) {}
      }

      // Diff Logging: บันทึกการเปลี่ยนแปลงเทียบค่าเก่าและใหม่
      var actionType = isEdit ? "แก้ไขอุปกรณ์" : "เพิ่มอุปกรณ์";
      var logDetail = "";
      if (isEdit) {
        var changes = [];
        if (oldVals[C.ID] !== newId) changes.push("รหัส: " + oldVals[C.ID] + " ➔ " + newId);
        if (oldVals[C.NAME] !== assetName) changes.push("ชื่อ: " + oldVals[C.NAME] + " ➔ " + assetName);
        if (oldVals[C.CAT] !== catVal) changes.push("หมวดหมู่: " + (oldVals[C.CAT] || "-") + " ➔ " + (catVal || "-"));
        if (oldVals[C.LOC] !== locVal) changes.push("สถานที่: " + (oldVals[C.LOC] || "-") + " ➔ " + (locVal || "-"));
        if (Number(oldVals[C.BTT]) !== btt) changes.push("BTT: " + oldVals[C.BTT] + " ➔ " + btt);
        if (Number(oldVals[C.TKE]) !== tke) changes.push("TKE: " + oldVals[C.TKE] + " ➔ " + tke);
        if (Number(oldVals[C.PRICE]) !== price) changes.push("ราคา: " + oldVals[C.PRICE] + " ➔ " + price);
        if (oldVals[C.STATUS] !== status) changes.push("สถานะ: " + oldVals[C.STATUS] + " ➔ " + status);
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

      logActivity(actionType, logDetail, f.operator);

      return {
        success: true,
        message: isEdit
          ? "แก้ไขข้อมูลอุปกรณ์เรียบร้อยแล้ว (อัปเดตสูตรภาพและประวัติสมบูรณ์)"
          : "เพิ่มอุปกรณ์ใหม่เรียบร้อยแล้ว",
      };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 3. อัปโหลดรูปภาพเข้า GitHub ----------
function setGitHubToken(token) {
  PropertiesService.getScriptProperties().setProperty("GITHUB_TOKEN", String(token).trim());
  return "บันทึก GITHUB_TOKEN สำเร็จ";
}

function uploadImageToGitHub(dataUrl, code, operator) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
    if (!token) {
      return { 
        success: false, 
        message: "ยังไม่ได้ระบุ GITHUB_TOKEN ใน Script Properties (ตั้งค่าผ่านฟังก์ชัน setGitHubToken('YOUR_TOKEN'))" 
      };
    }

    var base64Data = dataUrl.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
    var gh = CONFIG.GITHUB;
    var path = "pic/" + String(code).trim() + ".jpg";
    var apiUrl = "https://api.github.com/repos/" + gh.OWNER + "/" + gh.REPO + "/contents/" + path;

    // ตรวจสอบว่ามีไฟล์เดิมอยู่หรือไม่
    var sha = "";
    try {
      var checkRes = UrlFetchApp.fetch(apiUrl + "?ref=" + gh.BRANCH, {
        method: "get",
        headers: {
          "Authorization": "token " + token,
          "Accept": "application/vnd.github.v3+json"
        },
        muteHttpExceptions: true
      });
      if (checkRes.getResponseCode() === 200) {
        var fileInfo = JSON.parse(checkRes.getContentText());
        sha = fileInfo.sha;
      }
    } catch (e) {}

    var payload = {
      message: "Upload image for " + code + " by " + (operator || "system"),
      content: base64Data,
      branch: gh.BRANCH
    };
    if (sha) payload.sha = sha;

    var response = UrlFetchApp.fetch(apiUrl, {
      method: "put",
      headers: {
        "Authorization": "token " + token,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var resCode = response.getResponseCode();
    if (resCode === 200 || resCode === 201) {
      var rawUrl = "https://raw.githubusercontent.com/" + gh.OWNER + "/" + gh.REPO + "/" + gh.BRANCH + "/" + path;
      logActivity("อัปโหลดรูปภาพ", "รหัส: " + code + " (GitHub)", operator);
      return { success: true, url: rawUrl, message: "อัปโหลดรูปภาพสำเร็จ" };
    } else {
      var errObj = JSON.parse(response.getContentText());
      return { success: false, message: "GitHub Error: " + (errObj.message || response.getContentText()) };
    }
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 4. ลบอุปกรณ์ ----------
function deleteAssetData(assetId, operator) {
  try {
    return withLock_(function () {
      var sheet = assetSheet_(), row = findAssetRow_(sheet, assetId);
      if (row < 0) return { success: false, message: "ไม่พบข้อมูลอุปกรณ์ที่ต้องการลบ" };
      var b = borrowSheet_();
      if (b.getLastRow() > 1) {
        var v = b.getRange(2, 1, b.getLastRow() - 1, 9).getValues();
        for (var i = 0; i < v.length; i++) {
          if (String(v[i][1]).trim() === String(assetId).trim() && v[i][8] === "กำลังยืม") {
            return {
              success: false,
              message: "ลบไม่ได้ ยังมีรายการ " + assetId + " ที่กำลังยืมอยู่ (แถว " + (i + 2) + ") กรุณาคืนก่อน",
            };
          }
        }
      }

      sheet.deleteRow(row);
      logActivity("ลบอุปกรณ์", "รหัส: " + assetId, operator);
      return { success: true, message: "ลบอุปกรณ์รหัส " + assetId + " เรียบร้อยแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 5. Log System ----------
function who_(user) {
  var w = sanitizeInput_(user).substring(0, 60);
  if (!w) {
    try { w = Session.getActiveUser().getEmail(); } catch (e) {}
  }
  return w || "ไม่ระบุ";
}

function logActivity(action, details, user) {
  try {
    var ss = getSS_();
    var logSheet = ss.getSheetByName(CONFIG.SHEETS.LOGS || "SystemLogs");
    if (!logSheet) {
      logSheet = ss.insertSheet(CONFIG.SHEETS.LOGS || "SystemLogs");
      logSheet.appendRow(["#", "วัน-เวลา", "ผู้ใช้งาน", "กิจกรรม", "รายละเอียด"]);
    }

    var thaiTime = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
    logSheet.appendRow([
      logSheet.getLastRow(),
      thaiTime,
      who_(user),
      sanitizeInput_(action),
      sanitizeInput_(details)
    ]);
  } catch (e) {
    console.error(e);
  }
}

// ---------- 6. ระบบเบิก ----------
function saveBatchBorrowData(p) {
  try {
    return withLock_(function () {
      var C = CONFIG.COL, aSheet = assetSheet_(), bSheet = borrowSheet_(), items = p.items || [];
      var borrower = sanitizeInput_(p.borrowerName);
      if (!borrower) return { success: false, message: "กรุณาระบุชื่อผู้เบิก" };
      if (!items.length) return { success: false, message: "ไม่มีรายการที่เบิก" };

      for (var q = 0; q < items.length; q++) {
        var qn = Number(items[q].quantity);
        if (!(qn >= 1) || Math.floor(qn) !== qn) {
          return { success: false, message: "จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป" };
        }
      }
      for (var i = 0; i < items.length; i++) {
        var r = findAssetRow_(aSheet, items[i].itemCode);
        if (r < 0) return { success: false, message: "ไม่พบรหัส " + items[i].itemCode };
        var v = aSheet.getRange(r, C.BTT + 1, 1, 2).getValues()[0];
        if (Number(items[i].quantity) > (Number(v[0]) || 0) + (Number(v[1]) || 0)) {
          return { success: false, message: "สต็อก " + items[i].itemCode + " ไม่เพียงพอ" };
        }
      }

      var today = Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");
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
          "-"
        ]);
        itemDetails.push(it.itemCode + " x" + it.quantity);
      });

      addLookup_(CONFIG.SHEETS.BORROWERS, borrower);

      var logDetail = "ผู้เบิก: " + borrower + " | โครงการ: " + (p.projectName || "-") + " | รายการ: [" + itemDetails.join(", ") + "]";
      logActivity("เบิกอุปกรณ์", logDetail, p.operator || borrower);
      return { success: true, message: "บันทึกการเบิกอุปกรณ์สำเร็จ" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function adjustStock_(code, delta, split) {
  var C = CONFIG.COL, sheet = assetSheet_(), row = findAssetRow_(sheet, code);
  var out = { fromBtt: 0, fromTke: 0 };
  if (row < 0) return out;
  var rng = sheet.getRange(row, C.BTT + 1, 1, 2), v = rng.getValues()[0];
  var btt = Number(v[0]) || 0, tke = Number(v[1]) || 0;
  
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
  
  var st = sheet.getRange(row, C.STATUS + 1), cur = st.getValue();
  if (btt + tke === 0 && cur === "พร้อมใช้งาน") st.setValue("ถูกยืม");
  else if (btt + tke > 0 && cur === "ถูกยืม") st.setValue("พร้อมใช้งาน");
  return out;
}

// ---------- 7. ระบบคืน ----------
function normName_(v) {
  return String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isAdminName_(who) {
  return (CONFIG.RETURN_ADMINS || []).some(function (n) {
    return normName_(n) === who;
  });
}

function returnAsset(itemCode, sheetRow, operator, returnedBy) {
  try {
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

      var opName = normName_(operator);
      if (!opName) {
        return { success: false, message: "กรุณาเลือกชื่อผู้ใช้งานก่อนคืน" };
      }
      if (opName !== normName_(borrower) && !isAdminName_(opName)) {
        return {
          success: false,
          message: "รายการนี้เป็นของ " + borrower + " คุณไม่สามารถคืนแทนได้",
        };
      }

      if (who !== normName_(borrower) && !isAdminName_(who)) {
        return {
          success: false,
          message:
            "สามารถคืนได้เฉพาะผู้เบิกเท่านั้น (ผู้เบิกรายการนี้: " +
            borrower +
            ")",
        };
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
      logActivity(
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
      var sh = borrowerSheet_(), names = listFrom_(CONFIG.SHEETS.BORROWERS), b = borrowSheet_();
      if (b.getLastRow() > 1) {
        b.getRange(2, 7, b.getLastRow() - 1, 1).getValues().forEach(function (r) {
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
  var b = borrowSheet_(), n = 0;
  if (b.getLastRow() < 2) return 0;
  b.getRange(2, 1, b.getLastRow() - 1, 9).getValues().forEach(function (v) {
    if (v[8] === "กำลังยืม" && normName_(v[6]) === normName_(name)) n++;
  });
  return n;
}

function addBorrowerName(name, operator) {
  try {
    return withLock_(function () {
      name = sanitizeInput_(name);
      if (!name) return { success: false, message: "กรุณากรอกชื่อ" };
      var dup = listFrom_(CONFIG.SHEETS.BORROWERS).some(function (n) {
        return normName_(n) === normName_(name);
      });
      if (dup) return { success: false, message: "มีชื่อ " + name + " อยู่แล้ว" };
      borrowerSheet_().appendRow([name]);
      logActivity("เพิ่มรายชื่อ", name, operator);
      return { success: true, message: "เพิ่มชื่อ " + name + " แล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function renameBorrowerName(oldName, newName, operator) {
  try {
    return withLock_(function () {
      oldName = sanitizeInput_(oldName);
      newName = sanitizeInput_(newName);
      if (!oldName || !newName) return { success: false, message: "กรุณากรอกชื่อ" };
      if (oldName === newName) return { success: true, message: "ไม่มีการเปลี่ยนแปลง" };
      
      var sh = borrowerSheet_(), last = sh.getLastRow(), rng = last > 1 ? sh.getRange(2, 1, last - 1, 1) : null, vals = rng ? rng.getValues() : [];
      var dup = vals.some(function (r) {
        var n = sanitizeInput_(r[0]);
        return n !== oldName && normName_(n) === normName_(newName);
      });
      if (dup) return { success: false, message: "มีชื่อ " + newName + " อยู่แล้ว" };
      
      var found = false;
      vals.forEach(function (r) {
        if (sanitizeInput_(r[0]) === oldName) {
          r[0] = newName;
          found = true;
        }
      });
      
      if (found) {
        rng.setValues(vals);
      } else {
        sh.appendRow([newName]);
      }
      
      logActivity("แก้ไขรายชื่อ", oldName + " ➔ " + newName, operator);
      return { success: true, message: "แก้ไขชื่อเป็น " + newName + " เรียบร้อยแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function deleteBorrowerName(name, operator) {
  try {
    return withLock_(function () {
      name = sanitizeInput_(name);
      if (!name) return { success: false, message: "ไม่พบชื่อที่ต้องการลบ" };
      var cnt = activeBorrowCount_(name);
      if (cnt > 0) {
        return {
          success: false,
          message: "ลบไม่ได้ " + name + " ยังมีรายการที่กำลังยืมอยู่ " + cnt + " รายการ กรุณาคืนก่อน",
        };
      }
      var sh = borrowerSheet_(), last = sh.getLastRow(), removed = 0;
      if (last > 1) {
        var vals = sh.getRange(2, 1, last - 1, 1).getValues();
        for (var i = vals.length - 1; i >= 0; i--) {
          if (normName_(vals[i][0]) === normName_(name)) {
            sh.deleteRow(i + 2);
            removed++;
          }
        }
      }
      if (!removed) return { success: false, message: "ไม่พบชื่อ " + name + " ในฐานข้อมูล" };
      logActivity("ลบรายชื่อ", name, operator);
      return { success: true, message: "ลบชื่อ " + name + " ออกจากฐานข้อมูลแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 9. ตรวจสอบข้อมูล (Audit) ----------
function addAuditRow(p, operator) {
  try {
    return withLock_(function () {
      var v = auditVals_(p);
      if (!v[0] && !v[2] && !v[3]) {
        return { success: false, message: "กรุณากรอกอย่างน้อย ประเด็น / รหัส / ชื่อรายการ" };
      }
      var sh = auditSheet_(), row = sh.getLastRow() + 1, rng = sh.getRange(row, 1, 1, 5);
      rng.setNumberFormat("@");
      rng.setValues([v]);
      logActivity("เพิ่มรายการตรวจสอบ", "รหัส: " + (v[2] || "-") + " | " + (v[3] || "-"), operator);
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
  ) return null;
  return { row: r, cur: cur };
}

function updateAuditRow(p, operator) {
  try {
    return withLock_(function () {
      var sh = auditSheet_(), hit = checkAuditRow_(sh, p);
      if (!hit) {
        return { success: false, message: "ไม่พบรายการหรือข้อมูลถูกแก้ไขไปก่อน กรุณารีเฟรชแล้วลองใหม่" };
      }
      var v = auditVals_(p);
      if (!v[0] && !v[2] && !v[3]) {
        return { success: false, message: "กรุณากรอกอย่างน้อย ประเด็น / รหัส / ชื่อรายการ" };
      }
      var ch = [];
      for (var i = 0; i < 5; i++) {
        if (String(hit.cur[i]).trim() !== v[i]) {
          ch.push(AUDIT_LABELS_[i] + ": " + (hit.cur[i] || "-") + " ➔ " + (v[i] || "-"));
        }
      }
      if (!ch.length) return { success: true, message: "ไม่มีการเปลี่ยนแปลง" };
      var rng = sh.getRange(hit.row, 1, 1, 5);
      rng.setNumberFormat("@");
      rng.setValues([v]);
      logActivity("แก้ไขรายการตรวจสอบ", "แถว " + hit.row + " (" + (v[2] || "-") + "): " + ch.join(" | "), operator);
      return { success: true, message: "บันทึกรายการตรวจสอบแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function deleteAuditRow(row, expectCode, expectName, operator) {
  try {
    return withLock_(function () {
      var sh = auditSheet_(), hit = checkAuditRow_(sh, {
        row: row,
        expectCode: expectCode,
        expectName: expectName,
      });
      if (!hit) {
        return { success: false, message: "ไม่พบรายการหรือข้อมูลถูกแก้ไขไปก่อน กรุณารีเฟรชแล้วลองใหม่" };
      }
      sh.deleteRow(hit.row);
      logActivity("ลบรายการตรวจสอบ", "รหัส: " + (hit.cur[2] || "-") + " | " + (hit.cur[3] || "-"), operator);
      return { success: true, message: "ลบรายการตรวจสอบแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- ฟังก์ชัน Setup & Admin ----------
function setupAll() {
  borrowSheet_();
  ensureSheet_(CONFIG.SHEETS.CATEGORIES, "หมวดหมู่");
  ensureSheet_(CONFIG.SHEETS.LOCATIONS, "สถานที่");
  ensureSheet_(CONFIG.SHEETS.BORROWERS, "รายชื่อผู้เบิก");
  archiveLegacySheets();
}

function setupQrFormulas() {
  var sh = assetSheet_(), last = sh.getLastRow(), url = appUrl_();
  if (!url) throw new Error("ยังไม่ได้ตั้ง CONFIG.APP_URL ใน Config.gs หรือ Script Properties");
  if (last < 2) return;
  var f = '=IF( $D2="","",IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=150x150&data="&ENCODEURL("' + url + '?code="&$D2)))';
  sh.getRange(2, CONFIG.COL.QR + 1, last - 1, 1).setFormula(f);
  logActivity("ตั้งค่า QR", "อัปเดตสูตร QR เป็นลิงก์ " + url);
}

function archiveLegacySheets() {
  var ss = getSS_();
  if (CONFIG.LEGACY && Array.isArray(CONFIG.LEGACY)) {
    CONFIG.LEGACY.forEach(function (n) {
      var sh = ss.getSheetByName(n);
      if (sh && sh.getLastRow() <= 2 && !sh.isSheetHidden()) sh.hideSheet();
    });
  }
}

function saveAppUrl(url) {
  try {
    url = String(url || "").trim();
    if (!/^https:\/\/script\.google\.com\/(a\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
      return {
        success: false,
        message: "ลิงก์ไม่ถูกต้อง ต้องเป็นลิงก์ Web app ที่ลงท้ายด้วย /exec",
      };
    }
    PropertiesService.getScriptProperties().setProperty("APP_URL", url);
    logActivity("ตั้งค่าลิงก์ระบบ", url);
    return { success: true, message: "บันทึกลิงก์ระบบสำเร็จ" };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}