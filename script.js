  const sheetId = "1DPzHNeUjTGCLCFC1vB9wD4YaJnWLxlF4ayZtO0QH460";
    const apiKey = "AIzaSyCdWNc0szsmhtpSzWpF7JZ3ZsddOq1Xvj4"; 

const ranges = {
  basic: "Basic!A2:B300",
  variation: "Variation!A2:B300",
  hard: "Hard!A2:B300"
};

// === хранилища ===
let trickPoints = {};    // name -> base score
let trickSource = {};    // name -> "basic" | "variation" | "hard"
let trickNames = [];     // для автодополнения
let baseTotal = 0;

// === загрузка всех трюков из трёх таблиц ===
async function fetchRange(range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.values || [];
}

function populateTricks(rows, source) {
  rows.forEach(([name, score]) => {
    if (!name) return;
    const key = name.trim().toLowerCase();
    const val = parseFloat(score);
    if (isNaN(val)) return;
    trickPoints[key] = val;
    trickSource[key] = source;
    if (!trickNames.includes(key)) trickNames.push(key);
  });
}

async function loadTricks() {
  try {
    const [basicData, variationData, hardData] = await Promise.all([
      fetchRange(ranges.basic),
      fetchRange(ranges.variation),
      fetchRange(ranges.hard)
    ]);
    populateTricks(basicData, "basic");
    populateTricks(variationData, "variation");
    populateTricks(hardData, "hard");
  } catch (e) {
    console.error("Ошибка при загрузке трюков:", e);
    alert("Ошибка загрузки трюков из таблиц");
  }
}

// === построение массива трюков с метаданными ===
function buildTrickArray(inputStr) {
  const partsRaw = inputStr
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  // Убираем подряд идущие дубликаты
  const parts = [];
  for (let i = 0; i < partsRaw.length; i++) {
    if (i === 0 || partsRaw[i] !== partsRaw[i - 1]) {
      parts.push(partsRaw[i]);
    }
  }

  return parts.map((name, idx) => ({
    name,
    position: idx,
    baseScore: trickPoints[name] != null ? trickPoints[name] : 0,
    source: trickSource[name] || "basic",
    modifiedScore: null
  }));
}


