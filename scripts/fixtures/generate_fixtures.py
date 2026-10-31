#!/usr/bin/env python3
"""Generate the committed sample documents in tests/fixtures.

These are small, realistic files for every supported format plus malformed /
empty variants used by unit, integration and e2e tests. Large-file fixtures are
generated separately (and not committed) by scripts/generate-large-fixtures.mjs.

Requirements (maintainers only): python-docx, python-pptx, openpyxl, reportlab,
Pillow (with AVIF support), ffmpeg and LibreOffice (to store cached formula
results in the XLSX fixture).
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures"))
os.makedirs(ROOT, exist_ok=True)


def out(name: str) -> str:
    return os.path.join(ROOT, name)


# ---------------------------------------------------------------- images
def make_images() -> None:
    w, h = 960, 640
    img = Image.new("RGB", (w, h), (236, 242, 250))
    d = ImageDraw.Draw(img)
    for i in range(0, w, 40):
        d.line([(i, 0), (i, h)], fill=(214, 224, 238))
    for j in range(0, h, 40):
        d.line([(0, j), (w, j)], fill=(214, 224, 238))
    d.rectangle([80, 80, 420, 300], fill=(37, 99, 235))
    d.ellipse([520, 120, 860, 460], fill=(16, 185, 129))
    d.polygon([(160, 560), (320, 360), (480, 560)], fill=(245, 158, 11))
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 44)
    except OSError:
        font = ImageFont.load_default()
    d.text((96, 110), "DocScope", fill="white", font=font)
    img.save(out("photo.jpg"), quality=88)
    img.rotate(90, expand=True).save(out("portrait.jpeg"), quality=85)
    img.save(out("diagram.png"))
    img.save(out("image.webp"), quality=85)
    img.save(out("image.avif"), quality=70)

    frames = []
    for k in range(8):
        f = Image.new("RGB", (240, 160), (255, 255, 255))
        fd = ImageDraw.Draw(f)
        fd.ellipse([20 + k * 22, 50, 80 + k * 22, 110], fill=(220, 38, 38))
        frames.append(f)
    frames[0].save(out("animation.gif"), save_all=True, append_images=frames[1:], duration=120, loop=0)

    with open(out("icon.svg"), "w") as fh:
        fh.write(
            '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
            '<rect width="256" height="256" rx="48" fill="#1e3a8a"/>'
            '<circle cx="112" cy="112" r="56" fill="none" stroke="#93c5fd" stroke-width="18"/>'
            '<line x1="152" y1="152" x2="208" y2="208" stroke="#93c5fd" stroke-width="22" stroke-linecap="round"/>'
            "<script>window.__svgScriptRan = true</script>"
            "</svg>"
        )
    with open(out("broken-image.png"), "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\nthis-is-not-a-real-png")


# ---------------------------------------------------------------- pdf
def make_pdfs() -> None:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    def doc(path: str, title: str, pages: int, size=A4, accent=(0.15, 0.39, 0.92)) -> None:
        c = canvas.Canvas(path, pagesize=size)
        c.setTitle(title)
        c.setAuthor("DocScope fixtures")
        pw, ph = size
        for p in range(1, pages + 1):
            c.setFillColorRGB(*accent)
            c.rect(0, ph - 28 * mm, pw, 28 * mm, fill=1, stroke=0)
            c.setFillColorRGB(1, 1, 1)
            c.setFont("Helvetica-Bold", 22)
            c.drawString(20 * mm, ph - 18 * mm, f"{title} — page {p}")
            c.setFillColorRGB(0.1, 0.1, 0.1)
            c.setFont("Helvetica", 12)
            y = ph - 45 * mm
            lines = [
                f"Section {p}.1 Quarterly invoice summary",
                "The quick brown fox jumps over the lazy dog.",
                f"Invoice number INV-{1000 + p} was approved by the finance team.",
                "Search for the word 'invoice' to test highlighting across pages.",
                "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
            ]
            for line in lines:
                c.drawString(20 * mm, y, line)
                y -= 8 * mm
            # small table
            y -= 4 * mm
            c.setFont("Helvetica-Bold", 11)
            for i, head in enumerate(["Item", "Qty", "Price"]):
                c.drawString((20 + i * 50) * mm, y, head)
            c.setFont("Helvetica", 11)
            for r in range(4):
                y -= 7 * mm
                for i, val in enumerate([f"Widget {r + 1}", str((r + 1) * p), f"${(r + 1) * 9.5:.2f}"]):
                    c.drawString((20 + i * 50) * mm, y, val)
            c.setFont("Helvetica-Oblique", 9)
            c.drawRightString(pw - 20 * mm, 12 * mm, f"Page {p} of {pages}")
            c.showPage()
        c.save()

    doc(out("sample.pdf"), "Annual Report", 6)
    doc(out("contract-v2.pdf"), "Contract v2", 3, size=landscape(A4), accent=(0.06, 0.6, 0.45))
    with open(out("sample.pdf"), "rb") as fh:
        data = fh.read()
    with open(out("malformed.pdf"), "wb") as fh:
        fh.write(b"%PDF-1.7\n" + data[200:900])
    open(out("empty.pdf"), "wb").close()


# ---------------------------------------------------------------- docx
def make_docx() -> None:
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor

    d = Document()
    d.core_properties.title = "Project Proposal"
    d.add_heading("Project Proposal", 0)
    p = d.add_paragraph("This proposal describes the ")
    p.add_run("document preview").bold = True
    p.add_run(" initiative. It contains ")
    r = p.add_run("formatted text")
    r.italic = True
    r.font.color.rgb = RGBColor(0x25, 0x63, 0xEB)
    p.add_run(", a table, an image and lists so rendering fidelity can be checked.")
    d.add_heading("Goals", level=1)
    for g in ["Preview every common attachment", "Search inside documents", "Compare two files side by side"]:
        d.add_paragraph(g, style="List Bullet")
    d.add_heading("Budget", level=1)
    t = d.add_table(rows=1, cols=3)
    t.style = "Light Grid Accent 1"
    hdr = t.rows[0].cells
    hdr[0].text, hdr[1].text, hdr[2].text = "Phase", "Owner", "Cost"
    for row in [("Discovery", "Guru", "$12,000"), ("Build", "Team", "$48,500"), ("Launch", "Ops", "$7,250")]:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = v
    d.add_heading("Architecture sketch", level=1)
    buf = io.BytesIO()
    Image.open(out("diagram.png")).resize((480, 320)).save(buf, format="PNG")
    buf.seek(0)
    d.add_picture(buf, width=Inches(4))
    para = d.add_paragraph("The proposal concludes with next steps and a timeline.")
    para.runs[0].font.size = Pt(12)
    d.add_page_break()
    d.add_heading("Appendix", level=1)
    for i in range(1, 6):
        d.add_paragraph(f"Appendix item {i}: proposal detail and supporting notes.", style="List Number")
    d.save(out("proposal.docx"))
    with open(out("malformed.docx"), "wb") as fh:
        fh.write(b"PK\x03\x04 definitely not a valid docx archive")


# ---------------------------------------------------------------- pptx
def make_pptx() -> None:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches, Pt

    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)

    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = "Quarterly Business Review"
    s.placeholders[1].text = "Prepared with DocScope fixtures"

    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Highlights"
    body = s.placeholders[1].text_frame
    body.text = "Revenue grew 18% year over year"
    for line in ["Customer retention at 94%", "Launched preview workspace", "Searchable slide text"]:
        body.add_paragraph().text = line

    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "Shapes and image"
    rect = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(2), Inches(4), Inches(2.2))
    rect.fill.solid()
    rect.fill.fore_color.rgb = RGBColor(0x25, 0x63, 0xEB)
    rect.text_frame.text = "Rounded rectangle"
    oval = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(5.2), Inches(2), Inches(2.6), Inches(2.6))
    oval.fill.solid()
    oval.fill.fore_color.rgb = RGBColor(0x10, 0xB9, 0x81)
    s.shapes.add_picture(out("photo.jpg"), Inches(8.3), Inches(2), width=Inches(4.2))

    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "Regional table"
    rows, cols = 4, 3
    tbl = s.shapes.add_table(rows, cols, Inches(1), Inches(2), Inches(11), Inches(3)).table
    data = [["Region", "Q3", "Q4"], ["North", "120", "150"], ["South", "98", "131"], ["West", "143", "160"]]
    for r in range(rows):
        for c in range(cols):
            tbl.cell(r, c).text = data[r][c]
            for para in tbl.cell(r, c).text_frame.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(18)
    prs.save(out("deck.pptx"))
    with open(out("malformed.pptx"), "wb") as fh:
        fh.write(b"PK\x03\x04 broken pptx")


# ---------------------------------------------------------------- xlsx
def make_xlsx() -> None:
    import datetime as dt

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = "Budget"
    ws.merge_cells("A1:D1")
    ws["A1"] = "FY2026 Budget"
    ws["A1"].font = Font(bold=True, size=16, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor="1E3A8A")
    ws["A1"].alignment = Alignment(horizontal="center")
    ws.append(["Category", "Planned", "Actual", "Variance"])
    for c in "ABCD":
        ws[f"{c}2"].font = Font(bold=True)
    rows = [("Salaries", 120000, 118500), ("Cloud", 36000, 41250.5), ("Travel", 9000, 6120), ("Training", 12000, 12800)]
    for i, (cat, plan, act) in enumerate(rows, start=3):
        ws[f"A{i}"] = cat
        ws[f"B{i}"] = plan
        ws[f"C{i}"] = act
        ws[f"D{i}"] = f"=C{i}-B{i}"
        for c in "BCD":
            ws[f"{c}{i}"].number_format = '"$"#,##0.00'
    ws["A8"] = "Total"
    ws["A8"].font = Font(bold=True)
    ws["B8"], ws["C8"], ws["D8"] = "=SUM(B3:B6)", "=SUM(C3:C6)", "=SUM(D3:D6)"
    for c in "BCD":
        ws[f"{c}8"].number_format = '"$"#,##0.00'
        ws[f"{c}8"].font = Font(bold=True)
    ws["A10"] = "Utilisation"
    ws["B10"] = "=C8/B8"
    ws["B10"].number_format = "0.0%"
    ws.column_dimensions["A"].width = 22
    for c in "BCD":
        ws.column_dimensions[c].width = 16

    ws2 = wb.create_sheet("Timeline")
    ws2.append(["Milestone", "Date", "Done"])
    base = dt.date(2026, 1, 15)
    for i, name in enumerate(["Kickoff", "Design review", "Beta", "GA"]):
        ws2.append([name, base + dt.timedelta(days=45 * i), i < 2])
        ws2.cell(row=i + 2, column=2).number_format = "yyyy-mm-dd"
    ws2.merge_cells("A7:C8")
    ws2["A7"] = "Merged note spanning two rows and three columns"
    ws2["A7"].alignment = Alignment(wrap_text=True, vertical="center")

    ws3 = wb.create_sheet("Hidden")
    ws3["A1"] = "secret"
    ws3.sheet_state = "hidden"

    ws4 = wb.create_sheet("Grid")
    for r in range(1, 201):
        for c in range(1, 27):
            ws4.cell(row=r, column=c, value=r * c)
    ws4["C5"] = "needle"

    tmp = tempfile.mkdtemp()
    raw = os.path.join(tmp, "budget.xlsx")
    wb.save(raw)
    # Round-trip through LibreOffice so formula cells carry cached results.
    conv = os.path.join(tmp, "conv")
    os.makedirs(conv)
    try:
        subprocess.run(
            ["soffice", "--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", conv, raw],
            check=True,
            capture_output=True,
            timeout=120,
        )
        shutil.copy(os.path.join(conv, "budget.xlsx"), out("budget.xlsx"))
    except Exception as exc:  # pragma: no cover - maintainer tooling
        print("LibreOffice conversion failed, formulas will lack cached values:", exc)
        shutil.copy(raw, out("budget.xlsx"))
    shutil.rmtree(tmp)
    with open(out("malformed.xlsx"), "wb") as fh:
        fh.write(b"PK\x03\x04 broken xlsx")


# ---------------------------------------------------------------- text-ish
def make_text() -> None:
    with open(out("readme.md"), "w") as fh:
        fh.write(
            "# DocScope Markdown sample\n\n"
            "A **bold** statement, some *emphasis*, `inline code` and a [safe link](https://example.com).\n\n"
            "## Task list\n\n- [x] Render GitHub-flavoured markdown\n- [ ] Ship v1\n\n"
            "## Table\n\n| Format | Searchable |\n| --- | --- |\n| PDF | yes |\n| Markdown | yes |\n\n"
            "```ts\nconst preview = <DocumentPreviewer documents={docs} />;\n```\n\n"
            "> Blockquote with a searchable keyword: invoice.\n\n"
            "<script>window.__mdScriptRan = true</script>\n\n"
            "[dangerous](javascript:alert(1))\n\n~~strikethrough~~ and footnote-free text.\n"
        )
    with open(out("notes.txt"), "w") as fh:
        for i in range(1, 121):
            fh.write(f"Line {i:03d}: meeting notes about the invoice workflow and preview search.\n")
    open(out("empty.txt"), "w").close()

    with open(out("customers.csv"), "w") as fh:
        fh.write("id,name,email,city,balance\n")
        cities = ["Bengaluru", "Pune", "Chennai", "Hyderabad", "Mumbai"]
        for i in range(1, 251):
            fh.write(f'{i},"Customer {i}",customer{i}@example.com,{cities[i % 5]},{i * 13.75:.2f}\n')
        fh.write('251,"Quote, Inc.","q@example.com",Delhi,"1,000.00"\n')
    with open(out("orders-semicolon.csv"), "w") as fh:
        fh.write("order;sku;qty\n")
        for i in range(1, 31):
            fh.write(f"ORD-{i};SKU-{i % 7};{i}\n")
    with open(out("metrics.tsv"), "w") as fh:
        fh.write("metric\tvalue\n")
        for k in ["latency", "throughput", "errors"]:
            fh.write(f"{k}\t{len(k) * 3}\n")
    open(out("empty.csv"), "w").close()

    payload = {
        "service": "docscope",
        "version": 1,
        "enabled": True,
        "owners": [{"name": "Guru", "role": "maintainer"}, {"name": "CI", "role": "bot"}],
        "limits": {"maxFileSizeMb": 100, "formats": ["pdf", "docx", "xlsx"], "ratio": 0.75, "nothing": None},
        "description": "Search for invoice inside JSON values",
    }
    with open(out("config.json"), "w") as fh:
        json.dump(payload, fh)
    with open(out("invalid.json"), "w") as fh:
        fh.write('{\n  "name": "broken",\n  "items": [1, 2, 3,\n}\n')

    with open(out("catalog.xml"), "w") as fh:
        fh.write(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<!-- Product catalog sample -->\n"
            '<catalog xmlns:dc="http://purl.org/dc/elements/1.1/" updated="2026-10-01">\n'
            '  <book id="bk101" lang="en">\n    <dc:title>XML Developer Guide</dc:title>\n'
            "    <author>Gambardella, Matthew</author>\n    <price currency=\"USD\">44.95</price>\n  </book>\n"
            '  <book id="bk102" lang="en">\n    <dc:title>Midnight Rain</dc:title>\n'
            "    <author>Ralls, Kim</author>\n    <price currency=\"USD\">5.95</price>\n"
            "    <notes><![CDATA[Contains <markup> & an invoice keyword]]></notes>\n  </book>\n"
            "</catalog>\n"
        )
    with open(out("malformed.xml"), "w") as fh:
        fh.write("<root><unclosed></root>")
    with open(out("xxe.xml"), "w") as fh:
        fh.write(
            '<?xml version="1.0"?>\n<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>\n'
            "<foo>&xxe;</foo>\n"
        )
    with open(out("unknown.bin"), "wb") as fh:
        fh.write(os.urandom(64))


# ---------------------------------------------------------------- video
def make_video() -> None:
    base = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=480x270:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3"]
    subprocess.run(base + ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac",
                           "-shortest", "-movflags", "+faststart", out("clip.mp4")], check=True)
    subprocess.run(base + ["-c:v", "libvpx-vp9", "-b:v", "300k", "-c:a", "libopus", "-shortest", out("clip.webm")],
                   check=True)


if __name__ == "__main__":
    make_images()
    make_pdfs()
    make_docx()
    make_pptx()
    make_xlsx()
    make_text()
    make_video()
    for f in sorted(os.listdir(ROOT)):
        p = out(f)
        if os.path.isfile(p):
            print(f"{os.path.getsize(p):>9}  {f}")
