const express = require("express");

const app = express();

/**
 * RAW BODY yakalamak için özel json parser
 */
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

/**
 * WAWP WEBHOOK ENDPOINT
 */
app.post("/webhook", (req, res) => {
  console.log("========================================");
  console.log("🚀 WAWP WEBHOOK GELDİ");
  console.log("🕒 TIME:", new Date().toISOString());
  console.log("🌍 IP:", req.headers["x-forwarded-for"] || req.socket.remoteAddress);
  console.log("📦 HEADERS:");
  console.log(JSON.stringify(req.headers, null, 2));
  console.log("📄 RAW BODY:");
  console.log(req.rawBody);
  console.log("📄 PARSED BODY:");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("========================================");

  res.sendStatus(200);
});

/**
 * Health check (Render için)
 */
app.get("/", (req, res) => {
  res.send("Webhook debug aktif");
});

/**
 * Server start
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Debug webhook aktif. Port: ${PORT}`);
});
