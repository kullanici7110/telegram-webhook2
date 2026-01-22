const express = require("express");
const axios = require("axios");

const {
  PORT = 3000,
  WAWP_INSTANCE_ID,
  WAWP_ACCESS_TOKEN
} = process.env;

if (!WAWP_INSTANCE_ID || !WAWP_ACCESS_TOKEN) {
  console.error("❌ ENV eksik");
  process.exit(1);
}

const app = express();

// RAW BODY yakala
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

/* =======================
   KEEP ALIVE (1 DK)
======================= */
async function keepOnline() {
  try {
    const res = await axios.post(
      "https://wawp.net/wp-json/awp/v1/presence",
      null,
      {
        params: {
          instance_id: WAWP_INSTANCE_ID,
          access_token: WAWP_ACCESS_TOKEN,
          presence: "online"
        },
        timeout: 15000
      }
    );

    console.log("🟢 KEEP-ALIVE OK",
      "status:", res.status,
      "time:", new Date().toISOString()
    );
  } catch (e) {
    console.error("🔴 KEEP-ALIVE FAIL",
      "time:", new Date().toISOString(),
      "msg:", e.message,
      "status:", e.response?.status,
      "data:", e.response?.data
    );
  }
}

// Başlangıç + her 60 saniye
keepOnline();
setInterval(keepOnline, 60 * 1000);

/* =======================
   WEBHOOK DEBUG
======================= */
app.post("/webhook", (req, res) => {
  console.log("========================================");
  console.log("🚀 WEBHOOK GELDİ");
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
  res.send("DEBUG aktif: keep-alive + webhook log");
});

app.listen(PORT, () => {
  console.log(`✅ DEBUG server aktif. Port: ${PORT}`);
});
