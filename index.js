const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");
const { DateTime } = require("luxon");

/* =======================
   ENV
======================= */
const {
  PORT = 3000,
  WAWP_INSTANCE_ID,
  WAWP_ACCESS_TOKEN,
  TARGET_LID,
  DATABASE_URL,
  TIMEZONE = "Europe/Istanbul"
} = process.env;

if (!WAWP_INSTANCE_ID || !WAWP_ACCESS_TOKEN || !TARGET_LID || !DATABASE_URL) {
  console.error("❌ ENV eksik");
  process.exit(1);
}

/* =======================
   APP
======================= */
const app = express();
app.use(express.json());

/* =======================
   DB (SIFIRDAN)
======================= */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function resetDB() {
  console.log("🧨 DB RESET başlıyor...");

  await pool.query(`DROP TABLE IF EXISTS sessions;`);
  await pool.query(`DROP TABLE IF EXISTS state;`);

  await pool.query(`
    CREATE TABLE state (
      lid TEXT PRIMARY KEY,
      is_online BOOLEAN NOT NULL,
      online_at TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE sessions (
      id SERIAL PRIMARY KEY,
      lid TEXT NOT NULL,
      online_at TIMESTAMP NOT NULL,
      offline_at TIMESTAMP,
      duration_minutes INTEGER
    );
  `);

  console.log("✅ DB sıfırdan oluşturuldu");
}

resetDB().catch(err => {
  console.error("❌ DB RESET HATA:", err);
  process.exit(1);
});

/* =======================
   TIME
======================= */
const now = () => DateTime.now().setZone(TIMEZONE).toJSDate();
const diffMin = (a, b) => Math.floor((b - a) / 60000);

/* =======================
   WAWP ONLINE KEEP ALIVE
======================= */
async function keepOnline() {
  try {
    await axios.post(
      "https://wawp.net/wp-json/awp/v1/presence",
      null,
      {
        params: {
          instance_id: WAWP_INSTANCE_ID,
          access_token: WAWP_ACCESS_TOKEN,
          presence: "online"
        }
      }
    );
    console.log("🟢 WAWP keep-alive online");
  } catch (e) {
    console.error("❌ keep-alive hata:", e.message);
  }
}

// HER 25 SANİYE
setInterval(keepOnline, 120 * 1000);
keepOnline();

/* =======================
   WEBHOOK
======================= */
app.post("/webhook", async (req, res) => {
  try {
    const presence = req.body?.payload?.presences?.[0];
    if (!presence) return res.sendStatus(200);

    const { participant, lastKnownPresence } = presence;
    if (participant !== TARGET_LID) return res.sendStatus(200);

    const isOnline = ["online", "typing", "recording"].includes(lastKnownPresence);
    const isOffline = lastKnownPresence === "offline";
    const t = now();

    const { rows } = await pool.query(
      "SELECT * FROM state WHERE lid=$1",
      [TARGET_LID]
    );

    const state = rows[0];

    // 🟢 ONLINE (ilk giriş)
    if (isOnline && !state) {
      await pool.query(
        "INSERT INTO state (lid,is_online,online_at) VALUES ($1,true,$2)",
        [TARGET_LID, t]
      );

      await pool.query(
        "INSERT INTO sessions (lid,online_at) VALUES ($1,$2)",
        [TARGET_LID, t]
      );

      console.log("🟢 ONLINE BAŞLADI:", TARGET_LID);
    }

    // 🔴 OFFLINE
    if (isOffline && state?.is_online) {
      const mins = diffMin(state.online_at, t);

      await pool.query(
        "UPDATE sessions SET offline_at=$1, duration_minutes=$2 WHERE lid=$3 AND offline_at IS NULL",
        [t, mins, TARGET_LID]
      );

      await pool.query(
        "DELETE FROM state WHERE lid=$1",
        [TARGET_LID]
      );

      console.log("🔴 OFFLINE BİTTİ:", TARGET_LID, mins, "dk");
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ WEBHOOK HATA:", e);
    res.sendStatus(500);
  }
});

/* =======================
   HEALTH
======================= */
app.get("/", (_, res) => {
  res.send("SIFIRDAN LID TAKİP SİSTEMİ AKTİF");
});

app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda`);
});
