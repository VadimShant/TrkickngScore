
    const sheetId = "1DPzHNeUjTGCLCFC1vB9wD4YaJnWLxlF4ayZtO0QH460";
    const apiKey = "AIzaSyCdWNc0szsmhtpSzWpF7JZ3ZsddOq1Xvj4"; 
    const range = "Db!A1:B300";


let trickPoints = {};
let trickNames = [];
let baseTotal = 0;

async function loadTricks() {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`);
  const data = await res.json();

  if (!data.values) {
    alert("Ошибка загрузки трюков из таблицы");
    return;
  }

  data.values.forEach(([name, score]) => {
    if (!name || !score) return;
    const trick = name.trim().toLowerCase();
    trickPoints[trick] = parseFloat(score);
    trickNames.push(trick);
  });
}

function updateScore() {
  const input = document.getElementById("trickInput").value;
  const tricks = input.split(",").map(t => t.trim().toLowerCase());
  let total = 0;

  tricks.forEach(trick => {
    if (trickPoints[trick] != null) {
      total += trickPoints[trick];
    }
  });

  baseTotal = total;
  const execution = parseFloat(document.getElementById("myRange").value);
  const finalScore = (baseTotal * execution).toFixed(2);

  document.getElementById("score").textContent = `${finalScore}`;
  document.getElementById("demo").textContent = execution.toFixed(2); // отобразить значение слайдера

  const fire = document.querySelector(".fire-background");
  if (total >= 20) {
    let intensity = Math.min((total - 20) / 80, 1);
    fire.style.opacity = intensity;
    fire.style.transform = `translate(-50%, -50%) scale(${1 + intensity * 0.5})`;
  } else {
    fire.style.opacity = 0;
  }
}

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

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

window.addEventListener("DOMContentLoaded", () => {
  loadTricks();
  document.querySelectorAll("textarea").forEach(autoResize);
  updateScore(); // при загрузке сразу посчитать
});

// Настройка слайдера
document.addEventListener("DOMContentLoaded", () => {
  const slider = document.getElementById("myRange");
  slider.addEventListener("input", () => {
    updateScore(); // пересчёт при изменении слайдера
  });
});

