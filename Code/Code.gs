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
    "ผู้คืน",
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
  ensureSheet_(CONFIG.SHEETS.BORROWERS, "รายชื่อผู้เบิก");
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
    migrateBorrowersOnce_();
    var ss = getSS_(),
      C = CONFIG.COL,
      S = CONFIG.SHEETS;
    var aSheet = ss.getSheetByName(S.ASSETS),
      assets = [];
    if (aSheet && aSheet.getLastRow() > 1) {
      var n = aSheet.getLastRow() - 1;
      assets = aSheet.getRange(2, 1, n, 16).getDisplayValues();

      // กำหนดลิงก์รูปภาพเป็น URL ธรรมดา ตรงตามรหัสอุปกรณ์ (เช่น TO-001.jpg)
      assets.forEach(function (r) {
        var code = String(r[C.ID] || "").trim();
        if (code) {
          r[C.IMG] =
            "https://raw.githubusercontent.com/kxma-blazi/btt-Equipment/main/pic/" +
            code +
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
      // r[11] = เลขแถวจริงในชีต (หน้าเว็บใช้อ้างอิง), r[12] = ชื่อผู้คืน
      borrows.forEach(function (r, i) {
        var who = r[11];
        r[11] = String(i + 2);
        r[12] = who;
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
        .map(function (r, i) {
          r.push(String(i + 2)); // r[5] = เลขแถวจริงในชีต (หน้าเว็บใช้อ้างอิง)
          return r;
        })
        .filter(function (r) {
          return r.slice(0, 5).join("").trim() !== "";
        });

    var borrowers = listFrom_(S.BORROWERS);
    borrows.forEach(function (r) {
      var n = String(r[6] || "").trim();
      // รวมเฉพาะคนที่ยังมีของค้างคืน (เพื่อให้คืนได้) ชื่อที่ลบแล้วจะไม่โผล่กลับมาจากประวัติ
      if (n && n !== "-" && r[8] === "กำลังยืม" && borrowers.indexOf(n) < 0)
        borrowers.push(n);
    });
    borrowers.sort(function (a, b) {
      return a.localeCompare(b, "th");
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
      borrowers: borrowers,
      summary: summary,
      appUrl: appUrl_(),
      contact: CONFIG.CONTACT || {},
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

      // --- ตรวจสอบการเปลี่ยนแปลงของแต่ละฟิลด์ (Diff Logging) ---
      var changes = [];
      if (isEdit) {
        var oldVals = sheet.getRange(oldRow, 1, 1, 16).getValues()[0];
        if (String(f.oldAssetId).trim() !== newId) {
          changes.push("รหัส: " + oldVals[C.ID] + " ➔ " + newId);
        }
        if (
          String(oldVals[C.NAME] || "").trim() !==
          String(f.assetName || "").trim()
        ) {
          changes.push(
            "ชื่อ: " + (oldVals[C.NAME] || "-") + " ➔ " + f.assetName,
          );
        }
        if (
          String(oldVals[C.CAT] || "").trim() !==
          String(f.assetCategory || "").trim()
        ) {
          changes.push(
            "หมวดหมู่: " +
              (oldVals[C.CAT] || "-") +
              " ➔ " +
              (f.assetCategory || "-"),
          );
        }
        if (
          String(oldVals[C.LOC] || "").trim() !==
          String(f.assetLocation || "").trim()
        ) {
          changes.push(
            "สถานที่: " +
              (oldVals[C.LOC] || "-") +
              " ➔ " +
              (f.assetLocation || "-"),
          );
        }
        if (Number(oldVals[C.BTT] || 0) !== Number(f.assetBtt || 0)) {
          changes.push(
            "จำนวน BTT: " +
              (oldVals[C.BTT] || 0) +
              " ➔ " +
              Number(f.assetBtt || 0),
          );
        }
        if (Number(oldVals[C.TKE] || 0) !== Number(f.assetTke || 0)) {
          changes.push(
            "จำนวน TKE: " +
              (oldVals[C.TKE] || 0) +
              " ➔ " +
              Number(f.assetTke || 0),
          );
        }
        if (Number(oldVals[C.MIN] || 0) !== Number(f.assetMin || 0)) {
          changes.push(
            "Min Stock: " +
              (oldVals[C.MIN] || 0) +
              " ➔ " +
              Number(f.assetMin || 0),
          );
        }
        if (Number(oldVals[C.PRICE] || 0) !== Number(f.assetPrice || 0)) {
          changes.push(
            "ราคา: " +
              (oldVals[C.PRICE] || 0) +
              " ➔ " +
              Number(f.assetPrice || 0),
          );
        }
        if (
          String(oldVals[C.STATUS] || "").trim() !==
          String(f.assetStatus || "พร้อมใช้งาน").trim()
        ) {
          changes.push(
            "สถานะ: " +
              (oldVals[C.STATUS] || "พร้อมใช้งาน") +
              " ➔ " +
              f.assetStatus,
          );
        }
        if (
          String(oldVals[C.REMARK] || "").trim() !==
          String(f.assetRemark || "").trim()
        ) {
          changes.push(
            "หมายเหตุ: " +
              (oldVals[C.REMARK] || "-") +
              " ➔ " +
              (f.assetRemark || "-"),
          );
        }
      }

      var row = isEdit ? oldRow : lastDataRow_(sheet) + 1;
      // ถ้าแถวเต็มกริดแล้ว ให้เพิ่มแถวใหม่ก่อนเขียน (แก้ error "พิกัดอยู่นอกมิติข้อมูล")
      if (row > sheet.getMaxRows()) {
        sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows());
      }
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

      // คอลัมน์รูป: เป็นสูตรดึงจากคอลัมน์ D (รหัส) เสมอ ไม่ฝัง URL ตายตัว
      sheet
        .getRange(row, C.IMG + 1)
        .setFormula(
          "=IF(D" +
            row +
            '="","",IMAGE("https://raw.githubusercontent.com/' +
            CONFIG.GITHUB.OWNER +
            "/" +
            CONFIG.GITHUB.REPO +
            "/" +
            CONFIG.GITHUB.BRANCH +
            '/pic/"&D' +
            row +
            '&".jpg"))',
        );

      addLookup_(CONFIG.SHEETS.CATEGORIES, f.assetCategory);
      addLookup_(CONFIG.SHEETS.LOCATIONS, f.assetLocation);

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

      // ซิงก์รหัสในชีตตรวจสอบข้อมูลให้ตรงกับทะเบียน
      var auSh = getSS_().getSheetByName(CONFIG.SHEETS.AUDIT);
      if (auSh && auSh.getLastRow() > 1) {
        if (isEdit && String(f.oldAssetId).trim() !== newId) {
          var aRng = auSh.getRange(2, 3, auSh.getLastRow() - 1, 1),
            aVal = aRng.getValues(),
            aChanged = false;
          aVal.forEach(function (x) {
            if (String(x[0]).trim() === String(f.oldAssetId).trim()) {
              x[0] = newId;
              aChanged = true;
            }
          });
          if (aChanged) {
            aRng.setNumberFormat("@");
            aRng.setValues(aVal);
          }
        }
        var aRow = Number(f.auditRow);
        if (aRow >= 2 && aRow <= auSh.getLastRow()) {
          var aCell = auSh.getRange(aRow, 3);
          aCell.setNumberFormat("@");
          aCell.setValue(newId);
        }
      }

      // ข้อความรายละเอียด Log
      var detailText = "";
      if (isEdit) {
        detailText =
          "แก้ไข " +
          newId +
          " (" +
          f.assetName +
          "): " +
          (changes.length > 0 ? changes.join(" | ") : "ไม่มีการเปลี่ยนข้อมูล");
      } else {
        detailText =
          "เพิ่มอุปกรณ์ใหม่ " +
          newId +
          " (" +
          f.assetName +
          ") - BTT: " +
          btt +
          ", TKE: " +
          tke +
          ", สถานที่: " +
          (f.assetLocation || "-");
      }

      logActivity(
        isEdit ? "แก้ไขอุปกรณ์" : "เพิ่มอุปกรณ์",
        detailText,
        f.operator,
      );
      return { success: true, message: "บันทึกข้อมูลอุปกรณ์สำเร็จ" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 3. ลบ ----------
function deleteAssetData(assetId, operator) {
  try {
    return withLock_(function () {
      var C = CONFIG.COL,
        sheet = assetSheet_(),
        row = findAssetRow_(sheet, assetId);
      if (row < 0)
        return { success: false, message: "ไม่พบข้อมูลอุปกรณ์ที่ต้องการลบ" };
      var b = borrowSheet_();
      if (b.getLastRow() > 1) {
        var v = b.getRange(2, 1, b.getLastRow() - 1, 9).getValues();
        for (var i = 0; i < v.length; i++)
          if (
            String(v[i][1]).trim() === String(assetId).trim() &&
            v[i][8] === "กำลังยืม"
          )
            return {
              success: false,
              message:
                "ลบไม่ได้ ยังมีรายการ " +
                assetId +
                " ที่กำลังยืมอยู่ (แถว " +
                (i + 2) +
                " ในชีต BorrowData) กรุณาคืนก่อน",
            };
      }

      // ดึงรายละเอียดเดิมของอุปกรณ์ก่อนถูกลบ
      var oldVals = sheet.getRange(row, 1, 1, 16).getValues()[0];
      var deletedDetail =
        "ลบอุปกรณ์รหัส " +
        assetId +
        " (" +
        (oldVals[C.NAME] || "-") +
        ") - สต็อก BTT: " +
        (oldVals[C.BTT] || 0) +
        ", TKE: " +
        (oldVals[C.TKE] || 0) +
        ", สถานที่: " +
        (oldVals[C.LOC] || "-");

      sheet.deleteRow(row);
      logActivity("ลบอุปกรณ์", deletedDetail, operator);
      return { success: true, message: "ลบข้อมูลสำเร็จ" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 4. อัปโหลดรูป GitHub ----------
// ตั้งค่า token: Project Settings > Script Properties > GITHUB_TOKEN
function uploadImageToGitHub(dataUrl, code, operator) {
  try {
    var token =
      PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
    if (!token)
      return {
        success: false,
        message: "ยังไม่ได้ตั้งค่า GITHUB_TOKEN ใน Script Properties",
      };
    code = String(code || "").trim();
    if (!code || code.replace(/[^A-Za-z0-9_-]/g, "") !== code)
      return {
        success: false,
        message:
          "รหัสใช้ตั้งชื่อไฟล์รูปไม่ได้ ใช้ได้เฉพาะ A-Z a-z 0-9 - _ (ไม่มีช่องว่าง)",
      };
    var base64 = String(dataUrl).replace(/^data:.*?;base64,/, "");
    // เก็บที่ pic/รหัส.jpg ตรงกับที่หน้าเว็บอ่านรูป (ถ้ามีไฟล์เดิมจะเขียนทับ)
    var path = "pic/" + code + ".jpg";
    var G = CONFIG.GITHUB;
    var api =
      "https://api.github.com/repos/" +
      G.OWNER +
      "/" +
      G.REPO +
      "/contents/" +
      path;
    var headers = {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
    };
    var sha = null;
    var g = UrlFetchApp.fetch(api + "?ref=" + encodeURIComponent(G.BRANCH), {
      method: "get",
      muteHttpExceptions: true,
      headers: headers,
    });
    if (g.getResponseCode() === 200) sha = JSON.parse(g.getContentText()).sha;
    var body = {
      message: (sha ? "Update image " : "Upload image ") + code,
      content: base64,
      branch: G.BRANCH,
    };
    if (sha) body.sha = sha;
    var res = UrlFetchApp.fetch(api, {
      method: "put",
      contentType: "application/json",
      muteHttpExceptions: true,
      headers: headers,
      payload: JSON.stringify(body),
    });
    var rc = res.getResponseCode();
    if (rc === 200 || rc === 201) {
      logActivity("อัปโหลดรูป", code, operator);
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
    var msg = "อัปโหลดไม่สำเร็จ";
    try {
      msg = JSON.parse(res.getContentText()).message || msg;
    } catch (x) {}
    return { success: false, message: msg };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 5. Log ----------
// ชื่อผู้ทำรายการ: ใช้ชื่อที่กรอกในหน้าเว็บ ถ้าไม่มีใช้อีเมล (ถ้าได้) หรือ "ไม่ระบุ"
function who_(user) {
  var w = String(user || "")
    .trim()
    .substring(0, 60);
  if (!w) {
    try {
      w = Session.getActiveUser().getEmail();
    } catch (e) {}
  }
  if (!w) w = "ไม่ระบุ";
  if (/^[=+\-@]/.test(w)) w = "'" + w; // กัน formula injection ในชีต
  return w;
}

function logActivity(action, details, user) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName(CONFIG.SHEETS.LOGS || "ActivityLogs");
    if (!logSheet) {
      logSheet = ss.insertSheet(CONFIG.SHEETS.LOGS || "ActivityLogs");
      logSheet.appendRow([
        "#",
        "วัน-เวลา",
        "ผู้ใช้งาน",
        "กิจกรรม",
        "รายละเอียด",
      ]);
    }

    // บังคับดึงเวลาเป็นโซนประเทศไทย (Asia/Bangkok)
    var thaiTime = Utilities.formatDate(
      new Date(),
      "Asia/Bangkok",
      "yyyy-MM-dd HH:mm:ss",
    );

    logSheet.appendRow([
      logSheet.getLastRow(),
      thaiTime,
      who_(user || ""),
      action,
      details,
    ]);
  } catch (e) {
    console.error(e);
  }
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

      // อัปเดตตรงนี้: เพิ่ม HH:mm:ss เพื่อบันทึกเวลาปัจจุบันตามโซนประเทศไทย
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
        itemDetails.push(it.itemCode + " x" + it.quantity);
      });

      addLookup_(CONFIG.SHEETS.BORROWERS, p.borrowerName);

      var logDetail =
        "ผู้เบิก: " +
        p.borrowerName +
        " | โครงการ: " +
        (p.projectName || "-") +
        " | รายการ: [" +
        itemDetails.join(", ") +
        "]";

      logActivity("เบิกอุปกรณ์", logDetail, p.operator || p.borrowerName);
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
function normName_(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function returnAsset(itemCode, sheetRow, operator, returnedBy) {
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
      // คืนได้เฉพาะผู้เบิก (หรือผู้ดูแลที่กำหนดใน CONFIG.RETURN_ADMINS)
      var borrower = String(b.getRange(r, 7).getValue());
      var who = normName_(returnedBy);
      if (!who) return { success: false, message: "กรุณาเลือกชื่อผู้คืน" };
      var isAdmin = (CONFIG.RETURN_ADMINS || []).some(function (n) {
        return normName_(n) === who;
      });
      if (who !== normName_(borrower) && !isAdmin)
        return {
          success: false,
          message:
            "คืนได้เฉพาะผู้เบิกเท่านั้น (ผู้เบิกรายการนี้: " + borrower + ")",
        };
      var qty = Number(b.getRange(r, 4).getValue()) || 1;
      var split = {
        btt: Number(b.getRange(r, 10).getValue()) || 0,
        tke: Number(b.getRange(r, 11).getValue()) || 0,
      };
      b.getRange(r, 6).setValue(
        Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy"),
      );
      b.getRange(r, 9).setValue("คืนแล้ว");
      b.getRange(r, 12).setValue(String(returnedBy || "").trim());
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

// ---------- 8. จัดการรายชื่อผู้เบิก / ผู้ใช้งาน ----------
function borrowerSheet_() {
  return ensureSheet_(CONFIG.SHEETS.BORROWERS, "รายชื่อผู้เบิก");
}
function cleanName_(v) {
  return String(v == null ? "" : v)
    .replace(/\s+/g, " ")
    .trim();
}
function badLead_(v) {
  return /^[=+\-@]/.test(v);
}
// รันอัตโนมัติครั้งเดียว: ดึงชื่อเดิมจากประวัติเข้าชีตรายชื่อ เพื่อให้ทุกชื่อลบ/แก้ไขได้
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
            var n = cleanName_(r[0]);
            if (n && n !== "-" && !badLead_(n) && names.indexOf(n) < 0) {
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
function addBorrowerName(name, operator) {
  try {
    return withLock_(function () {
      name = cleanName_(name);
      if (!name) return { success: false, message: "กรุณากรอกชื่อ" };
      if (badLead_(name))
        return {
          success: false,
          message: "ชื่อห้ามขึ้นต้นด้วย = + - @",
        };
      var dup = listFrom_(CONFIG.SHEETS.BORROWERS).some(function (n) {
        return normName_(n) === normName_(name);
      });
      if (dup)
        return { success: false, message: "มีชื่อ " + name + " อยู่แล้ว" };
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
      oldName = cleanName_(oldName);
      newName = cleanName_(newName);
      if (!oldName || !newName)
        return { success: false, message: "กรุณากรอกชื่อ" };
      if (badLead_(newName))
        return { success: false, message: "ชื่อห้ามขึ้นต้นด้วย = + - @" };
      if (oldName === newName)
        return { success: true, message: "ไม่มีการเปลี่ยนแปลง" };
      var sh = borrowerSheet_(),
        last = sh.getLastRow(),
        rng = last > 1 ? sh.getRange(2, 1, last - 1, 1) : null,
        vals = rng ? rng.getValues() : [];
      var dup = vals.some(function (r) {
        var n = cleanName_(r[0]);
        return n !== oldName && normName_(n) === normName_(newName);
      });
      if (dup)
        return { success: false, message: "มีชื่อ " + newName + " อยู่แล้ว" };
      var found = false;
      vals.forEach(function (r) {
        if (cleanName_(r[0]) === oldName) {
          r[0] = newName;
          found = true;
        }
      });
      if (found) rng.setValues(vals);
      else sh.appendRow([newName]);

      // อัปเดตชื่อในประวัติ BorrowData (ผู้เบิก = คอลัมน์ 7, ผู้คืน = คอลัมน์ 12)
      var b = borrowSheet_(),
        updated = 0;
      if (b.getLastRow() > 1) {
        [7, 12].forEach(function (col) {
          var cr = b.getRange(2, col, b.getLastRow() - 1, 1),
            cv = cr.getValues(),
            ch = false;
          cv.forEach(function (r) {
            if (normName_(r[0]) === normName_(oldName)) {
              r[0] = newName;
              ch = true;
              updated++;
            }
          });
          if (ch) cr.setValues(cv);
        });
      }
      logActivity(
        "แก้ไขชื่อ",
        oldName + " ➔ " + newName + " (ปรับในประวัติ " + updated + " จุด)",
        operator,
      );
      return { success: true, message: "เปลี่ยนชื่อเป็น " + newName + " แล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}
function deleteBorrowerName(name, operator) {
  try {
    return withLock_(function () {
      name = cleanName_(name);
      if (!name) return { success: false, message: "ไม่พบชื่อที่ต้องการลบ" };
      var cnt = activeBorrowCount_(name);
      if (cnt > 0)
        return {
          success: false,
          message:
            "ลบไม่ได้ " +
            name +
            " ยังมีรายการที่กำลังยืมอยู่ " +
            cnt +
            " รายการ กรุณาคืนก่อน",
        };
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
      logActivity("ลบรายชื่อ", name, operator);
      return {
        success: true,
        message: "ลบชื่อ " + name + " ออกจากฐานข้อมูลแล้ว",
      };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// ---------- 9. จัดการรายการ "ตรวจสอบข้อมูล (นำเข้า)" ----------
function auditSheet_() {
  var ss = getSS_(),
    sh = ss.getSheetByName(CONFIG.SHEETS.AUDIT);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEETS.AUDIT);
    sh.appendRow(["ประเด็น", "ชีตต้นทาง", "รหัส", "ชื่อรายการ", "รายละเอียด"]);
  }
  return sh;
}
function auditVals_(p) {
  return [p.issue, p.source, p.code, p.name, p.detail].map(function (v) {
    return String(v == null ? "" : v).trim();
  });
}
var AUDIT_LABELS_ = [
  "ประเด็น",
  "ชีตต้นทาง",
  "รหัส",
  "ชื่อรายการ",
  "รายละเอียด",
];

function addAuditRow(p, operator) {
  try {
    return withLock_(function () {
      var v = auditVals_(p);
      if (!v[0] && !v[2] && !v[3])
        return {
          success: false,
          message: "กรุณากรอกอย่างน้อย ประเด็น / รหัส / ชื่อรายการ",
        };
      var sh = auditSheet_(),
        row = sh.getLastRow() + 1,
        rng = sh.getRange(row, 1, 1, 5);
      rng.setNumberFormat("@");
      rng.setValues([v]);
      logActivity(
        "เพิ่มรายการตรวจสอบ",
        "รหัส: " +
          (v[2] || "-") +
          " | " +
          (v[3] || "-") +
          " | " +
          (v[0] || "-"),
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
    return withLock_(function () {
      var sh = auditSheet_(),
        hit = checkAuditRow_(sh, p);
      if (!hit)
        return {
          success: false,
          message: "ไม่พบรายการหรือข้อมูลถูกแก้ไขไปก่อน กรุณารีเฟรชแล้วลองใหม่",
        };
      var v = auditVals_(p);
      if (!v[0] && !v[2] && !v[3])
        return {
          success: false,
          message: "กรุณากรอกอย่างน้อย ประเด็น / รหัส / ชื่อรายการ",
        };
      var ch = [];
      for (var i = 0; i < 5; i++)
        if (String(hit.cur[i]).trim() !== v[i])
          ch.push(
            AUDIT_LABELS_[i] +
              ": " +
              (hit.cur[i] || "-") +
              " ➔ " +
              (v[i] || "-"),
          );
      if (!ch.length) return { success: true, message: "ไม่มีการเปลี่ยนแปลง" };
      var rng = sh.getRange(hit.row, 1, 1, 5);
      rng.setNumberFormat("@");
      rng.setValues([v]);
      logActivity(
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
function deleteAuditRow(row, expectCode, expectName, operator) {
  try {
    return withLock_(function () {
      var sh = auditSheet_(),
        hit = checkAuditRow_(sh, {
          row: row,
          expectCode: expectCode,
          expectName: expectName,
        });
      if (!hit)
        return {
          success: false,
          message: "ไม่พบรายการหรือข้อมูลถูกแก้ไขไปก่อน กรุณารีเฟรชแล้วลองใหม่",
        };
      sh.deleteRow(hit.row);
      logActivity(
        "ลบรายการตรวจสอบ",
        "รหัส: " +
          (hit.cur[2] || "-") +
          " | " +
          (hit.cur[3] || "-") +
          " | " +
          (hit.cur[0] || "-"),
        operator,
      );
      return { success: true, message: "ลบรายการตรวจสอบแล้ว" };
    });
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}
