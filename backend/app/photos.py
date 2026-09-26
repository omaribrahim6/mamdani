"""Validation and compression of report stills; no cloud calls in ingestion."""
import base64
import binascii
import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_PHOTO_BYTES = 4 * 1024 * 1024
MAX_PHOTO_BASE64 = 4 * ((MAX_PHOTO_BYTES + 2) // 3)
MAX_PIXELS = 25_000_000


def validate_jpeg(data: bytes) -> bytes:
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise ValueError("Photo must be a JPEG no larger than 4 MiB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format != "JPEG" or image.width * image.height > MAX_PIXELS:
                    raise ValueError("Invalid photo format or dimensions")
                image.verify()
            # verify() checks structure; load() also rejects truncated image data.
            with Image.open(BytesIO(data)) as image:
                image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("Invalid JPEG photo") from exc
    return data


def decode_photo(encoded: str) -> bytes:
    if len(encoded) > MAX_PHOTO_BASE64:
        raise ValueError("Photo too large")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid photo encoding") from exc
    return validate_jpeg(data)


def compress_photo(data: bytes) -> bytes:
    validate_jpeg(data)
    with Image.open(BytesIO(data)) as image:
        oriented = ImageOps.exif_transpose(image)
        rgb = oriented.convert("RGB")
        rgb.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        # Build a fresh image to ensure EXIF/ICC/comment metadata is not propagated.
        clean = Image.new("RGB", rgb.size)
        clean.paste(rgb)
        output = BytesIO()
        clean.save(output, format="JPEG", quality=80, optimize=True)
        return output.getvalue()
