const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");
const { DateTime } = require("luxon");

const app = express();
app.use(express.json());

/* =======================
   ENV
======================= */
const {
  DATABASE_URL,
  TG_TOKEN,
  TG_CHAT_ID,
  TARGET_WA,
  TIMEZONE = "Europe/Istanbul",
  PORT = 3000
} = process.env;

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
      wa_id TEXT PRIMARY KEY,
      is_online BOOLEAN NOT NULL,
      online_at TIMESTAMP,
      telegram_message_id BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      wa_id TEXT NOT NULL,
      online_at TIMESTAMP NOT NULL,
      offline_at TIMESTAMP,
      duration_minutes INTEGER,
      telegram_message_id BIGINT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

/* =======================
   TIME (ISTANBUL)
======================= */
function now() {
  return DateTime.now().setZone(TIMEZONE).toJSDate();
}

function format(date) {
  return DateTime
    .fromJSDate(date)
    .setZone(TIMEZONE)
    .toFormat("HH:mm");
}

function diffMinutes(start, end) {
  return Math.floor((end - start) / 60000);
}

/* =======================
   TELEGRAM
======================= */
const TG_BASE = () =>
  `https://api.telegram.org/bot${TG_TOKEN}`;

async function tgSend(text) {
  const r = await axios.post(`${TG_BASE()}/sendMessage`, {
    chat_id: TG_CHAT_ID,
    text
  });
  return r.data.result.message_id;
}

async function tgEdit(messageId, text) {
  await axios.post(`${TG_BASE()}/editMessageText`, {
    chat_id: TG_CHAT_ID,
    message_id: messageId,
    text
  });
}

/* =======================
   INIT
======================= */
initDB()
  .then(() => console.log("DB hazır"))
  .catch(console.error);

/* =======================
   WEBHOOK
======================= */
app.post("/webhook", async (req, res) => {
  try {
    const presence = req.body?.payload?.presences?.[0];
    if (!presence) return res.sendStatus(200);

    if (presence.participant !== TARGET_WA)
      return res.sendStatus(200);

    const currentTime = now();

    const { rows } = await pool.query(
      "SELECT * FROM state WHERE wa_id=$1",
      [presence.participant]
    );

    const state = rows[0] || { is_online: false };

    /* 🟢 ONLINE */
    if (presence.lastKnownPresence === "online" && !state.is_online) {
      const messageId = await tgSend(
        `🟢 ÇEVRİM İÇİ\n🕒 ${format(currentTime)}`
      );

      await pool.query(
        `
        INSERT INTO state (wa_id,is_online,online_at,telegram_message_id)
        VALUES ($1,true,$2,$3)
        ON CONFLICT (wa_id)
        DO UPDATE SET
          is_online=true,
          online_at=$2,
          telegram_message_id=$3
        `,
        [presence.participant, currentTime, messageId]
      );

      await pool.query(
        `
        INSERT INTO sessions (wa_id, online_at, telegram_message_id)
        VALUES ($1,$2,$3)
        `,
        [presence.participant, currentTime, messageId]
      );
    }

    /* 🔴 OFFLINE */
    if (presence.lastKnownPresence === "offline" && state.is_online) {
      const minutes = diffMinutes(state.online_at, currentTime);

      await tgEdit(
        state.telegram_message_id,
        `🔴 ÇEVRİM DIŞI (3)

🟢 ${format(state.online_at)}
🔴 ${format(currentTime)}
⏱ ${minutes} dk`
      );

      await pool.query(
        `
        UPDATE sessions
        SET offline_at=$1, duration_minutes=$2
        WHERE telegram_message_id=$3
        `,
        [currentTime, minutes, state.telegram_message_id]
      );

      await pool.query(
        `
        UPDATE state
        SET is_online=false,
            online_at=NULL,
            telegram_message_id=NULL
        WHERE wa_id=$1
        `,
        [presence.participant]
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

/* =======================
   START
======================= */
app.listen(PORT, () =>
  console.log(`Webhook aktif :${PORT}`)
);
