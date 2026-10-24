"""生成浏览器联调验收用的虚构简历与异常文件（不含任何真实个人信息）。

在仓库根目录运行：
    python backend/scripts/make_acceptance_files.py <输出目录>

输出：
    <输出目录>/20份混合简历/   DOCX 6、文本 PDF 6、扫描 PDF 3、PNG 3、JPG 2
    <输出目录>/异常文件/       重复、空文件、超大、伪造扩展名、加密/损坏 PDF、空白图片、低置信度图片、空白 DOCX
    <输出目录>/JD.txt          验收用岗位 JD
"""
import io
import random
import sys
from pathlib import Path

import pymupdf
from docx import Document
from PIL import Image, ImageDraw, ImageFilter, ImageFont

JD = """岗位：Python 后端开发实习生

岗位职责
1. 参与公司招聘系统后端开发，使用 FastAPI 编写 REST API；
2. 设计 MySQL 数据表并优化 SQL 查询；
3. 编写单元测试，使用 Git 协作开发；
4. 配合部署与线上问题排查。

任职要求
1. 本科及以上学历，计算机相关专业；
2. 熟悉 Python，了解 FastAPI 或 Django；
3. 熟悉 MySQL，了解 Redis；
4. 有 Docker、Linux 使用经验者优先。"""

