require("dotenv").config();
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
  WAWP_POLL_LID,
  DATABASE_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TIMEZONE = "Europe/Istanbul"
} = process.env;

if (
  !WAWP_INSTANCE_ID ||
  !WAWP_ACCESS_TOKEN ||
  !TARGET_LID ||
  !DATABASE_URL ||
  !TELEGRAM_BOT_TOKEN ||
  !TELEGRAM_CHAT_ID
) {
  console.error("❌ ENV eksik");
  process.exit(1);
}

/* =======================
   APP
======================= */
const app = express();
app.use(express.json());

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
      online_at TIMESTAMP NOT NULL,
      telegram_message_id BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      lid TEXT NOT NULL,
      online_at TIMESTAMP NOT NULL,
      offline_at TIMESTAMP,
      duration_minutes INTEGER
    );
  `);

  console.log("✅ DB hazır");
}

initDB().catch(err => {
  console.error("❌ DB HATA:", err);
  process.exit(1);
});

/* =======================
   TIME
======================= */
const now = () => DateTime.now().setZone(TIMEZONE).toJSDate();
const diffMin = (a, b) => Math.floor((b - a) / 60000);

/* =======================
   TELEGRAM
======================= */
const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

async function sendTelegram(text) {
  const res = await axios.post(`${TG_API}/sendMessage`, {
    chat_id: TELEGRAM_CHAT_ID,
    text
  });
  return res.data.result.message_id;
}

async function editTelegram(messageId, text) {
  await axios.post(`${TG_API}/editMessageText`, {
    chat_id: TELEGRAM_CHAT_ID,
    message_id: messageId,
    text
  });
}

/* =======================
   WAWP KEEP ALIVE (1 DK)
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
    console.log("🟢 WAWP keep-alive");
  } catch (e) {
    console.error("❌ keep-alive hata:", e.message);
  }
}

setInterval(keepOnline, 60 * 1000);
keepOnline();

/* =======================
   WAWP GET POLL (20 DK)
======================= */
async function pollPresence() {
  try {
    const res = await axios.get(
      `https://wawp.net/wp-json/awp/v1/presence/${WAWP_POLL_LID}`,
      {
        params: {
          instance_id: WAWP_INSTANCE_ID,
          access_token: WAWP_ACCESS_TOKEN
        }
      }
    );
    console.log("📡 Presence poll OK");
  } catch (e) {
    console.error("❌ Presence poll hata:", e.message);
  }
}

setInterval(pollPresence, 20 * 60 * 1000);
pollPresence();

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

    /* 🟢 ONLINE */
    if (isOnline && !state) {
      const msgId = await sendTelegram("🟢 ÇEVRİM İÇİ");

      await pool.query(
        "INSERT INTO state (lid,is_online,online_at,telegram_message_id) VALUES ($1,true,$2,$3)",
        [TARGET_LID, t, msgId]
      );

      await pool.query(
        "INSERT INTO sessions (lid,online_at) VALUES ($1,$2)",
        [TARGET_LID, t]
      );

      console.log("🟢 ONLINE başladı + Telegram");
    }

    /* 🔴 OFFLINE */
    if (isOffline && state?.is_online) {
      const mins = diffMin(state.online_at, t);

      await editTelegram(
        state.telegram_message_id,
        `🔴 ÇEVRİM DIŞI\n⏱️ ${mins} dakika aktif kaldı`
      );

      await pool.query(
        "UPDATE sessions SET offline_at=$1, duration_minutes=$2 WHERE lid=$3 AND offline_at IS NULL",
        [t, mins, TARGET_LID]
      );

      await pool.query(
        "DELETE FROM state WHERE lid=$1",
        [TARGET_LID]
      );

      console.log("🔴 OFFLINE + Telegram güncellendi");
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
  res.send("LID takip sistemi aktif");
});

app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda`);
});
