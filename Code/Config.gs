// ==========================================
// File: Config.gs
// ==========================================
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
  RETURN_ADMINS: [],
  LEGACY: ["ทะเบียนอุปกรณ์", "ประวัติยืมคืน", "ActivityLog", "Logs"],
  COL: {
    QR: 0,      // Col A: QR-Code
    TIME: 1,    // Col B: Time-Stamp
    IMG: 2,     // Col C: รูปภาพ
    ID: 3,      // Col D: รหัส
    NAME: 4,    // Col E: ชื่อรายการ
    CAT: 5,     // Col F: หมวดหมู่
    LOC: 6,     // Col G: สถานที่จัดเก็บ
    MAX: 7,     // Col H: Stock Max
    MIN: 8,     // Col I: Stock Min
    PRICE: 9,   // Col J: ราคา/หน่วย
    BTT: 10,    // Col K: BTT
    TKE: 11,    // Col L: TKE
    TOTAL: 12,  // Col M: TOTAL
    STATUS: 13, // Col N: สถานะ
    NEEDBUY: 14,// Col O: ต้องซื้อเพิ่ม
    REMARK: 15, // Col P: หมายเหตุ
  },
  APP_URL: "https://script.google.com/macros/s/AKfycbxrk7oFoLSWSeAHj1H83FvlYWK_XXZmpPZ3zJYHzPTeDONa1CP2wXeWsuIrh9Kf11i7/exec",
  CONTACT: {
    NAME: "ผู้ดูแลระบบ BTT Field Tool",
    TITLE: "BTT Field Tool · Support Pro Max",
    NOTE: "ระบบจัดการเครื่องมือหน้างานอัจฉริยะ",
    HOURS: "จันทร์ - เสาร์ (08:00 - 17:00 น.)",
    LINE_ID: "kingkumaallday",
    LINE_URL: "https://line.me/ti/p/~kingkumaallday",
    QR_IMAGE: "",
    PHONE: "",
    EMAIL: "",
    FACEBOOK: "",
    GITHUB: "https://github.com/kxma-blazi/btt-Equipment/tree/88b1d1c4dda43923aead601be90bdc0ca7a9facc/Code",
  },
  GITHUB: { 
    OWNER: "kxma-blazi", 
    REPO: "btt-Equipment", 
    BRANCH: "main" 
  },
};
