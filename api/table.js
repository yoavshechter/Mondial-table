// פונקציית שרת (Vercel Serverless Function).
// מושכת את טבלת הדירוג מ-365scores, עוקפת את חסם ה-CORS,
// מחברת את התוספת הקבועה לכל שחקן, וממיינת לפי הסכום.
//
// נגישה בכתובת: /api/table

const GROUP_ID = 39350;
const API_URL = `https://wcg-il.365scores.com/Groups/GetGroupTable?lang=2&groupID=${GROUP_ID}`;

// התוספת הקבועה לכל שחקן, לפי userID (מזהה קבוע שלא משתנה גם אם השם מתעדכן).
// כדי לעדכן תוספת — שנה כאן את המספר. כדי להוסיף שחקן חדש — הוסף שורה עם ה-userID שלו.
const ADDITIONS = {
  216719: { name: "אלדר", add: 7 },   // אלדר אברג'יל
  200553: { name: "לרנר", add: 1 },   // רועי לרנר
  200889: { name: "הרוש", add: 1 },   // Or Harush
  201205: { name: "גינגי", add: 3 },  // Agamis
  202594: { name: "עומר", add: 1 },   // עומר
  200580: { name: "שון", add: 1 },    // Sean Siegel
  201283: { name: "טל", add: 1 },     // Tal Goldshtein
  203335: { name: "טום", add: 0 },    // TOM YEFET
  202324: { name: "אדיר", add: 1 },   // Adir
  200768: { name: "רועי", add: 3 },   // Roi Weimberg
  203042: { name: "אוהד", add: 3 },   // אוהד סדן
  203270: { name: "אלמוג", add: 3 },  // Almog
  201658: { name: "שגיא", add: 1 },   // Sagi Shaked
  202265: { name: "נוי", add: 1 },    // Noy Barak
  203943: { name: "ליאור", add: 0 },  // Lior Shaller
  200508: { name: "יואב", add: 3 },   // Yoav Shechter
};

// ───────────────────────────────────────────────────────────────
// ניחושי "נבחרת זוכה" ו"מלך שערים" של כל שחקן (לפי userID).
// נקבעים מראש ולא משתנים. כל ניחוש נכון שווה BONUS_POINTS בסוף הטורניר.
const PREDICTIONS = {
  201205: { winner: "ספרד", scorer: "אמבפה" },   // גינגי
  200508: { winner: "ברזיל", scorer: "הארי קיין" }, // יואב
  203042: { winner: "צרפת", scorer: "הארי קיין" }, // אוהד
  200768: { winner: "אנגליה", scorer: "אמבפה" },  // רועי
  203270: { winner: "צרפת", scorer: "אמבפה" },    // אלמוג
  202265: { winner: "ברזיל", scorer: "הארי קיין" }, // נוי
  202324: { winner: "צרפת", scorer: "אמבפה" },    // אדיר
  200553: { winner: "ספרד", scorer: "דמבלה" },    // לרנר
  202594: { winner: "ספרד", scorer: "אמבפה" },    // עומר
  200889: { winner: "צרפת", scorer: "אמבפה" },    // הרוש
  203943: { winner: "ספרד", scorer: "אמבפה" },    // ליאור
  201658: { winner: "ספרד", scorer: "אמבפה" },    // שגיא
  203335: { winner: "ארגנטינה", scorer: "טורס" }, // טום
  200580: { winner: "צרפת", scorer: "הארי קיין" }, // שון
  201283: { winner: "צרפת", scorer: "אמבפה" },    // טל
  216719: { winner: "ספרד", scorer: "אמבפה" },    // אלדר
};

const BONUS_POINTS = 12; // נקודות לכל ניחוש נכון (זוכה / מלך שערים)

// ───────────────────────────────────────────────────────────────
// התוצאה בפועל. עד שהטורניר נגמר — השאר null, וכל הבונוסים יהיו 0.
// בסוף הטורניר: קבע את שם הנבחרת הזוכה ואת שם מלך השערים (בדיוק
// כפי שכתוב למעלה בניחושים — "צרפת", "אמבפה" וכו').
const ACTUAL_WINNER = null; // לדוגמה: "צרפת"
const ACTUAL_SCORER = null; // לדוגמה: "אמבפה"

// שחקנים להתעלם מהם (בוטים)
const IGNORE_IDS = new Set([1]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const upstream = await fetch(API_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!upstream.ok) {
      throw new Error(`365scores returned ${upstream.status}`);
    }
    const data = await upstream.json();
    const members = data?.table?.members || [];

    const rows = members
      .filter((m) => !IGNORE_IDS.has(m.userID))
      .map((m) => {
        // score = ניקוד נעול, liveScore = נקודות מהמשחק החי, totalScore = סכום השניים.
        // משתמשים ב-totalScore כדי לכלול את הלייב (כמו באפליקציה).
        const locked = parseInt(m.score, 10) || 0;
        const live = parseInt(m.liveScore, 10) || 0;
        const current = (m.totalScore != null ? parseInt(m.totalScore, 10) : locked + live) || 0;
        const known = ADDITIONS[m.userID];
        const name = known ? known.name : (m.name || "").trim() + " (חדש!)";
        const add = known ? known.add : 0;

        const pred = PREDICTIONS[m.userID] || { winner: null, scorer: null };
        const winnerHit = ACTUAL_WINNER !== null && pred.winner === ACTUAL_WINNER;
        const scorerHit = ACTUAL_SCORER !== null && pred.scorer === ACTUAL_SCORER;
        const winnerBonus = winnerHit ? BONUS_POINTS : 0;
        const scorerBonus = scorerHit ? BONUS_POINTS : 0;

        const total = current + add + winnerBonus + scorerBonus;

        // ניחוש המשחק הנוכחי (אם יש)
        let gameBet = null;
        if (Array.isArray(m.gameBets) && m.gameBets.length > 0) {
          const b = m.gameBets[0];
          gameBet = {
            t1: b.selection?.team1 ?? null,
            t2: b.selection?.team2 ?? null,
            points: b.gainedPoints ?? 0,
            outcome: b.betOutcome ?? 0, // 3=מדויק, 2=כיוון, 0=פספוס
          };
        }

        return {
          name,
          current,
          locked,
          live,
          add,
          predWinner: pred.winner,
          predScorer: pred.scorer,
          winnerBonus,
          scorerBonus,
          winnerHit,
          scorerHit,
          total,
          gameBet,
          isNew: !known,
        };
      })
      .sort((a, b) => b.total - a.total || b.current - a.current);

    // האם יש משחק חי כרגע (משפיע על תצוגת הלייב)
    const hasLiveGame = Array.isArray(data?.liveGames) && data.liveGames.length > 0;
    const liveGame = hasLiveGame ? data.liveGames[0] : null;
    const live = liveGame
      ? {
          team1: liveGame.competitors?.[0]?.name || "",
          team2: liveGame.competitors?.[1]?.name || "",
          score1: liveGame.scores?.team1 ?? null,
          score2: liveGame.scores?.team2 ?? null,
          minute: liveGame.gtd || "",
        }
      : null;
    const liveLabel = live
      ? `${live.team1} ${live.score1}-${live.score2} ${live.team2} (${live.minute})`
      : null;

    res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      groupName: data?.table?.name || "",
      actualWinner: ACTUAL_WINNER,
      actualScorer: ACTUAL_SCORER,
      bonusPoints: BONUS_POINTS,
      decided: ACTUAL_WINNER !== null || ACTUAL_SCORER !== null,
      hasLiveGame,
      live,
      liveLabel,
      rows,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err) });
  }
}
