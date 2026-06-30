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

// ───────────────────────────────────────────────────────────────
// תובנות לכל משחק חי: רשימה של { type, label, emoji, text } להצגה.
// כל תובנה רלוונטית למשחק יחיד וניתן לרנדר אותה ישירות בלי לוגיקה בלקוח.
function computeGameInsights(liveGame, rows) {
  const gid = liveGame.gameID;
  const team1 = liveGame.competitors?.[0]?.name || "";
  const team2 = liveGame.competitors?.[1]?.name || "";
  const realT1 = liveGame.scores?.team1;
  const realT2 = liveGame.scores?.team2;
  const minute = parseInt(String(liveGame.gtd || "").replace(/\D/g, ""), 10);
  const lateGame = Number.isFinite(minute) && minute >= 80;

  // אסוף את כל הניחושים של השחקנים למשחק הזה
  const bets = [];
  for (const r of rows) {
    const b = r.gameBets?.[gid];
    if (!b || b.t1 == null || b.t2 == null) continue;
    bets.push({ name: r.name, t1: b.t1, t2: b.t2 });
  }
  if (!bets.length) return [];

  const insights = [];
  const key = (b) => `${b.t1}-${b.t2}`;

  // 1) בנדוואגון ("שיבוטים") — הניחוש הנפוץ ביותר אם 3+ שחקנים בחרו בו
  const counts = new Map();
  for (const b of bets) {
    const k = key(b);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let topKey = null, topCount = 0;
  for (const [k, c] of counts) {
    if (c > topCount) { topKey = k; topCount = c; }
  }
  if (topCount >= 3) {
    const [t1, t2] = topKey.split("-").map(Number);
    const winnerTeam = t1 > t2 ? team1 : t2 > t1 ? team2 : null;
    const tail = winnerTeam ? `ל${winnerTeam}` : "לתיקו";
    insights.push({
      type: "bandwagon",
      label: "שיבוטים",
      emoji: "🐑",
      text: `${topCount} שיבוטים הימרו על ${t1}–${t2} ${tail}`,
    });
  }

  // 2) הזאב הבודד — שחקנים עם ניחוש ייחודי (אין אחרים שבחרו בדיוק אותו)
  const lonely = bets.filter((b) => counts.get(key(b)) === 1);
  if (lonely.length === 1) {
    const b = lonely[0];
    const winnerTeam = b.t1 > b.t2 ? team1 : b.t2 > b.t1 ? team2 : null;
    const tail = winnerTeam ? `ל${winnerTeam}` : "לתיקו";
    insights.push({
      type: "lone-wolf",
      label: "הזאב הבודד",
      emoji: "🐺",
      text: `${b.name} היחיד שהלך על ${b.t1}–${b.t2} ${tail}`,
    });
  } else if (lonely.length > 1 && lonely.length <= 4) {
    const parts = lonely.map((b) => `${b.name} (${b.t1}–${b.t2})`).join(", ");
    insights.push({
      type: "lone-wolf",
      label: "הזאב הבודד",
      emoji: "🐺",
      text: `${parts} עם הימור שונה מהאחרים`,
    });
  }

  // 3) קרחת או תלתלים — הניחוש עם הכי הרבה גולים (מינימום 4)
  const maxGoals = Math.max(...bets.map((b) => b.t1 + b.t2));
  if (maxGoals >= 4) {
    const wildest = bets.filter((b) => b.t1 + b.t2 === maxGoals);
    if (wildest.length === 1) {
      const b = wildest[0];
      insights.push({
        type: "wild",
        label: "קרחת או תלתלים",
        emoji: "💇",
        text: `${b.name} הולך על כל הקופה — ${b.t1}–${b.t2}`,
      });
    } else if (wildest.length <= 3) {
      const names = wildest.map((b) => b.name).join(", ");
      insights.push({
        type: "wild",
        label: "קרחת או תלתלים",
        emoji: "💇",
        text: `${names} הולכים על כל הקופה (${maxGoals} גולים)`,
      });
    }
  }

  // 4) מתפלל שייגמר כבר — הניחוש זהה לתוצאה הנוכחית
  if (Number.isFinite(realT1) && Number.isFinite(realT2)) {
    const onTarget = bets.filter((b) => b.t1 === realT1 && b.t2 === realT2);
    if (onTarget.length >= 1 && onTarget.length <= 5) {
      const names = onTarget.map((b) => b.name).join(", ");
      const verb = onTarget.length === 1 ? "מתפלל" : "מתפללים";
      insights.push({
        type: "praying",
        label: "מתפלל שייגמר כבר",
        emoji: "🙏",
        text: `${names} ${verb} שייגמר כבר`,
      });
    }
  }

  // 5) אוכל מאחורה — ניחש את התוצאה בדיוק, אבל הקבוצות הפוכות (ולא תיקו)
  if (Number.isFinite(realT1) && Number.isFinite(realT2) && realT1 !== realT2) {
    const flipped = bets.filter((b) => b.t1 === realT2 && b.t2 === realT1);
    if (flipped.length >= 1 && flipped.length <= 4) {
      const names = flipped.map((b) => b.name).join(", ");
      const verb = flipped.length === 1 ? "פגע" : "פגעו";
      insights.push({
        type: "backwards",
        label: "אוכל מאחורה",
        emoji: "🙃",
        text: `${names} ${verb} בול — רק הפוך`,
      });
    }
  }

  // 6) גבירותי ורבותיי מהפך — שחקן שעוקף או על סף עקיפה בזכות המשחק החי הזה
  // הניקוד "לפני המשחק" מחושב ע"י הפחתת נקודות המשחק מהסה"כ של כל שחקן
  if (rows.length >= 2) {
    const pre = (r) => r.total - (r.gameBets?.[gid]?.points ?? 0);
    const currentLeader = rows[0];
    const preLeader = [...rows].sort((a, b) => pre(b) - pre(a))[0];

    if (preLeader.name !== currentLeader.name) {
      // עקיפה כבר התרחשה בזכות המשחק
      insights.push({
        type: "comeback",
        label: "גבירותי ורבותיי מהפך",
        emoji: "👑",
        text: `${currentLeader.name} עקף למקום הראשון`,
      });
    } else {
      // אין עקיפה עדיין — נחפש מי קרוב לעקוף בזכות נקודות מהמשחק
      const challenger = rows.slice(1).find((r) => {
        const currentGap = currentLeader.total - r.total;
        const preGap = pre(currentLeader) - pre(r);
        // הפער נסגר בזכות המשחק והגיע למרחק עקיפה
        return currentGap >= 0 && currentGap <= 3 && preGap > currentGap;
      });
      if (challenger) {
        insights.push({
          type: "comeback",
          label: "גבירותי ורבותיי מהפך",
          emoji: "👑",
          text: `${challenger.name} בדרך למקום הראשון`,
        });
      }
    }
  }

  // 5) משעמם — שחקנים שניחשו 0–0 (ואין להם כבר התאמה לתוצאה הנוכחית)
  const boring = bets.filter((b) =>
    b.t1 === 0 && b.t2 === 0 && !(realT1 === 0 && realT2 === 0)
  );
  if (boring.length === 1) {
    insights.push({
      type: "boring",
      label: "0–0",
      emoji: "😴",
      text: `${boring[0].name}, הימור משעמם כמוהו`,
    });
  } else if (boring.length > 1 && boring.length <= 4) {
    const names = boring.map((b) => b.name).join(", ");
    insights.push({
      type: "boring",
      label: "0–0",
      emoji: "😴",
      text: `${names} — הימור משעמם כמוהם`,
    });
  }

  // 5) גול אחד מהבול — הניחוש במרחק גול אחד מהתוצאה הנוכחית בכיוון הנכון
  if (Number.isFinite(realT1) && Number.isFinite(realT2)) {
    const oneAway = bets.filter((b) => {
      const d1 = b.t1 - realT1;
      const d2 = b.t2 - realT2;
      // צריך עוד גול אחד בדיוק לאחת הקבוצות, השנייה כבר תואמת
      return (d1 === 1 && d2 === 0) || (d1 === 0 && d2 === 1);
    });
    if (oneAway.length >= 1 && oneAway.length <= 4) {
      const names = oneAway.map((b) => `${b.name} (${b.t1}–${b.t2})`).join(", ");
      insights.push({
        type: "close",
        label: "גול אחד מהבול",
        emoji: "🎯",
        text: `${names}`,
      });
    }
  }

  // 6) יכולים ללכת לים — ניחושים שכבר בלתי אפשריים מתמטית (משחק קרוב לסיום + אי-התאמה)
  if (lateGame && Number.isFinite(realT1) && Number.isFinite(realT2)) {
    const busted = bets.filter((b) => b.t1 < realT1 || b.t2 < realT2);
    if (busted.length >= 2 && busted.length <= 5) {
      const names = busted.map((b) => b.name).join(", ");
      insights.push({
        type: "beach",
        label: "יכולים ללכת לים",
        emoji: "🏖️",
        text: `${names} — הניחוש כבר לא רלוונטי`,
      });
    }
  }

  return insights;
}

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

        // ניחושים למשחקים החיים, לפי gameID
        const gameBets = {};
        if (Array.isArray(m.gameBets)) {
          for (const b of m.gameBets) {
            if (b?.gameID == null) continue;
            gameBets[b.gameID] = {
              t1: b.selection?.team1 ?? null,
              t2: b.selection?.team2 ?? null,
              points: b.gainedPoints ?? 0,
              outcome: b.betOutcome ?? 0, // 3=מדויק, 2=כיוון, 0=פספוס
            };
          }
        }
        // first/legacy bet for backwards compat
        const gameBet = m.gameBets?.[0]
          ? gameBets[m.gameBets[0].gameID]
          : null;

        const rawImage = (m.imageURL || "").trim();
        const isStockImage = !rawImage || /b330ca52cb7c4f98bd685f5732e00a91/.test(rawImage);
        return {
          name,
          imageURL: isStockImage ? null : rawImage,
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
          gameBets,
          isNew: !known,
        };
      })
      .sort((a, b) => b.total - a.total || b.current - a.current);

    // משחקים חיים כרגע
    const liveGamesRaw = Array.isArray(data?.liveGames) ? data.liveGames : [];
    const liveGames = liveGamesRaw.map((g) => ({
      gameID: g.gameID,
      team1: g.competitors?.[0]?.name || "",
      team2: g.competitors?.[1]?.name || "",
      score1: g.scores?.team1 ?? null,
      score2: g.scores?.team2 ?? null,
      minute: g.gtd || "",
      insights: computeGameInsights(g, rows),
    }));
    const hasLiveGame = liveGames.length > 0;

    res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      groupName: data?.table?.name || "",
      actualWinner: ACTUAL_WINNER,
      actualScorer: ACTUAL_SCORER,
      bonusPoints: BONUS_POINTS,
      decided: ACTUAL_WINNER !== null || ACTUAL_SCORER !== null,
      hasLiveGame,
      liveGames,
      rows,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err) });
  }
}
