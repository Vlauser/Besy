import pytest

from app.services.matching import compute_compatibility, haversine_meters, normalize_answers

ALL_LEFT = {"1": "left", "2": "left", "3": "left", "4": "left", "5": "left", "6": "left"}
ALL_RIGHT = {k: "right" for k in ALL_LEFT}


def test_identical_answers_score_at_the_top():
    pct, flags = compute_compatibility(ALL_LEFT, ALL_LEFT)
    assert pct == 99  # capped, never a bare 100%
    assert len(flags) == 3  # at most three reasons are shown


def test_opposite_answers_score_at_the_floor():
    pct, flags = compute_compatibility(ALL_LEFT, ALL_RIGHT)
    assert pct == 5
    assert flags == []


def test_half_agreement_lands_in_the_middle():
    other = {"1": "left", "2": "left", "3": "left", "4": "right", "5": "right", "6": "right"}
    pct, _ = compute_compatibility(ALL_LEFT, other)
    assert pct == 50


def test_no_overlap_is_neutral_not_zero():
    pct, flags = compute_compatibility({}, {})
    assert pct == 50
    assert flags == []


def test_shared_interests_raise_the_score():
    plain, _ = compute_compatibility(ALL_LEFT, ALL_RIGHT)
    boosted, flags = compute_compatibility(ALL_LEFT, ALL_RIGHT, ["джаз", "бег"], ["джаз", "бег"])
    assert boosted > plain
    assert any("Общие интересы" in f for f in flags)


def test_flags_name_the_actual_choice():
    _, flags = compute_compatibility({"1": "left"}, {"1": "left"})
    assert flags == ["Оба выбрали «Вечеринка»"]


@pytest.mark.parametrize(
    "raw",
    [
        {"1": "up"},          # not a valid side
        {"99": "left"},       # unknown question
        {"nope": "left"},     # non-numeric key
        {},
    ],
)
def test_garbage_answers_are_dropped(raw):
    assert normalize_answers(raw) == {}


def test_answer_keys_are_normalised_to_strings():
    assert normalize_answers({1: "left", "2": "right"}) == {"1": "left", "2": "right"}


def test_haversine_matches_known_distance():
    # Ekaterinburg city centre → Yeltsin Centre, roughly 1.4 km apart.
    distance = haversine_meters(56.8389, 60.6057, 56.8447, 60.5878)
    assert 1000 < distance < 1800
