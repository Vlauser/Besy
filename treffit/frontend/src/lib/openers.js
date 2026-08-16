/**
 * Подсказки первой фразы.
 *
 *  Чат после совпадения открывается пустым, и это место, где всё чаще
 *  всего и заканчивается: писать «привет» неловко, а придумывать с нуля
 *  лень. При этом мы уже знаем про пару больше, чем они друг про друга, —
 *  общие ответы теста, интересы, общее мероприятие. Из этого и собираем
 *  две-три заготовки.
 *
 *  Формулировки нарочно без прошедшего времени и без обращений по роду:
 *  «заметил(а)» в подсказке выдало бы пол отправителя раньше, чем он сам
 *  захочет, а угадывать его мы не собираемся.
 */

/** Запасные вопросы — когда про человека не известно ничего. */
const NEUTRAL = [
  "Как проходит неделя?",
  "Чем обычно занимаешься по выходным?",
];

const MAX = 3;
// Длиннее этого «о себе» в кнопку не влезает, а обрезанное в подсказке
// выглядит как ошибка, а не как цитата.
const BIO_LIMIT = 60;

/** Вытащить из готового флага тему, о которой можно спросить.
 *
 *  Сервер отдаёт флаги целыми фразами: «Оба выбрали „спонтанность“» и
 *  «Общие интересы: Горы, Кофе». Вставлять их в шаблон как есть нельзя —
 *  получается «У нас обоих в анкете „оба любят горы“», то есть сказанное
 *  дважды. Нужна именно тема, а не предложение вокруг неё.
 */
function topic(flag) {
  const quoted = flag.match(/«([^»]+)»/);
  if (quoted) return { kind: "choice", text: quoted[1].trim() };
  const listed = flag.match(/^\s*общие интересы:\s*(.+)$/i);
  if (listed) return { kind: "interest", text: listed[1].split(",")[0].trim() };
  return { kind: "plain", text: flag.trim() };
}

function fromFlag(flag) {
  const { kind, text } = topic(flag);
  if (!text) return null;
  if (kind === "choice") return { text, line: `Мы оба выбрали «${text}». У тебя это правда так?` };
  if (kind === "interest") return { text, line: `У нас обоих ${text.toLowerCase()}. Давно это у тебя?` };
  return { text, line: `${text} — расскажешь, как так вышло?` };
}

/**
 * @param partner анкета собеседника: interests, shared_flags, event, bio
 * @returns массив строк, готовых подставиться в поле ввода
 */
export function openers(partner = {}) {
  const lines = [];
  // Чего уже коснулись. Нужен, чтобы интерес не повторил тему, названную
  // в общем ответе: «горы» и «Общие интересы: Горы» — это одно и то же.
  const used = [];
  const fresh = (text) =>
    !used.some((seen) => seen.includes(text.toLowerCase()) || text.toLowerCase().includes(seen));
  const take = (text, line) => {
    used.push(text.toLowerCase());
    lines.push(line);
  };

  // Общий ответ теста — самое сильное, что у нас есть: это не догадка, а
  // совпадение, которое мы посчитали.
  for (const flag of partner.shared_flags || []) {
    if (lines.length) break;
    const made = fromFlag(flag);
    if (made) take(made.text, made.line);
  }

  // Общее мероприятие — повод, у которого есть дата.
  if (partner.event?.title) take(partner.event.title, `Ты тоже собираешься на «${partner.event.title}»?`);

  const interest = (partner.interests || []).find((tag) => tag && fresh(tag));
  if (interest) take(interest, `У тебя в анкете «${interest.toLowerCase()}» — это надолго или недавнее?`);

  const bio = (partner.bio || "").trim();
  if (lines.length < 2 && bio && bio.length <= BIO_LIMIT) take(bio, `«${bio}» — расскажешь подробнее?`);

  for (const question of NEUTRAL) {
    if (lines.length >= 2) break;
    lines.push(question);
  }
  return lines.slice(0, MAX);
}
