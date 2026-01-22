const express = require("express");

const PORT = process.env.PORT || 3000;
const app = express();

// RAW BODY yakala
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

/* =======================
   WEBHOOK DEBUG
======================= */
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

/* =======================
   HEALTH
======================= */
app.get("/", (_, res) => {
  res.send("Webhook DEBUG aktif (keep-online YOK)");
});

app.listen(PORT, () => {
  console.log(`✅ WEBHOOK DEBUG AKTİF. Port: ${PORT}`);
});
