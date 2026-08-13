import assert from "node:assert/strict";
import { test } from "node:test";

import {
  digitsFromIso,
  digitsOf,
  formatBirthDate,
  readBirthDate,
  yearsWord,
} from "./birthdate.js";

// Фиксированное «сегодня»: иначе тест про совершеннолетие начнёт падать или,
// хуже, проходить по случайности — в зависимости от дня прогона.
const TODAY = new Date(2026, 7, 13); // 13 августа 2026
const read = (digits) => readBirthDate(digits, 18, TODAY);

test("маска подставляет точки по мере ввода", () => {
  assert.equal(formatBirthDate(""), "");
  assert.equal(formatBirthDate("13"), "13");
  assert.equal(formatBirthDate("1308"), "13.08");
  assert.equal(formatBirthDate("13081"), "13.08.1");
  assert.equal(formatBirthDate("13081998"), "13.08.1998");
});

test("разделитель не мешает стирать", () => {
  // Backspace превращает «13.08.1» в «13.08.» — если бы маска дописывала
  // точку обратно, последнюю цифру дня было бы не удалить.
  assert.equal(formatBirthDate(digitsOf("13.08.")), "13.08");
  assert.equal(formatBirthDate(digitsOf("13.0")), "13.0");
});

test("буквы и лишние цифры в поле не попадают", () => {
  assert.equal(digitsOf("13.08.1998"), "13081998");
  assert.equal(digitsOf("абв13"), "13");
  assert.equal(digitsOf("1308199899"), "13081998");
});

test("пока дата не дописана — ни результата, ни ругани", () => {
  for (const partial of ["", "1", "1308", "1308199"]) {
    assert.deepEqual(read(partial), { iso: "", error: "", age: null });
  }
});

test("полная дата превращается в ISO для сервера", () => {
  assert.deepEqual(read("13081998"), { iso: "1998-08-13", error: "", age: 28 });
  // Однозначные день и месяц уезжают в ISO с ведущим нулём.
  assert.equal(read("01011990").iso, "1990-01-01");
});

test("несуществующая дата отвергается", () => {
  assert.equal(read("32011990").error, "Такой даты не существует");
  assert.equal(read("30021990").error, "Такой даты не существует");
  assert.equal(read("29022001").error, "Такой даты не существует"); // 2001 не високосный
  assert.equal(read("29022000").iso, "2000-02-29"); // а 2000 — високосный
  assert.equal(read("00011990").error, "Такой даты не существует");
});

test("граница 18 лет проходит ровно по дню рождения", () => {
  // Ровно 18 сегодня — пускаем.
  assert.equal(read("13082008").age, 18);
  // Восемнадцать исполнится завтра — ещё нет.
  assert.equal(read("14082008").error, "Регистрация с 18 лет");
  assert.equal(read("14082008").iso, "");
  // Исполнилось вчера — уже да.
  assert.equal(read("12082008").age, 18);
});

test("дата из будущего не проходит как возраст", () => {
  assert.equal(read("01012030").error, "Регистрация с 18 лет");
});

test("описка в веке ловится", () => {
  assert.equal(read("13081898").error, "Проверьте год рождения");
});

test("годы склоняются по-русски", () => {
  assert.equal(yearsWord(21), "год");
  assert.equal(yearsWord(22), "года");
  assert.equal(yearsWord(25), "лет");
  assert.equal(yearsWord(11), "лет"); // не «год», хотя оканчивается на 1
  assert.equal(yearsWord(112), "лет"); // не «года»
  assert.equal(yearsWord(101), "год");
});

test("сохранённая дата раскладывается обратно в поле", () => {
  assert.equal(digitsFromIso("1998-08-13"), "13081998");
  assert.equal(formatBirthDate(digitsFromIso("1998-08-13")), "13.08.1998");
  assert.equal(digitsFromIso(""), "");
  assert.equal(digitsFromIso(null), "");
});