function applyModifiers(tricks) {
  const len = tricks.length;

  // Промежуточный лог: входные данные
  console.groupCollapsed("Modifiers input");
  console.log(tricks.map(t => ({
    name: t.name,
    source: t.source,
    baseScore: t.baseScore,
    position: t.position
  })));
  console.groupEnd();

  // 1. hard во второй половине
  tricks.forEach(t => {
    if (len > 4){
    if (t.source === "hard" && t.position > len / 2) {
      t.modifiedScore = (t.modifiedScore ?? t.baseScore) * 1.35;
      t._log = t._log || [];
      t._log.push(`hard second half ×1.35 => ${t.modifiedScore.toFixed(2)}`);
    }
  }
});

  // 2. hard -> variation
  for (let i = 0; i < tricks.length - 1; i++) {
    const cur = tricks[i];
    const next = tricks[i + 1];
    if (cur.source === "hard" && next && next.source === "variation") {
      const before = (cur.modifiedScore != null ? cur.modifiedScore : cur.baseScore);
      cur.modifiedScore = before * 1.35;
      cur._log = cur._log || [];
      cur._log.push(`hard→variation transition ×1.45 (was ${before.toFixed(2)}) => ${cur.modifiedScore.toFixed(2)}`);
    }
  }

  // 3. starter (basic или hard) + >=2 variation подряд: весь сегмент умножается
  for (let i = 0; i < tricks.length; i++) {
    const starter = tricks[i];
    if (starter.source !== "basic" && starter.source !== "hard") continue;

    let j = i + 1;
    const segment = [starter];
    while (j < tricks.length && tricks[j].source === "variation") {
      segment.push(tricks[j]);
      j++;
    }

    if (segment.length >= 3) { // starter + минимум 2 variation
      const segmentBaseSum = segment.reduce((sum, t) => sum + t.baseScore, 0);
      const multiplier = starter.source === "basic" ? 1.25 : 1.50;
      const segmentTotal = segmentBaseSum * multiplier;
      const bonusTotal = segmentTotal - segmentBaseSum;

      if (segmentBaseSum > 0) {
        segment.forEach(t => {
          const share = (t.baseScore / segmentBaseSum) * bonusTotal;
          const baseUsed = (t.modifiedScore != null ? t.modifiedScore : t.baseScore);
          const newScore = baseUsed + share;
          t.modifiedScore = newScore;
          t._log = t._log || [];
          t._log.push(
            `variation chain (${starter.name}+variations) share +${share.toFixed(2)}, now ${t.modifiedScore.toFixed(2)}`
          );
        });
      }
    }
  }

// 4. repeat penalty для подряд идущих одинаковых basic или variation трюков (2-й и далее): каждый следующий = предыдущий * 0.8
for (let i = 0; i < tricks.length; i++) {
  const cur = tricks[i];
  if (!(cur.source === "basic" || cur.source === "variation")) continue;

  const prev = tricks[i - 1];
  if (prev && prev.name === cur.name && (prev.source === cur.source)) {
    const prevEffective = prev.modifiedScore != null ? prev.modifiedScore : prev.baseScore;
    const penaltyFactor = 0.8; // или 0.7 если хочешь сильнее
    cur.modifiedScore = prevEffective * penaltyFactor;
    cur._log = cur._log || [];
    cur._log.push(
      `repeat ${cur.source} devalue: previous ${prevEffective.toFixed(2)} → current ${cur.modifiedScore.toFixed(2)} (×${penaltyFactor})`
    );
  }
}

// 4.5. devalue перехода между повторяющимися basic/variation: pattern A -> X -> A
// repeat penalty: basic или variation подряд — 2-й и далее берут предыдущий * 0.8 (накопительно)
for (let i = 1; i < tricks.length; i++) {
  const cur = tricks[i];
  const prev = tricks[i - 2];
  if (!prev) continue;

  // только same source (basic или variation) и одинаковое имя подряд
  if (
    (cur.source === "basic" || cur.source === "variation") &&
    cur.name === prev.name &&
    cur.source === prev.source
  ) {
    const prevEffective = prev.modifiedScore != null ? prev.modifiedScore : prev.baseScore;
    const penaltyFactor = 0.6;
    cur.modifiedScore = prevEffective * penaltyFactor;
    cur._log = cur._log || [];
    cur._log.push(
      `repeat ${cur.source} devalue cumulative: previous ${prevEffective.toFixed(2)} → current ${cur.modifiedScore.toFixed(2)} (×${penaltyFactor})`
    );
  }
}


  // Финал: если не было модификации, ставим baseScore
  tricks.forEach(t => {
    if (t.modifiedScore == null) {
      t.modifiedScore = t.baseScore;
      t._log = t._log || [];
      t._log.push(`no modifier, use base ${t.baseScore.toFixed(2)}`);
    }
  });

  // Разбор по каждому трюку
  console.groupCollapsed("Modifiers breakdown");
  tricks.forEach(t => {
    console.log(
      `${t.name} modified=${t.modifiedScore.toFixed(2)}`,
      t._log || []
    );
    
  });
  console.groupEnd();
}



// === основная логика обновления счёта ===
function updateScore() {
  const input = document.getElementById("trickInput").value;
  const tricksArray = buildTrickArray(input); // уже в твоём коде

  // применяем правила модификации
  applyModifiers(tricksArray);

  // собираем разбивку для логов
  const breakdownParts = tricksArray.map(t => {
    const base = t.baseScore;
    const modified = t.modifiedScore;
    let part = `${t.name}: ${base.toFixed(2)}`;
    if (modified !== base) {
      part += ` → ${modified.toFixed(2)}`; // показано, что изменилось
    }
    return part;
  });

  // считаем baseTotal
  baseTotal = tricksArray.reduce((sum, t) => sum + t.modifiedScore, 0);

  const execution = parseFloat(document.getElementById("myRange").value) || 1;
  const finalScore = baseTotal * execution;

  // Формируем строку-пример вычислений
  const breakdownString = breakdownParts.join(" + ");
  const example = `(${breakdownString}) * ${execution.toFixed(2)} = ${finalScore.toFixed(2)}`;

  // Лог в консоль

  
  document.getElementById("Console").innerHTML = ("Example:", example);
  console.groupEnd();

  // Вывод в UI
  document.getElementById("score").textContent = finalScore.toFixed(2);
  document.getElementById("demo").textContent = execution.toFixed(2);

  congratulate(finalScore);

  // фон-огонь по baseTotal
  const fireBg = document.querySelector(".fire-background");
  if (baseTotal >= 20) {
    let intensity = Math.min((baseTotal - 20) / 80, 1);
    fireBg.style.opacity = intensity;
    fireBg.style.transform = `translate(-50%, -50%) scale(${1 + intensity * 0.5})`;
  } else {
    fireBg.style.opacity = 0;
  }
}

