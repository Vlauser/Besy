"""Города, по которым работает афиша.

Один список на всё: по нему синхронизируются события, из него же
выбирают город в анкете. Иначе связь держится на том, что человек напишет
город ровно так же, как его записал источник, — а он напишет «мск»,
«Москва » или «москва», и афиша окажется пустой без единой ошибки в логах.

Слаг — это `location` в API КудаGo (docs.kudago.com/api).
"""

from __future__ import annotations

# слаг КудаGo → каноничное название → как его ещё пишут
CITIES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("msk", "Москва", ("мск", "moscow", "msk")),
    ("spb", "Санкт-Петербург", ("спб", "питер", "санкт петербург", "ленинград", "spb")),
    ("ekb", "Екатеринбург", ("екб", "ебург", "екат", "ekb")),
    ("nsk", "Новосибирск", ("нск", "новосиб", "nsk")),
    ("nnv", "Нижний Новгород", ("нижний", "нн", "nnv")),
    ("kzn", "Казань", ("кзн", "kzn")),
    ("smr", "Самара", ("смр", "smr")),
    ("krd", "Краснодар", ("крд", "krd")),
    ("sochi", "Сочи", ("sochi",)),
    ("ufa", "Уфа", ("ufa",)),
)

SLUGS: tuple[str, ...] = tuple(slug for slug, _, _ in CITIES)
NAMES: tuple[str, ...] = tuple(name for _, name, _ in CITIES)

_BY_SLUG = {slug: name for slug, name, _ in CITIES}

# Всё, по чему можно опознать город: и каноничное имя, и слаг, и разговорные
# варианты. Ключи уже приведены к сравнимому виду.
def _key(text: str) -> str:
    """Строка в виде, пригодном для сравнения: без регистра, ё=е, дефис=пробел."""
    cleaned = text.strip().lower().replace("ё", "е").replace("-", " ")
    return " ".join(cleaned.split())


_LOOKUP: dict[str, str] = {}
for _slug, _name, _aliases in CITIES:
    _LOOKUP[_key(_name)] = _name
    _LOOKUP[_key(_slug)] = _name
    for _alias in _aliases:
        _LOOKUP[_key(_alias)] = _name


def name_for_slug(slug: str) -> str:
    """Каноничное название по слагу источника; незнакомый слаг — как есть."""
    return _BY_SLUG.get(slug, slug)


def normalize(text: str | None) -> str | None:
    """Написанное человеком → каноничное название, либо None.

    None означает «такого города в афише нет» — это не ошибка ввода, а
    честный ответ: событий по нему всё равно не будет.
    """
    if not text:
        return None
    return _LOOKUP.get(_key(text))
