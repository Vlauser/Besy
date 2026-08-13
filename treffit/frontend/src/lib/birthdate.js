/** Ввод даты рождения цифрами.
 *
 * `<input type="date">` на телефоне открывает календарь на текущем месяце, и
 * до года рождения нужно пролистать несколько сотен экранов. Поэтому дату
 * набирают с клавиатуры, а точки подставляются сами.
 *
 * Логика вынесена из компонента, потому что здесь же живёт проверка «18+», и
 * границу возраста хочется проверять тестами, а не глазами.
 */

/** Только цифры, не больше восьми: ДДММГГГГ. */
export function digitsOf(value) {
  return String(value).replace(/\D/g, "").slice(0, 8);
}

/** «13081998» → «13.08.1998».
 *
 *  Разделитель не появляется, пока за ним ничего нет: иначе backspace стирал
 *  бы точку, поле сразу дописывало её обратно, и цифру было бы не удалить.
 */
export function formatBirthDate(digits) {
  const parts = [digits.slice(0, 2)];
  if (digits.length > 2) parts.push(digits.slice(2, 4));
  if (digits.length > 4) parts.push(digits.slice(4, 8));
  return parts.join(".");
}

export function yearsWord(age) {
  const tail = age % 10;
  const teen = age % 100 >= 11 && age % 100 <= 14;
  if (!teen && tail === 1) return "год";
  if (!teen && tail >= 2 && tail <= 4) return "года";
  return "лет";
}

/** Возраст в полных годах. Считается так же, как на сервере, иначе форма
 *  пропустит дату, которую бэкенд отвергнет. */
export function ageOn(year, month, day, today = new Date()) {
  const had =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  return today.getFullYear() - year - (had ? 0 : 1);
}

/** Разбор введённого: ISO-дата для сервера либо человеческая ошибка.
 *
 *  Пока цифр меньше восьми — ни даты, ни ошибки: человек ещё печатает.
 */
export function readBirthDate(digits, minAge, today = new Date()) {
  if (digits.length < 8) return { iso: "", error: "", age: null };

  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));

  // new Date(2001, 1, 29) молча становится 1 марта — сверяем, что дата
  // пережила конструктор без поправок.
  const parsed = new Date(year, month - 1, day);
  const real =
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
  if (!real) return { iso: "", error: "Такой даты не существует", age: null };

  const age = ageOn(year, month, day, today);
  if (age < minAge) return { iso: "", error: `Регистрация с ${minAge} лет`, age: null };
  if (age > 100) return { iso: "", error: "Проверьте год рождения", age: null };

  const pad = (n) => String(n).padStart(2, "0");
  return { iso: `${year}-${pad(month)}-${pad(day)}`, error: "", age };
}

/** ISO с сервера → цифры, которые показывает поле. */
export function digitsFromIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return match ? `${match[3]}${match[2]}${match[1]}` : "";
}
