const CONFIG = {
  SPREADSHEET_ID: "1I5M57-Schy8lqPAcCmadX92hhGOV04c57a7ZyNTgkPA",
  SHEETS: {
    ASSETS: "Asset",
    BORROW: "BorrowData",
    LOGS: "SystemLogs",
    CATEGORIES: "Categories",
    LOCATIONS: "Locations",
    AUDIT: "ตรวจสอบข้อมูล (นำเข้า)",
  },
  // ชีตเก่าที่ซ้ำกับชีตหลัก (ใช้ใน archiveLegacySheets)
  LEGACY: ["ทะเบียนอุปกรณ์", "ประวัติยืมคืน", "ActivityLog", "Logs"],
  // ลำดับคอลัมน์ชีต Asset (นับจาก 0)
  COL: {
    QR: 0,
    TIME: 1,
    IMG: 2,
    ID: 3,
    NAME: 4,
    CAT: 5,
    LOC: 6,
    MAX: 7,
    MIN: 8,
    PRICE: 9,
    BTT: 10,
    TKE: 11,
    TOTAL: 12,
    STATUS: 13,
    NEEDBUY: 14,
    REMARK: 15,
  },
  // ลิงก์ Web app (ท้ายลิงก์ลงท้าย /exec) ใช้สร้าง QR ให้สแกนด้วยกล้องมือถือแล้วเปิดระบบได้
  // ถ้าเว้นว่าง ระบบจะลองดึงจาก ScriptApp.getService().getUrl()
  APP_URL:
    "https://script.google.com/macros/s/AKfycbxrk7oFoLSWSeAHj1H83FvlYWK_XXZmpPZ3zJYHzPTeDONa1CP2wXeWsuIrh9Kf11i7/exec",
  GITHUB: { OWNER: "kxma-blazi", REPO: "btt-Equipment", BRANCH: "main" },
};

//Todo: edit text Dark Mode = White
