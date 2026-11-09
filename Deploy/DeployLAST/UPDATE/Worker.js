// Cloudflare Worker: พร็อกซีรูปจาก GitHub + แคชที่ edge
// Deploy: Cloudflare Dashboard > Workers & Pages > Create > วางโค้ดนี้ > Deploy
// แล้วนำ URL ไปใส่ CONFIG.IMG_PROXY ใน Config.gs
const OWNER = "kxma-blazi",
  REPO = "btt-Equipment",
  BRANCH = "main";

export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (!u.pathname.startsWith("/pic/"))
      return new Response("not found", { status: 404 });

    const versioned = u.searchParams.has("v"); // v = sha ของไฟล์ รูปเปลี่ยน URL เปลี่ยน จึงแคชถาวรได้
    const ttl = versioned ? 31536000 : 300;
    const origin =
      `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/` +
      u.pathname.slice(5) +
      u.search;

    const r = await fetch(origin, {
      cf: {
        cacheEverything: true,
        cacheTtl: ttl,
        cacheTtlByStatus: { "200-299": ttl, 404: 30, "500-599": 0 },
      },
    });
    const h = new Headers(r.headers);
    h.set(
      "Cache-Control",
      r.ok
        ? versioned
          ? "public, max-age=31536000, immutable"
          : "public, max-age=300"
        : "no-store",
    );
    h.set("Access-Control-Allow-Origin", "*");
    h.delete("set-cookie");
    return new Response(r.body, { status: r.status, headers: h });
  },
};
