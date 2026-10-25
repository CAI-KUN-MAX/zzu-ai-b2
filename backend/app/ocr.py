"""Lazy, offline OCR. Importing the API never loads OCR models."""
import os
import threading
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol


class OcrUnavailable(Exception):
    pass


@dataclass
class OcrPage:
    text: str
    low_conf: int = 0


class OcrProvider(Protocol):
    def recognize_png(self, content: bytes) -> OcrPage: ...


class RapidOcr:
    def __init__(self):
        try:
            from rapidocr_onnxruntime import RapidOCR
            self.engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)
        except Exception as exc:
            raise OcrUnavailable("离线 OCR 引擎不可用，请安装 backend/requirements-ocr.txt 中的依赖后重启") from exc
        self.lock = threading.Lock()

    def recognize_png(self, content):
        # The shared ONNX engine has bounded CPU use and is never called concurrently.
        with self.lock:
            result, _ = self.engine(content)
        lines = result or []
        return OcrPage("\n".join(str(line[1]) for line in lines),
                       sum(float(line[2]) < 0.7 for line in lines))


@lru_cache(maxsize=3)
def _provider(mode):
    if mode == "stub":
        raise OcrUnavailable("OCR 已关闭，请启用 rapidocr 或上传带文本层的 PDF、DOCX")
    if mode in {"auto", "rapidocr"}:
        return RapidOcr()
    raise OcrUnavailable("OCR_PROVIDER 配置无效，请使用 auto、rapidocr 或 stub")


_provider_lock = threading.Lock()


def get_provider() -> OcrProvider:
    with _provider_lock:
        return _provider(os.getenv("OCR_PROVIDER", "auto").lower())


def recognize_image(content):
    # Validate actual image content, then normalize JPG/PNG for provider consistency.
    import io
    from PIL import Image
    with Image.open(io.BytesIO(content)) as image:
        if image.width * image.height > 25_000_000:
            raise ValueError("image too large")
        normalized = io.BytesIO()
        image.convert("RGB").save(normalized, format="PNG")
    return get_provider().recognize_png(normalized.getvalue())