// === автоподгонка textarea ===
function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// === автодополнение ===
function handleInput() {
  const inputEl = document.getElementById("trickInput");
  const value = inputEl.value;
  const lastTerm = value.split(",").pop().trim().toLowerCase();
  const box = document.getElementById("suggestions");

  if (!lastTerm || lastTerm.length < 1) {
    box.style.display = "none";
    return;
  }

  const matches = trickNames.filter(name => name.startsWith(lastTerm)).slice(0, 10);
  box.innerHTML = "";

  if (matches.length === 0) {
    box.style.display = "none";
    return;
  }

  matches.forEach(match => {
    const div = document.createElement("div");
    div.className = "autocomplete-item";
    div.textContent = match;
    div.onclick = () => {
      const parts = value.split(",");
      parts[parts.length - 1] = ` ${match}`;
      inputEl.value = parts.join(",").trim() + ", ";
      box.style.display = "none";
      updateScore();
    };
    box.appendChild(div);
  });

  const rect = inputEl.getBoundingClientRect();
  box.style.top = rect.bottom + window.scrollY + "px";
  box.style.left = rect.left + window.scrollX + "px";
  box.style.width = rect.width + "px";
  box.style.display = "block";

  updateScore();
}

function handleKey(e) {
  const box = document.getElementById("suggestions");
  if (e.key === "Escape") box.style.display = "none";
}

// === инициализация ===
window.addEventListener("DOMContentLoaded", () => {
  loadTricks();
  document.querySelectorAll("textarea").forEach(autoResize);
  updateScore(); // начальный расчёт
  // слайдер
  const slider = document.getElementById("myRange");
  if (slider) {
    slider.addEventListener("input", updateScore);
  }
  // ввод
  const inputEl = document.getElementById("trickInput");
  if (inputEl) {
    inputEl.addEventListener("input", () => {
      handleInput();
      updateScore();
    });
    inputEl.addEventListener("keydown", handleKey);
  }
});

// === существующие вспомогательные функции — оставлены как есть ===
function congratulate(score) {
  const fire = document.getElementById("fire");
  if (!fire) return;

  if (score < 50) {
    fire.style.opacity = 0; // скрыть огонь при низком счёте
    return;
  } else if (score >= 50 && score < 100) {
    fire.style.opacity = 0.3;
  } else if (score >= 100 && score < 200) {
    fire.style.opacity = 0.9;
  }
  let maxOpacity = 0.8;
  let opacity = Math.min(score / 300, 1) * maxOpacity;
  fire.style.opacity = opacity;
}

function showSupport() {
  const el = document.querySelector('.support-card');
  if (!el) {
    console.error("Support card not found");
    return;
  }
  if (el.style.display === "none" || getComputedStyle(el).display === "none") {
    el.style.display = "block";
  } else {
    el.style.display = "none";
  }
}

// console position on phone
function checkFlexDirection() {
    if (window.innerWidth < 1000) {
      calculateconsole.style.flexDirection = 'column';
    } else {
      calculateconsole.style.flexDirection = 'row';
    }
  }


 
  const supportCard = document.querySelector('.support-card');
  const supportBtn = document.querySelector('.support-btn');
  const backBtn = document.querySelector('.back-btn');

  supportBtn.addEventListener('click', () => {
    supportCard.classList.add('flipped');
  });

  backBtn.addEventListener('click', () => {
    supportCard.classList.remove('flipped');
  });


  document.querySelector('.add-trick').addEventListener('click', () => {
    const email = "lophineorganic@gmail.com"; // куда отправлять
    const subject = encodeURIComponent("+ Add trick request");
    const body = encodeURIComponent(
`Please fill in the following fields and send back:

Trick name: ___________________
Transition: ___________________
Variation(s): _________________
Execution quality (0-10): ______
`
    );

    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
});

document.querySelector('.appeal').addEventListener('click', () => {
    const email = "lophineorganic@gmail.com"; // куда отправлять
    const subject = encodeURIComponent("Appeal: name, score");
    const body = encodeURIComponent(
`Please provide the details for your appeal:

Your Name: ___________________
Trick Name: __________________
Score you appeal: ____________
Reason: ______________________
`
    );

    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
});


  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');

  burger.addEventListener('click', () => {
    nav.classList.toggle('active');
  });

