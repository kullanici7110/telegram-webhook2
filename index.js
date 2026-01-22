const express = require("express");
const axios = require("axios");

const {
  PORT = 3000,
  WAWP_INSTANCE_ID,
  WAWP_ACCESS_TOKEN
} = process.env;

if (!WAWP_INSTANCE_ID || !WAWP_ACCESS_TOKEN) {
  console.error("❌ ENV eksik: WAWP_INSTANCE_ID / WAWP_ACCESS_TOKEN");
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
   KEEP-ALIVE (1 dk)
======================= */
async function keepOnline() {
  try {
    const r = await axios.post(
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
      "status:", r.status,
      "data:", typeof r.data === "string" ? r.data : JSON.stringify(r.data)
    );
  } catch (e) {
    const status = e.response?.status;
    const data = e.response?.data;
    console.error("🔴 KEEP-ALIVE FAIL",
      "status:", status,
      "data:", data ? (typeof data === "string" ? data : JSON.stringify(data)) : "",
      "msg:", e.message
    );
  }
}

// başlangıçta 1 kez + her 60 sn
keepOnline();
setInterval(keepOnline, 60 * 1000);

/* =======================
   WEBHOOK DEBUG
======================= */
app.post("/webhook", (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  console.log("========================================");
  console.log("🚀 WEBHOOK GELDİ");
  console.log("🕒 TIME:", new Date().toISOString());
  console.log("🌍 IP:", ip);
  console.log("📦 HEADERS:");
  console.log(JSON.stringify(req.headers, null, 2));
  console.log("📄 RAW BODY:");
  console.log(req.rawBody);
  console.log("📄 PARSED BODY:");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("========================================");

  res.sendStatus(200);
});

// hızlı test için
app.get("/", (_, res) => {
  res.send("DEBUG mode aktif. /webhook dinleniyor.");
});

app.listen(PORT, () => {
  console.log(`✅ DEBUG server aktif. Port: ${PORT}`);
});
