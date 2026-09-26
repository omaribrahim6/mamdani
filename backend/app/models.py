from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator

from .photos import MAX_PHOTO_BASE64, decode_photo


class Tag(str, Enum):
    roads = "roads"
    lights = "lights"
    sanitation = "sanitation"
    utilities = "utilities"


class CostTier(str, Enum):
    low = "Low"
    medium = "Medium"
    high = "High"


class ReportStatus(str, Enum):
    processed = "processed"
    needs_review = "needs_review"


class PhotoStatus(str, Enum):
    none = "none"
    pending = "pending"
    uploaded = "uploaded"
    failed = "failed"


class ReportInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    audio_transcription: str = Field(strict=True, max_length=20_000)
    video_transcription: str = Field(strict=True, max_length=20_000)
    latitude: float = Field(strict=True, ge=-90, le=90)
    longitude: float = Field(strict=True, ge=-180, le=180)
    photo_base64: str | None = Field(default=None, strict=True, max_length=MAX_PHOTO_BASE64, repr=False)
    _photo_bytes: bytes | None = PrivateAttr(default=None)

    @property
    def photo_bytes(self) -> bytes | None:
        return self._photo_bytes

    @model_validator(mode="after")
    def require_evidence(self):
        if not (self.audio_transcription.strip() or self.video_transcription.strip()):
            raise ValueError("At least one transcription must contain text")
        if self.photo_base64 is not None:
            self._photo_bytes = decode_photo(self.photo_base64)
        return self


class Analysis(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    issue: str = Field(min_length=1, max_length=255)
    severity_score: int = Field(strict=True, ge=1, le=10)
    ai_confidence: float = Field(ge=0, le=1)
    cost_roi_value: CostTier
    tag: Tag


class Location(BaseModel):
    latitude: float
    longitude: float
    street_address: str | None = None


class ReportResponse(Analysis):
    id: UUID
    created_at: datetime
    raw_audio_text: str | None
    raw_video_text: str | None
    standardized_situation: str
    location: Location
    status: ReportStatus
    photo_status: PhotoStatus = PhotoStatus.none
    photo_object: str | None = None


class SuccessResponse(BaseModel):
    status: str = "success"