# (文件名, 格式, 简历正文)。人名、学校、公司均为虚构
RESUMES = [
    ("01_张晨_后端_高匹配", "docx", "张晨 · Python 后端开发\n郑州大学 计算机科学与技术 本科 2023.09-2027.06\n技能：Python、FastAPI、MySQL、Redis、Docker、Linux、Git\n项目：校园报名系统后端，使用 FastAPI 编写 REST API，设计 MySQL 表结构并优化慢查询，编写 pytest 单元测试，使用 Docker 部署到 Linux 服务器。\n实习：某软件公司后端实习生 2026.07-2026.09，负责接口开发与 Redis 缓存。"),
    ("02_李雪_后端_高匹配", "pdf_text", "李雪 · 后端开发实习\n河南大学 软件工程 本科 2023.09-2027.06\n技能：Python、Django、FastAPI、MySQL、Git、Linux\n项目：图书借阅平台，使用 Django 开发 REST API，MySQL 建表与索引优化，编写单元测试，Git 分支协作。\n获奖：校程序设计竞赛二等奖。"),
    ("03_王浩_全栈_中匹配", "png", "王浩 全栈开发\n郑州轻工业大学 计算机 本科\n技能 Python Vue MySQL Git\n项目 二手交易平台 负责 Flask 接口与 Vue 页面\n熟悉 MySQL 增删改查"),
    ("04_赵敏_数据_中匹配", "docx", "赵敏 · 数据分析\n华北水利水电大学 统计学 本科 2023.09-2027.06\n技能：Python、pandas、SQL、MySQL、Excel\n项目：电商订单分析，用 Python 清洗数据，用 SQL 统计复购率。\n了解 Linux 基本命令。"),
    ("05_陈杰_Java_中匹配", "pdf_text", "陈杰 · Java 后端\n河南工业大学 计算机科学与技术 本科 2022.09-2026.06\n技能：Java、Spring Boot、MySQL、Redis、Docker、Git\n项目：外卖订单系统，Spring Boot 开发接口，Redis 缓存热点数据，Docker 部署。\n了解 Python 脚本编写。"),
    ("06_刘洋_前端_低匹配", "jpg", "刘洋 前端开发\n郑州航空工业管理学院 数字媒体 本科\n技能 HTML CSS JavaScript React\n项目 企业官网 响应式页面开发\n了解 Git"),
    ("07_孙丽_销售_跨行", "docx", "孙丽 · 销售顾问\n某职业学院 市场营销 专科 2018.09-2021.06\n经历：家电门店销售顾问 3 年，月均销售额 30 万元，负责客户维护与售后协调。\n技能：客户沟通、Excel 报表。"),
    ("08_周婷_后端_扫描件", "pdf_scan", "周婷 Python 后端实习\n郑州大学 软件工程 本科 2024.09-2028.06\n技能 Python FastAPI MySQL Git Docker\n项目 实验室设备预约系统 使用 FastAPI 开发接口\n编写单元测试 部署到 Linux"),
    ("09_吴凡_运维_中匹配", "pdf_text", "吴凡 · 运维实习\n河南理工大学 网络工程 本科 2023.09-2027.06\n技能：Linux、Docker、Shell、Nginx、MySQL、Git\n经历：学校网络中心助理，维护 Linux 服务器，使用 Docker 部署内部服务，编写 Shell 脚本备份 MySQL。\n了解 Python。"),
    ("10_郑强_后端_高匹配", "docx", "郑强 · Python 后端\n北京某大学 计算机技术 硕士 2025.09-2028.06\n本科：郑州大学 计算机科学与技术\n技能：Python、FastAPI、Django、MySQL、Redis、Docker、Linux、Git、单元测试\n项目：科研数据管理平台，FastAPI 编写 REST API，MySQL 分表设计，Redis 缓存，Docker Compose 部署。"),
    ("11_黄蕾_测试_中匹配", "png", "黄蕾 软件测试\n河南科技大学 软件工程 本科\n技能 Python pytest MySQL Linux Git\n经历 测试实习 编写接口自动化测试\n使用 Python 编写单元测试"),
    ("12_马超_算法_中匹配", "pdf_text", "马超 · 算法实习\n郑州大学 人工智能 本科 2023.09-2027.06\n技能：Python、PyTorch、NumPy、Linux、Git\n项目：风场短期预测，基于 PyTorch 实现时空预测模型，在 Linux 服务器训练。\n了解 MySQL。"),
    ("13_林夕_后端_扫描件", "pdf_scan", "林夕 后端开发\n河南师范大学 计算机 本科 2023.09-2027.06\n技能 Python Django MySQL Redis\n项目 社团管理系统 Django 开发接口\n使用 Git 协作"),
    ("14_何静_产品_跨行", "docx", "何静 · 产品经理实习\n郑州大学 信息管理 本科 2023.09-2027.06\n经历：社交 App 产品实习，撰写 PRD 6 篇，Axure 绘制原型，组织 15 次用户访谈。\n技能：Axure、Figma、Excel。"),
    ("15_郭宇_后端_高匹配", "pdf_text", "郭宇 · Python 后端开发\n郑州大学 软件工程 本科 2022.09-2026.06\n技能：Python、FastAPI、MySQL、Redis、Docker、Linux、Git、pytest\n实习：某互联网公司后端实习 2025.07-2025.12，负责订单服务 REST API，MySQL 慢查询优化，Docker 镜像构建。"),
    ("16_罗琳_后端_中匹配", "jpg", "罗琳 后端开发\n安阳工学院 计算机 本科\n技能 Python Flask SQLite Git\n项目 课程作业管理 Flask 开发接口\n了解 MySQL"),
    ("17_宋涛_后端_扫描件", "pdf_scan", "宋涛 Python 开发\n河南大学 计算机 本科 2023.09-2027.06\n技能 Python FastAPI MySQL Docker Linux\n项目 实习招聘信息聚合 编写 REST API\n使用 Git"),
    ("18_唐悦_设计_跨行", "png", "唐悦 视觉设计\n某艺术学院 视觉传达 本科\n技能 Photoshop Illustrator Figma\n作品 品牌海报 包装设计"),
    ("19_许诺_后端_中匹配", "docx", "许诺 · 后端开发\n南阳理工学院 计算机科学与技术 本科 2023.09-2027.06\n技能：Python、Go、MySQL、Git\n项目：短链接服务，Go 编写接口，MySQL 存储，Python 编写数据迁移脚本。"),
    ("20_韩梅_后端_高匹配", "pdf_text", "韩梅 · Python 后端实习\n郑州大学 计算机科学与技术 本科 2023.09-2027.06\n技能：Python、FastAPI、MySQL、Redis、Linux、Git、Docker\n项目：在线考试系统后端，FastAPI 编写 REST API，MySQL 建表与索引设计，编写单元测试，Docker 部署到 Linux。"),
]


def find_font():
    for path in ("/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Supplemental/Songti.ttc",
                 "C:/Windows/Fonts/msyh.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"):
        if Path(path).exists():
            return path
    raise SystemExit("找不到中文字体，图片/扫描件无法生成")


