"""Pydantic models. Extra fields are always rejected so no free text can slip in."""
from __future__ import annotations

import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Answer = Literal["comply", "verify"]
ItemSet = Literal["A", "B"]
Lang = Literal["en", "es", "fr"]

SCENARIO_ID = r"^[a-z0-9-]{1,40}$"
NODE_ID = r"^[a-z0-9_]{1,20}$"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RephraseRequest(Strict):
    scenario_id: str = Field(pattern=SCENARIO_ID)
    node_id: str = Field(pattern=NODE_ID)
    lang: Lang = "en"


class RephraseResponse(BaseModel):
    say: str
    source: Literal["llm", "fallback"]


class StudyAnswer(Strict):
    item_id: str = Field(pattern=r"^[AB][1-5]$")
    answer: Answer


class StudySession(Strict):
    participant_id: UUID
    # Required by the current frontend; defaults to "en" only for older clients.
    lang: Lang = "en"
    pre_set: ItemSet
    post_set: ItemSet
    pre: list[StudyAnswer] = Field(min_length=5, max_length=5)
    post: list[StudyAnswer] = Field(min_length=5, max_length=5)
    drills_played: list[str] = Field(default_factory=list, max_length=10)
    consent: Literal[True]

    @field_validator("participant_id")
    @classmethod
    def uuid4_only(cls, v: UUID) -> UUID:
        if v.version != 4:
            raise ValueError("participant_id must be a UUID4")
        return v

    @field_validator("drills_played")
    @classmethod
    def drill_ids(cls, v: list[str]) -> list[str]:
        for d in v:
            if not re.fullmatch(SCENARIO_ID, d):
                raise ValueError("invalid drill id")
        return v

    @model_validator(mode="after")
    def sets_match(self) -> "StudySession":
        if self.pre_set == self.post_set:
            raise ValueError("pre_set and post_set must differ")
        for name, set_id, answers in (("pre", self.pre_set, self.pre), ("post", self.post_set, self.post)):
            ids = [a.item_id for a in answers]
            if len(set(ids)) != 5 or any(not i.startswith(set_id) for i in ids):
                raise ValueError(f"{name} must answer each item of set {set_id} once")
        return self


class StoredResponse(BaseModel):
    stored: bool


class ItemRate(BaseModel):
    item_id: str
    verify_rate: float


class StudySummary(BaseModel):
    n: int
    pre_verify_rate: float
    post_verify_rate: float
    change_points: int
    per_item: list[ItemRate]
    by_lang: dict[str, int]
    label: str = "Small sample, self-reported"
