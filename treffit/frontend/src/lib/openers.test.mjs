import assert from "node:assert/strict";
import test from "node:test";

import { openers } from "./openers.js";

/* Флаги приходят с сервера готовыми фразами — «Оба выбрали „X“» и
   «Общие интересы: A, B». Проверять на выдуманных коротких строчках было
   ошибкой: подстановка целой фразы в шаблон даёт сказанное дважды, а тест
   на «Горы» этого не замечал. */
test("из общего ответа берётся тема, а не вся фраза целиком", () => {
  const [first] = openers({
    shared_flags: ["Оба выбрали «спонтанность»"],
    interests: ["Кофе"],
  });
  assert.match(first, /«спонтанность»/);
  assert.ok(!/оба выбрали «оба/i.test(first), `сказано дважды: ${first}`);
});

test("из списка общих интересов берётся первый, без префикса", () => {
  const [first] = openers({ shared_flags: ["Общие интересы: Горы, Кофе"] });
  assert.ok(!/общие интересы/i.test(first), `префикс попал в текст: ${first}`);
  assert.match(first, /горы/i);
});

test("интерес не повторяет то, что уже сказано в общем ответе", () => {
  const lines = openers({ shared_flags: ["Общие интересы: Горы"], interests: ["Горы", "Кофе"] });
  const mentions = lines.filter((line) => /горы/i.test(line));
  assert.equal(mentions.length, 1, `одна тема дважды: ${JSON.stringify(lines)}`);
});

test("про пустую анкету подсказка всё равно есть, и без «привет»", () => {
  const lines = openers({});
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((line) => !/привет/i.test(line)));
});

/* Подсказка отправляется от лица человека, чей пол мы не знаем. Прошедшее
   время в русском его выдаёт («заметил» / «заметила»), поэтому его в
   заготовках быть не должно вовсе. */
test("ни в одной заготовке нет рода говорящего", () => {
  const cases = [
    {},
    { shared_flags: ["Оба выбрали «спонтанность»"] },
    { shared_flags: ["Общие интересы: Горы, Кофе"] },
    { interests: ["Кино", "Бег"], bio: "Бегаю по утрам" },
    { event: { title: "Концерт в Доме музыки" } },
  ];
  const gendered = /\b\w+(ил|ила|ал|ала|ел|ела)\b/i;
  for (const partner of cases) {
    for (const line of openers(partner)) {
      assert.ok(!gendered.test(line), `«${line}» выдаёт род говорящего`);
    }
  }
});

test("длинное «о себе» в подсказку не тащим", () => {
  const long = "а".repeat(200);
  const lines = openers({ bio: long });
  assert.ok(lines.every((line) => !line.includes(long)));
});

test("подсказок не больше трёх — иначе это уже меню, а не помощь", () => {
  const lines = openers({
    shared_flags: ["Оба выбрали «спонтанность»"],
    event: { title: "Выставка" },
    interests: ["Кофе", "Книги", "Бег"],
    bio: "Коротко о себе",
  });
  assert.ok(lines.length <= 3, `получили ${lines.length}`);
});
