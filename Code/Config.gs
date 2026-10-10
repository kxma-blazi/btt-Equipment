const CONFIG = {
  SPREADSHEET_ID: "1I5M57-Schy8lqPAcCmadX92hhGOV04c57a7ZyNTgkPA",
  SHEETS: {
    ASSETS: "Asset",
    BORROW: "BorrowData",
    LOGS: "SystemLogs",
    CATEGORIES: "Categories",
    LOCATIONS: "Locations",
    BORROWERS: "รายชื่อผู้เบิก",
    AUDIT: "ตรวจสอบข้อมูล (นำเข้า)",
    ADJUST: "StockAdjust",
  },
  // ชื่อผู้ดูแลที่คืนแทนผู้อื่นได้ (ต้องสะกดตรงกับชื่อใน "รายชื่อผู้เบิก") เว้นว่าง = ไม่มี
  RETURN_ADMINS: [],
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
  // ข้อมูลติดต่อ (ปุ่ม "ติดต่อ" มุมขวาล่าง -> หน้าต่างป็อปอัพ) ช่องไหนเว้นว่าง = ไม่แสดง
  // LINE_URL = ลิงก์เพิ่มเพื่อน เช่น https://line.me/ti/p/~ไอดีไลน์ (ระบบสร้าง QR ให้เอง)
  // QR_IMAGE = (ไม่บังคับ) ลิงก์รูป QR ไลน์ตัวจริง เช่น https://raw.githubusercontent.com/kxma-blazi/btt-Equipment/main/pic/line-qr.png
  CONTACT: {
    NAME: "ผู้ดูแลระบบ",
    TITLE: "BTT Field Tool · Support",
    NOTE: "พบปัญหาการใช้งาน หรือต้องการแก้ไขข้อมูล ติดต่อได้เลย",
    HOURS: "",
    LINE_ID: "kingkumaallday",
    LINE_URL: "https://line.me/ti/p/~kingkumaallday",
    QR_IMAGE: "",
    PHONE: "",
    EMAIL: "",
    FACEBOOK: "",
    GITHUB: "https://github.com/kxma-blazi",
  },
  GITHUB: { OWNER: "kxma-blazi", REPO: "btt-Equipment", BRANCH: "main" },
};

//Todo: edit text Dark Mode = White
