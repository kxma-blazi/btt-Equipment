// ==================== Pics.gs — ตรวจ/แก้รูปที่ไม่ตรงรหัส ====================
const PIC_AUDIT = "ตรวจรูป";

// 1) สร้างชีต "ตรวจรูป": รหัส | ชื่อ | รูปที่ระบบแสดงตอนนี้ | (กรอก) ไฟล์รูปที่ถูกต้อง
function buildPicAudit() {
  var ss = getSS_(),
    C = CONFIG.COL,
    gh = CONFIG.GITHUB;
  var src = ss.getSheetByName(CONFIG.SHEETS.ASSETS);
  var rows = src.getRange(2, 1, src.getLastRow() - 1, 5).getDisplayValues();
  var base =
    "https://raw.githubusercontent.com/" +
    gh.OWNER + "/" + gh.REPO + "/" + gh.BRANCH + "/pic/";

  var sh = ss.getSheetByName(PIC_AUDIT) || ss.insertSheet(PIC_AUDIT);
  sh.clear();
  sh.getRange(1, 1, 1, 4)
    .setValues([[
      "รหัสในระบบ",
      "ชื่อรายการ",
      "รูปที่ระบบแสดงตอนนี้",
      "รูปที่ถูกต้อง = ไฟล์ของรหัส (กรอกเฉพาะแถวที่ผิด)",
    ]])
    .setFontWeight("bold")
    .setBackground("#e8eef7");
  sh.setFrozenRows(1);

  var data = [], forms = [];
  rows.forEach(function (r) {
    var code = String(r[C.ID]).trim();
    if (!code) return;
    data.push([code, r[C.NAME]]);
    forms.push(['=IMAGE("' + base + code + '.jpg")']);
  });
  if (!data.length) return;
  sh.getRange(2, 1, data.length, 2).setValues(data);
  sh.getRange(2, 3, data.length, 1).setFormulas(forms);
  sh.getRange(2, 4, data.length, 1).setNumberFormat("@");
  sh.setRowHeights(2, data.length, 90);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 130);
  sh.setColumnWidth(4, 220);
  Logger.log("สร้างชีต " + PIC_AUDIT + " " + data.length + " แถว");
}

// 2) อ่านคอลัมน์ D แล้วย้ายรูปบน GitHub ให้ตรง (commit เดียว สลับกันได้ ย้อนกลับได้จาก history)
//    เช่น แถว TOL-027 ใส่ D = TOL-023 แปลว่า รูปที่ถูกของ TOL-027 ตอนนี้อยู่ใน pic/TOL-023.jpg
function applyPicMap() {
  var ss = getSS_(),
    gh = CONFIG.GITHUB;
  var sh = ss.getSheetByName(PIC_AUDIT);
  if (!sh || sh.getLastRow() < 2)
    throw new Error("ยังไม่มีชีต " + PIC_AUDIT + " (รัน buildPicAudit ก่อน)");
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues();

  var ref = ghApi_("get", "/git/ref/heads/" + gh.BRANCH);
  var commitSha = ref.object.sha;
  var commit = ghApi_("get", "/git/commits/" + commitSha);
  var tree = ghApi_("get", "/git/trees/" + commit.tree.sha + "?recursive=1");
  var blob = {};
  tree.tree.forEach(function (t) {
    if (t.type === "blob" && /^pic\/.+\.jpg$/.test(t.path)) blob[t.path] = t.sha;
  });

  var entries = [], log = [];
  v.forEach(function (r) {
    var to = String(r[0]).trim(),
      from = String(r[3]).trim();
    if (!to || !from || from === to) return;
    var sha = blob["pic/" + from + ".jpg"];
    if (!sha) throw new Error("ไม่พบไฟล์ pic/" + from + ".jpg (แถว " + to + ")");
    entries.push({ path: "pic/" + to + ".jpg", mode: "100644", type: "blob", sha: sha });
    log.push(from + " → " + to);
  });
  if (!entries.length) {
    Logger.log("ไม่มีแถวที่กรอกคอลัมน์ D");
    return;
  }
  var nt = ghApi_("post", "/git/trees", { base_tree: commit.tree.sha, tree: entries });
  var nc = ghApi_("post", "/git/commits", {
    message: "Fix pic mapping (" + entries.length + " files)",
    tree: nt.sha,
    parents: [commitSha],
  });
  ghApi_("patch", "/git/refs/heads/" + gh.BRANCH, { sha: nc.sha });
  Logger.log("ย้ายรูปแล้ว " + entries.length + " ไฟล์\n" + log.join("\n"));
}

function ghApi_(method, path, body) {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("ยังไม่ได้ตั้ง GITHUB_TOKEN");
  var gh = CONFIG.GITHUB;
  var opt = {
    method: method,
    headers: { Authorization: "token " + token, Accept: "application/vnd.github+json" },
    muteHttpExceptions: true,
  };
  if (body) {
    opt.contentType = "application/json";
    opt.payload = JSON.stringify(body);
  }
  var r = UrlFetchApp.fetch(
    "https://api.github.com/repos/" + gh.OWNER + "/" + gh.REPO + path,
    opt
  );
  var c = r.getResponseCode();
  if (c < 200 || c >= 300)
    throw new Error("GitHub " + c + ": " + r.getContentText().substring(0, 200));
  return JSON.parse(r.getContentText());
}