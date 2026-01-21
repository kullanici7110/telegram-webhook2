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
  TG_TOKEN,
  TG_CHAT_ID,
  DATABASE_URL,
  TIMEZONE = "Europe/Istanbul"
} = process.env;

if (
  !WAWP_INSTANCE_ID ||
  !WAWP_ACCESS_TOKEN ||
  !TARGET_LID ||
  !TG_TOKEN ||
  !TG_CHAT_ID ||
  !DATABASE_URL
) {
  console.error("❌ ENV eksik");
  process.exit(1);
}

/* =======================
   APP
======================= */
const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

/* =======================
   DB
======================= */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS state (
      lid TEXT PRIMARY KEY,
      is_online BOOLEAN NOT NULL,
      online_at TIMESTAMP,
      telegram_message_id BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      lid TEXT NOT NULL,
      online_at TIMESTAMP NOT NULL,
      offline_at TIMESTAMP,
      duration_minutes INTEGER,
      telegram_message_id BIGINT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("✅ DB hazır");
}
initDB().catch(console.error);

/* =======================
   TIME
======================= */
const now = () => DateTime.now().setZone(TIMEZONE).toJSDate();
const fmt = d => DateTime.fromJSDate(d).setZone(TIMEZONE).toFormat("HH:mm");
const diffMin = (a, b) => Math.floor((b - a) / 60000);

/* =======================
   TELEGRAM
======================= */
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

async function tgSend(text) {
  const r = await axios.post(`${TG_API}/sendMessage`, {
    chat_id: TG_CHAT_ID,
    text
  });
  return r.data.result.message_id;
}

async function tgEdit(mid, text) {
  await axios.post(`${TG_API}/editMessageText`, {
    chat_id: TG_CHAT_ID,
    message_id: mid,
    text
  });
}

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
    console.log("🟢 WAWP ONLINE keep-alive");
  } catch (e) {
    console.error("❌ WAWP keep-alive hata:", e.message);
  }
}

// HER 25 SANİYE
setInterval(keepOnline, 25 * 1000);

// İlk açılışta da çalıştır
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

    const state = rows[0] || { is_online: false };

    // 🟢 ONLINE
    if (isOnline && !state.is_online) {
      const mid = await tgSend(
        `🟢 ONLINE\n🆔 ${TARGET_LID}\n🕒 ${fmt(t)}`
      );

      await pool.query(`
        INSERT INTO state (lid,is_online,online_at,telegram_message_id)
        VALUES ($1,true,$2,$3)
        ON CONFLICT (lid)
        DO UPDATE SET is_online=true,online_at=$2,telegram_message_id=$3
      `, [TARGET_LID, t, mid]);

      await pool.query(`
        INSERT INTO sessions (lid,online_at,telegram_message_id)
        VALUES ($1,$2,$3)
      `, [TARGET_LID, t, mid]);
    }

    // 🔴 OFFLINE
    if (isOffline && state.is_online) {
      const mins = diffMin(state.online_at, t);

      await tgEdit(
        state.telegram_message_id,
        `🔴 OFFLINE\n🆔 ${TARGET_LID}\n\n🟢 ${fmt(state.online_at)}\n🔴 ${fmt(t)}\n⏱ ${mins} dk`
      );

      await pool.query(`
        UPDATE sessions
        SET offline_at=$1, duration_minutes=$2
        WHERE telegram_message_id=$3
      `, [t, mins, state.telegram_message_id]);

      await pool.query(`
        UPDATE state
        SET is_online=false, online_at=NULL, telegram_message_id=NULL
        WHERE lid=$1
      `, [TARGET_LID]);
    }

    console.log("📡 PRESENCE:", lastKnownPresence);
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
  res.send("WAWP LID presence system aktif");
});

app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda`);
});
