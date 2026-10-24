import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont

from app.ingestion import IngestError, extract_text
from app.ocr import OcrPage, OcrUnavailable


def sample_image(format="PNG"):
    image = Image.new("RGB", (1400, 700), "white")
    font = None
    for path in ("C:/Windows/Fonts/msyh.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if Path(path).exists():
            font = ImageFont.truetype(path, 36)
            break
    draw = ImageDraw.Draw(image)
    lines = ["Python Backend Developer", "FastAPI MySQL Docker Linux Git",
             "Bachelor Computer Science 2023 2027", "Develop REST APIs and database services",
             "Write unit tests and maintain backend systems"]
    for index, line in enumerate(lines):
        draw.text((50, 50 + index * 100), line, font=font, fill="black")
    stream = io.BytesIO()
    image.save(stream, format=format)
    return stream.getvalue()


class OcrPipelineTests(unittest.TestCase):
    def test_image_low_confidence_and_empty_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image"
            path.write_bytes(sample_image())
            with patch("app.ingestion.get_provider"), patch("app.ocr.get_provider") as provider:
                provider.return_value.recognize_png.return_value = OcrPage("熟悉Python和MySQL，参与后端服务开发、接口联调与单元测试，完成多个校园项目。", 2)
                result = extract_text(path, "png", 10)
                self.assertEqual(result["status"], "need_review")
                self.assertEqual(result["low_conf"], 2)
                self.assertEqual(result["source"], "image")
                self.assertEqual(result["pages"], 1)
                provider.return_value.recognize_png.return_value = OcrPage("")
                with self.assertRaises(IngestError) as error:
                    extract_text(path, "png", 10)
                self.assertEqual(error.exception.detail["code"], "OCR_FAILED")

    def test_unavailable_engine_and_corrupt_image(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image"
            path.write_bytes(b"\x89PNG\r\n\x1a\ncorrupt")
            with patch("app.ingestion.get_provider", side_effect=OcrUnavailable("请安装离线 OCR 引擎")):
                with self.assertRaises(IngestError) as error:
                    extract_text(path, "png", 10)
                self.assertEqual(error.exception.status, 503)
                self.assertIn("请安装", error.exception.detail["message"])
            with patch("app.ingestion.get_provider"):
                with self.assertRaises(IngestError) as error:
                    extract_text(path, "png", 10)
                self.assertEqual(error.exception.status, 415)


# Windows / macOS / 常见 Linux 发行版的中文字体，任一存在即可跑中文识别测试
CHINESE_FONTS = ("C:/Windows/Fonts/msyh.ttc", "/System/Library/Fonts/STHeiti Medium.ttc",
                 "/System/Library/Fonts/PingFang.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", "/usr/share/fonts/wqy-microhei/wqy-microhei.ttc")
CHINESE_FONT = next((path for path in CHINESE_FONTS if Path(path).exists()), None)


@unittest.skipUnless(os.getenv("TEST_REAL_OCR") == "1", "set TEST_REAL_OCR=1 after installing requirements-ocr.txt")
class RealOfflineOcrTests(unittest.TestCase):
    @unittest.skipUnless(CHINESE_FONT, "Chinese test requires a CJK font (YaHei / STHeiti / Noto CJK / WenQuanYi)")
    def test_chinese_resume_offline(self):
        with patch.dict(os.environ, {"OCR_PROVIDER": "rapidocr"}), tempfile.TemporaryDirectory() as directory:
            image = Image.new("RGB", (1200, 500), "white")
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype(CHINESE_FONT, 36)
            for index, line in enumerate(("张三 后端开发实习生", "郑州大学 计算机科学与技术 本科",
                                          "熟悉 Python 和 MySQL 数据库", "负责接口开发 单元测试与团队协作")):
                draw.text((40, 40 + index * 100), line, font=font, fill="black")
            path = Path(directory) / "中文简历.png"
            image.save(path, format="PNG")
            result = extract_text(path, "png", 10)
            self.assertIn("后端开发", result["text"])
            self.assertIn("郑州大学", result["text"])
            self.assertIn("Python", result["text"])

    def test_png_and_jpg_offline(self):
        with patch.dict(os.environ, {"OCR_PROVIDER": "rapidocr"}), tempfile.TemporaryDirectory() as directory:
            for format, kind in (("PNG", "png"), ("JPEG", "jpg")):
                path = Path(directory) / kind
                path.write_bytes(sample_image(format))
                result = extract_text(path, kind, 10)
                self.assertIn("python", result["text"].lower())
                self.assertIn("mysql", result["text"].lower())
                self.assertEqual(result["provider"], "rapidocr")

    def test_scanned_pdf_offline(self):
        import pymupdf
        with patch.dict(os.environ, {"OCR_PROVIDER": "rapidocr"}), tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "scan.pdf"
            with pymupdf.open() as document:
                page = document.new_page(width=700, height=350)
                page.insert_image(page.rect, stream=sample_image())
                document.save(path)
            result = extract_text(path, "pdf", 10)
            self.assertIn("python", result["text"].lower())
            self.assertEqual(result["source"], "pdf_ocr")
            self.assertEqual(result["pages"], 1)

    def test_blank_image_has_readable_error(self):
        with patch.dict(os.environ, {"OCR_PROVIDER": "rapidocr"}), tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "blank.png"
            Image.new("RGB", (800, 800), "white").save(path, format="PNG")
            with self.assertRaises(IngestError) as error:
                extract_text(path, "png", 10)
            self.assertEqual(error.exception.detail["code"], "OCR_FAILED")


if __name__ == "__main__":
    unittest.main()