def render_image(text, font_path, size=30, width=1400):
    font = ImageFont.truetype(font_path, size)
    lines = text.splitlines()
    image = Image.new("RGB", (width, 120 + len(lines) * int(size * 1.9)), "white")
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(lines):
        draw.text((60, 60 + index * int(size * 1.9)), line, fill="black", font=font)
    return image


def write_docx(path, text):
    document = Document()
    for line in text.splitlines():
        document.add_paragraph(line)
    document.save(path)


def write_text_pdf(path, text):
    document = pymupdf.open()
    page = document.new_page()
    # 内置 CJK 字体，生成带文本层的 PDF
    page.insert_textbox(pymupdf.Rect(50, 50, 545, 800), text, fontname="china-s", fontsize=11)
    document.save(path)


def write_scan_pdf(path, text, font_path):
    # 只有图片、没有文本层，模拟扫描件
    image = render_image(text, font_path, size=34)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(20, 20, 575, 20 + 555 * image.height / image.width), stream=buffer.getvalue())
    document.save(path)


def main(out):
    font_path = find_font()
    mixed, abnormal = out / "20份混合简历", out / "异常文件"
    mixed.mkdir(parents=True, exist_ok=True)
    abnormal.mkdir(parents=True, exist_ok=True)
    (out / "JD.txt").write_text(JD + "\n", encoding="utf-8")

    for name, kind, text in RESUMES:
        if kind == "docx":
            write_docx(mixed / f"{name}.docx", text)
        elif kind == "pdf_text":
            write_text_pdf(mixed / f"{name}.pdf", text)
        elif kind == "pdf_scan":
            write_scan_pdf(mixed / f"{name}.pdf", text, font_path)
        elif kind == "png":
            render_image(text, font_path).save(mixed / f"{name}.png")
        else:
            render_image(text, font_path).save(mixed / f"{name}.jpg", quality=90)

    # 异常文件
    (abnormal / "重复文件_同01.docx").write_bytes((mixed / "01_张晨_后端_高匹配.docx").read_bytes())
    (abnormal / "空文件.pdf").write_bytes(b"")
    (abnormal / "伪造扩展名.pdf").write_text("这其实是一个文本文件，只是改了扩展名。\n" * 20, encoding="utf-8")
    (abnormal / "伪造扩展名.docx").write_bytes(b"PK\x03\x04" + b"not a real docx" * 100)

    encrypted = pymupdf.open()
    encrypted.new_page().insert_text((72, 72), "Encrypted resume", fontsize=12)
    encrypted.save(abnormal / "加密.pdf", encryption=pymupdf.PDF_ENCRYPT_AES_256,
                   owner_pw="owner-test", user_pw="user-test")
    good_pdf = (mixed / "02_李雪_后端_高匹配.pdf").read_bytes()
    (abnormal / "损坏.pdf").write_bytes(good_pdf[: len(good_pdf) // 3])

    Image.new("RGB", (1200, 800), "white").save(abnormal / "空白图片.png")
    # 低置信度：小字号、大量噪点再模糊，RapidOCR 置信度约 0.5–0.65（阈值 0.7）
    noisy = render_image("王某 后端开发 Python MySQL Git\n郑州某学院 计算机 本科\n项目 宿舍报修系统", font_path, size=18, width=700)
    pixels = noisy.load()
    rng = random.Random(7)
    for _ in range(noisy.width * noisy.height // 3):
        x, y = rng.randrange(noisy.width), rng.randrange(noisy.height)
        pixels[x, y] = (rng.randrange(256),) * 3
    noisy.filter(ImageFilter.GaussianBlur(1.6)).save(abnormal / "低置信度图片.jpg", quality=30)

    write_docx(abnormal / "空白.docx", "")
    # 超大：16MB 的 PNG（单份上限 15MB），用随机像素避免被压缩
    rng_bytes = random.Random(1).randbytes(2400 * 2400 * 3)
    Image.frombytes("RGB", (2400, 2400), rng_bytes).save(abnormal / "超大16MB.png", compress_level=0)

    for folder in (mixed, abnormal):
        for file in sorted(folder.iterdir()):
            print(f"{folder.name}/{file.name}\t{file.stat().st_size:,} B")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
