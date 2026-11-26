#!/usr/bin/env python3
"""Servictro User Manual — PDF generation (ReportLab body + HTML cover).

Chapter numbering plan (Step 3.5 mapping — cover/TOC are not chapters):
| Order | Type    | Chapter | Title                                        |
|-------|---------|---------|----------------------------------------------|
| 1     | cover   | —       | Cover (HTML/Playwright, merged via pypdf)    |
| 2     | toc     | —       | Table of contents                            |
| 3     | content | 1       | Product overview                             |
| 4     | content | 2       | Getting started and navigation               |
| 5     | content | 3       | Module reference (3.1–3.13)                  |
| 6     | content | 4       | Step-by-step workflow guides                 |
| 7     | content | 5       | User roles and permissions                   |
| 8     | content | 6       | Reports and dashboard analytics              |
| 9     | content | 7       | Settings and configuration                   |
| 10    | content | 8       | Troubleshooting and FAQ                      |
| 11    | content | 9       | Best practices and quick reference           |
"""
import hashlib
import os
import sys

PDF_SKILL_DIR = "/home/z/my-project/skills/pdf"
sys.path.insert(0, os.path.join(PDF_SKILL_DIR, "scripts"))

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus import (
    CondPageBreak, Image, KeepTogether, PageBreak, Paragraph,
    SimpleDocTemplate, Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents
from PIL import Image as PILImage

# ---------------------------------------------------------------- fonts ----
FONT_DIR = "/usr/share/fonts"
pdfmetrics.registerFont(TTFont("NotoSerifSC", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf"))
pdfmetrics.registerFont(TTFont("NotoSerifSC-Bold", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif", f"{FONT_DIR}/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Bold", f"{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Italic", f"{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-BoldItalic", f"{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf"))
registerFontFamily("NotoSerifSC", normal="NotoSerifSC", bold="NotoSerifSC-Bold")
registerFontFamily("FreeSerif", normal="FreeSerif", bold="FreeSerif-Bold",
                   italic="FreeSerif-Italic", boldItalic="FreeSerif-BoldItalic")

from pdf import install_font_fallback  # noqa: E402  (skill helper)
install_font_fallback()

# ━━ Cascade Palette (design_engine.py palette-cascade --intent cold --mode minimal --harmony analogous --seed 7) ━━
PAGE_BG       = colors.HexColor('#eff0f1')
SECTION_BG    = colors.HexColor('#f0f1f2')
CARD_BG       = colors.HexColor('#e4e7e8')
TABLE_STRIPE  = colors.HexColor('#ebedee')
HEADER_FILL   = colors.HexColor('#334650')
COVER_BLOCK   = colors.HexColor('#5a7886')
BORDER        = colors.HexColor('#b8c8cf')
ICON          = colors.HexColor('#52798c')
ACCENT        = colors.HexColor('#3681a6')
ACCENT_2      = colors.HexColor('#3ab49f')
TEXT_PRIMARY  = colors.HexColor('#1a1b1c')
TEXT_MUTED    = colors.HexColor('#6f7578')
SEM_WARNING   = colors.HexColor('#a18347')

TABLE_HEADER_COLOR = HEADER_FILL
TABLE_ROW_EVEN     = colors.white
TABLE_ROW_ODD      = TABLE_STRIPE

# ---------------------------------------------------------------- layout ---
PAGE_W, PAGE_H = A4
MARGIN = 0.85 * inch
AVAIL_W = PAGE_W - 2 * MARGIN
AVAIL_H = PAGE_H - 2 * MARGIN
SHOTS = "/home/z/my-project/data/manual-shots"
OUT_DIR = "/home/z/my-project/download"
BODY_PDF = "/home/z/my-project/scripts/manual/body.pdf"

# ---------------------------------------------------------------- styles ---
S = {}
S["h1"] = ParagraphStyle("H1", fontName="FreeSerif", fontSize=20, leading=26,
                         textColor=HEADER_FILL, spaceBefore=18, spaceAfter=10)
S["h2"] = ParagraphStyle("H2", fontName="FreeSerif", fontSize=14.5, leading=19,
                         textColor=HEADER_FILL, spaceBefore=14, spaceAfter=6)
S["h3"] = ParagraphStyle("H3", fontName="FreeSerif", fontSize=11.5, leading=15,
                         textColor=TEXT_PRIMARY, spaceBefore=10, spaceAfter=5)
S["body"] = ParagraphStyle("Body", fontName="FreeSerif", fontSize=10.5, leading=16,
                           textColor=TEXT_PRIMARY, alignment=TA_LEFT, spaceAfter=8)
S["bullet"] = ParagraphStyle("Bullet", fontName="FreeSerif", fontSize=10.5, leading=15.5,
                             textColor=TEXT_PRIMARY, leftIndent=14, bulletIndent=4, spaceAfter=4)
S["step"] = ParagraphStyle("Step", fontName="FreeSerif", fontSize=10.5, leading=15.5,
                           textColor=TEXT_PRIMARY, leftIndent=22, firstLineIndent=-14, spaceAfter=5)
S["caption"] = ParagraphStyle("Caption", fontName="FreeSerif-Italic", fontSize=8.5, leading=11.5,
                              textColor=TEXT_MUTED, alignment=TA_CENTER, spaceBefore=3, spaceAfter=6)
S["th"] = ParagraphStyle("TH", fontName="FreeSerif", fontSize=9, leading=12,
                         textColor=colors.white, alignment=TA_LEFT)
S["td"] = ParagraphStyle("TD", fontName="FreeSerif", fontSize=9, leading=12.5,
                         textColor=TEXT_PRIMARY, alignment=TA_LEFT)
S["td_mono"] = ParagraphStyle("TDm", fontName="FreeSerif", fontSize=9, leading=12.5,
                              textColor=TEXT_PRIMARY, alignment=TA_LEFT)
S["callout"] = ParagraphStyle("Callout", fontName="FreeSerif", fontSize=10, leading=15,
                              textColor=TEXT_PRIMARY, spaceAfter=0)
S["toc0"] = ParagraphStyle("TOC0", fontName="FreeSerif-Bold", fontSize=11.5, leading=18,
                           textColor=TEXT_PRIMARY, leftIndent=0)
S["toc1"] = ParagraphStyle("TOC1", fontName="FreeSerif", fontSize=9.5, leading=14.5,
                           textColor=TEXT_PRIMARY, leftIndent=18)

# --------------------------------------------------------------- helpers ---
story = []


def h1(text, key_suffix=""):
    """Chapter heading with TOC bookmark (level 0) + orphan prevention."""
    key = "h_" + hashlib.md5((text + key_suffix).encode()).hexdigest()[:8]
    p = Paragraph(f'<a name="{key}"/><b>{text}</b>', S["h1"])
    p.bookmark_name = key
    p.bookmark_level = 0
    p.bookmark_text = text
    p.bookmark_key = key
    story.append(CondPageBreak(AVAIL_H * 0.25))
    story.append(p)
    _rule = Table([[""]], colWidths=[AVAIL_W], rowHeights=[2])
    _rule.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1.2, ACCENT),
                               ("TOPPADDING", (0, 0), (-1, -1), 0),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(_rule)
    story.append(Spacer(1, 8))


def h2(text):
    key = "h_" + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph(f'<a name="{key}"/><b>{text}</b>', S["h2"])
    p.bookmark_name = key
    p.bookmark_level = 1
    p.bookmark_text = text
    p.bookmark_key = key
    story.append(CondPageBreak(70))
    story.append(p)


def h3(text):
    story.append(Paragraph(f"<b>{text}</b>", S["h3"]))


def body(text):
    story.append(Paragraph(text, S["body"]))


def bullets(items):
    for it in items:
        story.append(Paragraph(f"• {it}", S["bullet"]))
    story.append(Spacer(1, 4))


def steps(items):
    for i, it in enumerate(items, 1):
        story.append(Paragraph(f"<b>{i}.</b> {it}", S["step"]))
    story.append(Spacer(1, 4))


_fig_no = [0]


def shot(png, caption, max_h=250):
    """Screenshot flowable: border + image + numbered caption, kept together."""
    _fig_no[0] += 1
    path = os.path.join(SHOTS, png)
    im = PILImage.open(path)
    ow, oh = im.size
    ratio = min(AVAIL_W / ow, max_h / oh, 1.0)
    img = Image(path, width=ow * ratio, height=oh * ratio)
    frame = Table([[img]], colWidths=[ow * ratio + 6])
    frame.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.75, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(KeepTogether([
        Spacer(1, 6),
        frame,
        Paragraph(f"Figure {_fig_no[0]}. {caption}", S["caption"]),
    ]))
    story.append(Spacer(1, 4))


def table(headers, rows, ratios=None, caption=None):
    """Standard striped table. All cells wrapped in Paragraph."""
    ncols = len(headers)
    if ratios is None:
        ratios = [1.0 / ncols] * ncols
    widths = [r * AVAIL_W for r in ratios]
    assert abs(sum(widths) - AVAIL_W) < 1.0, "table width mismatch"
    data = [[Paragraph(f"<b>{h}</b>", S["th"]) for h in headers]]
    for r in rows:
        data.append([Paragraph(str(c), S["td"]) for c in r])
    t = Table(data, colWidths=widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for i in range(1, len(data)):
        style.append(("BACKGROUND", (0, i), (-1, i),
                      TABLE_ROW_ODD if i % 2 == 0 else TABLE_ROW_EVEN))
    t.setStyle(TableStyle(style))
    story.append(Spacer(1, 8))
    if caption:
        cap = Paragraph(caption, S["caption"])
        if len(rows) <= 12:
            story.append(KeepTogether([t, cap]))
        else:
            story.append(t)
            story.append(cap)
    else:
        story.append(t)
    story.append(Spacer(1, 8))


def callout(text, title=None):
    """Accent-bordered callout box."""
    inner = []
    if title:
        inner.append(Paragraph(f"<b>{title}</b>", S["callout"]))
        inner.append(Spacer(1, 3))
    inner.append(Paragraph(text, S["callout"]))
    box = Table([[inner]], colWidths=[AVAIL_W * 0.96])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("LINEBEFORE", (0, 0), (0, -1), 3, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(Spacer(1, 6))
    story.append(KeepTogether(box))
    story.append(Spacer(1, 8))


# ------------------------------------------------------------ doc + page ---
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            self.notify("TOCEntry", (level, text, self.page, key))


def on_page(canvas, doc):
    canvas.saveState()
    # header
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, PAGE_H - 0.55 * inch, "SERVICTRO USER MANUAL")
    canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 0.55 * inch, "v0.1 · demo environment")
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(MARGIN, PAGE_H - 0.62 * inch, PAGE_W - MARGIN, PAGE_H - 0.62 * inch)
    # footer
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 0.62 * inch, PAGE_W - MARGIN, 0.62 * inch)
    canvas.setFont("FreeSerif", 7.5)
    canvas.drawString(MARGIN, 0.45 * inch, "Servictro — After-Sales Service & Asset Operations")
    canvas.drawRightString(PAGE_W - MARGIN, 0.45 * inch, str(doc.page))
    canvas.restoreState()


# ============================================================ TOC page ====
toc = TableOfContents()
toc.levelStyles = [S["toc0"], S["toc1"]]
toc.dotsMinLevel = 0
story.append(Paragraph("<b>Table of Contents</b>",
                       ParagraphStyle("TOCTitle", parent=S["h1"], spaceBefore=4)))
story.append(Spacer(1, 10))
story.append(toc)
story.append(PageBreak())

# ===================================================== 1 · Product overview
h1("1. Product Overview")
body("Servictro is a multi-tenant after-sales service and asset operations platform for "
     "companies that install and maintain electrical equipment — LT panels, HT switchgear, "
     "VCB panels, transformers and similar industrial assets. It replaces spreadsheets and "
     "messaging-app coordination with one auditable system that follows every unit you "
     "shipped from registration through breakdown calls, preventive maintenance visits, "
     "checklist execution and contract renewal.")
body("The workspace in this manual runs the Servictro v0.1 demo environment with seed data "
     "for the tenant <b>GridNova Systems Pvt. Ltd.</b> — a switchgear service organisation "
     "with four team members, three in-service assets across two customer sites, three "
     "service requests, three work orders, two contracts and one active preventive "
     "maintenance plan. A second tenant, <b>Voltline Power</b>, exists in the same database "
     "to demonstrate row-level tenant isolation: identical asset codes in both tenants never "
     "leak across workspaces.")
body("Every concept in Servictro connects to a physical reality. An <b>asset</b> is a real "
     "panel in a real switchroom. A <b>service request</b> is a customer phone call about "
     "that panel. A <b>work order</b> authorises a technician to travel to the site. A "
     "<b>checklist</b> captures what was measured and observed at the panel, and a "
     "<b>service report</b> hands the outcome back to the customer. Contracts and PM plans "
     "turn one-off repairs into recurring, revenue-bearing maintenance.")

h2("1.1 Key capabilities")
bullets([
    "<b>Asset register</b> — every panel with nameplate data, commissioning date, warranty and AMC status, and a printable QR nameplate.",
    "<b>Service desk</b> — log requests from phone, email, portal, WhatsApp, walk-in or internal review; triage severity; convert to work orders.",
    "<b>Work order lifecycle</b> — draft to closed across nine enforced statuses, with assignment offers, SLA clocks, hold/cancel reasons and review gates.",
    "<b>Field execution</b> — technician job packs with checklists, electrical measurements (µΩ, MΩ), observations, parts used and customer acknowledgement.",
    "<b>Contracts and coverage</b> — warranty, AMC and service contracts per asset with coverage types; entitlement checks read exactly this data.",
    "<b>Preventive maintenance</b> — recurring PM plans that generate scheduled visits and draft work orders automatically via a background worker.",
    "<b>Analytics</b> — live dashboard aggregates, SLA attainment, technician workload and renewal pipeline computed from real data.",
    "<b>Governance</b> — role-based access for seven roles, tamper-evident audit log of every privileged mutation, rate-limited and audit-logged sign-ins.",
    "<b>Field resilience</b> — installable PWA; the My jobs pack caches to the device so technicians can execute offline and sync when connectivity returns.",
])

h2("1.2 Who this manual is for")
body("Every persona in a service organisation will find its workflow here: owners and "
     "service managers run the dashboard, team and settings; coordinators run intake, "
     "triage, scheduling and assignment; technicians run My jobs and field execution; "
     "contract admins track coverage and renewals; auditors read everything and write "
     "nothing. Chapter 3 covers each module in depth, Chapter 4 walks the four core "
     "workflows end-to-end, and Chapter 5 maps the exact permissions each role carries in "
     "this release. All screenshots were captured from the live running application — "
     "nothing in this manual is mocked up.")

# =========================================== 2 · Getting started & navigation
h1("2. Getting Started and Navigation")

h2("2.1 Signing in")
body("Open the application URL (the demo runs at <b>http://localhost:3000</b>). The sign-in "
     "page is split in two: a navy brand panel describing the platform, and a workspace "
     "sign-in form. Enter the work email your team invited you with and your password, "
     "then press <b>Sign in</b>. Failed attempts are rate-limited (ten sign-in attempts "
     "per minute per source) and every attempt — successful or not — is written to the "
     "audit log with actor, time and request id.")
shot("01-login.png",
     "The Servictro sign-in page: brand panel on the left, workspace sign-in form on the "
     "right, and one-click demo accounts at the bottom.", max_h=238)
body("If you were invited but have no password yet, press <b>Create account</b> under the "
     "form and sign up with exactly the email address the invitation was sent to — the "
     "invitation token links your new user to the workspace. In the demo environment the "
     "OR EXPLORE THE DEMO section signs you straight in as a GridNova owner, technician "
     "or Voltline owner so you can tour the product without setting up credentials.")

h2("2.2 Workspaces and tenant switching")
body("A single email can belong to more than one organisation — the demo owner account, "
     "for example, is a member of both GridNova Systems and Voltline Power. After sign-in "
     "the header shows the current workspace next to the logo. Press it to open the "
     "workspace switcher and jump between tenants; each switch reloads your permissions "
     "and data scope. Data never crosses tenants: the database enforces row-level "
     "security under every query, so switching is the only way to see another tenant's "
     "records.")

h2("2.3 The sidebar")
body("Navigation lives in the navy sidebar on the left, grouped into five sections: "
     "<b>Overview</b> (Dashboard, My jobs), <b>Service operations</b> (Service requests, "
     "Work orders), <b>Installed base</b> (Customers, Sites, Assets), <b>Coverage & "
     "maintenance</b> (Contracts, PM plans & visits, Checklist templates) and "
     "<b>Workspace</b> (Team, Audit log, Settings). The items you see depend on your "
     "role's permissions — a technician sees only My jobs, requests, work orders, assets "
     "and checklists, while an owner sees everything.")
body("Press the collapse control at the top of the sidebar to shrink it into a narrow "
     "icon rail that maximises working space; press it again to expand. The collapsed "
     "state is remembered per browser, and hovering an icon shows its label so "
     "navigation stays unambiguous either way.")
shot("18-sidebar-collapsed.png",
     "The sidebar collapsed to its icon rail. The active module keeps its accent "
     "highlight; hover reveals the label.", max_h=205)

h2("2.4 Top bar, notifications and account menu")
body("The top bar carries the page title on the left and three controls on the right: the "
     "notifications bell, your account chip and the workspace switcher. The bell shows an "
     "unread count badge; opening it lists events such as generated PM visits, assignment "
     "offers and report status changes, with a <b>Mark all read</b> action and a per-item "
     "mark-read control. The account menu shows your role, links to Notifications and "
     "Workspace settings, and signs you out.")
shot("26-notifications-panel.png",
     "The notifications popover: unread items are tinted, each carries a timestamp, and "
     "Mark all read clears the badge.", max_h=215)
body("Keyboard note: the notifications area announces the toast hotkey F8 to assistive "
     "technology; this comes from the underlying toast component and is not an "
     "application-wide shortcut in this release.")

h2("2.5 Conventions used across modules")
bullets([
    "<b>Tables</b> — every list is a data table with sortable columns (press a column header to sort), a search box and dropdown filters above it.",
    "<b>Right-side drawers</b> — creation and edit forms open as drawers sliding in from the right edge, keeping the list visible underneath. Press Escape or the × to close.",
    "<b>Status badges</b> — colour-coded pills: green for healthy/active, blue for informational, amber for attention, red for danger, grey for neutral.",
    "<b>Detail pages</b> — lists link to detail pages with a breadcrumb back to the list, cards for context (status, SLA, customer, asset) and a full activity trail.",
    "<b>Permission gating</b> — buttons you lack permission for are hidden, not disabled; the API enforces the same permissions server-side regardless of what the UI shows.",
])

# ==================================== 3 · Module-by-module reference
h1("3. Module and Feature Reference")
body("This chapter documents every user-facing module in the application: what it is for, "
     "what its screens contain, and which actions are available. Modules are presented in "
     "sidebar order. Screenshots come from the GridNova Systems demo tenant with its "
     "seeded data, captured live from the running application.")

h2("3.1 Dashboard")
body("The dashboard is the default landing page for any role with analytics access. It "
     "answers \"what needs attention today\" in one screen: eight KPI cards, a service "
     "volume chart, technician workload, requests by status and shortcuts into the "
     "workflow. A refresh button re-computes the aggregates; the header notes how long "
     "ago the numbers were generated.")
table(
    ["KPI card", "What it shows", "Attention cue"],
    [
        ["Open requests", "Requests not yet closed, with how many are new awaiting triage", "Hint line turns amber when triage queue is non-empty"],
        ["Open work orders", "Work orders in flight; completions in the last 30 days as hint", "none"],
        ["Overdue work orders", "Work orders past their resolution due time", "Red tone when > 0"],
        ["SLA attainment (30d)", "Share of work orders resolved within SLA, plus average resolution hours", "Green at 90%+, amber below"],
        ["PM visits due (30d)", "Scheduled preventive visits in the next 30 days", "none"],
        ["Contracts expiring (90d)", "Contracts ending within 90 days — the renewal pipeline", "Amber when > 0"],
        ["Assets in service", "Active assets, and what share has complete nameplate data", "none"],
        ["New awaiting triage", "Requests still in NEW status", "Amber until the intake queue is clear"],
    ],
    ratios=[0.24, 0.46, 0.30],
    caption="Dashboard KPI cards and how to read them.")
body("Below the KPIs, the <b>Service volume</b> chart plots requests logged and work "
     "orders closed per day over the last 30 days; <b>Technician workload</b> counts open "
     "assignments per technician so you can balance dispatch; <b>Requests by status</b> "
     "breaks the intake funnel down; and <b>Jump to workflow</b> links straight into the "
     "high-frequency tasks (log a request, create a work order, review PM visits).")
shot("02-dashboard.png",
     "The Service dashboard: eight KPI cards, service volume chart, technician workload "
     "and requests-by-status breakdown.", max_h=240)

h2("3.2 My jobs (technician field pack)")
body("My jobs is the technician's home screen — the only Overview item guaranteed for "
     "field roles. It lists the work orders assigned to you (offer, accepted or active "
     "status) with priority, SLA clocks and site access instructions, and it doubles as "
     "the offline pack: a <b>Refresh pack</b> button pulls the latest job data into "
     "device storage so the list, work order details, checklists and customer data stay "
     "readable without connectivity. Observations and measurements recorded offline are "
     "queued locally and sync automatically when the network returns — the "
     "synchronization card shows connection state and pending item count.")
shot("21-tech-my-jobs.png",
     "My jobs as the technician sees it: assigned jobs with SLA clocks, quick capture "
     "buttons, and the offline synchronization card.", max_h=235)
body("Each job card links to the full execution view (section 3.4) and offers quick "
     "actions — start work, record an observation, record a measurement — so short "
     "updates do not require opening the whole work order. Supervisors with no field "
     "assignments see an empty pack; that is expected, as My jobs is scoped to personal "
     "assignments.")

h2("3.3 Service requests")
body("The service desk. Every inbound issue — a phone call about a tripping feeder, an "
     "email requesting an inspection — becomes a request row with a unique number "
     "(SR-YYYY-NNNNNN), customer, site and optional asset, source, category, severity, "
     "coverage verdict and status. The list offers full-text search across subject and "
     "request number plus status and severity filters; any row opens the request detail "
     "page.")
shot("requests.png",
     "The Service requests list: search, status and severity filters, and one-click Log "
     "request.", max_h=225)
table(
    ["Element", "Values / behaviour"],
    [
        ["Sources", "Phone · Email · Portal · WhatsApp · Walk-in · Internal"],
        ["Categories", "Breakdown · Tripping · Overheating · Abnormal sound · Preventive visit · Inspection · Retrofit · Spares · Documentation · Other"],
        ["Severities", "Low · Medium · High · Critical (drive the SLA clocks)"],
        ["Request statuses", "New → Triaged → Accepted → Converted; or Needs information / Rejected / Closed"],
    ],
    ratios=[0.22, 0.78],
    caption="Request intake vocabulary as implemented in this release.")
body("Press <b>Log request</b> to open the creation drawer. Customer, site and asset "
     "cascade — the site dropdown stays disabled until a customer is chosen, and the "
     "asset dropdown until a site is chosen — then set source, category, severity, "
     "subject and description. Severity is not a formality: it selects the tenant's SLA "
     "response and resolution targets that later snap onto the work order.")
shot("15-request-drawer.png",
     "The Log service request drawer: cascading customer → site → asset selectors and "
     "severity-driven SLA.", max_h=238)
body("The detail page (open any row) shows the reported issue, the triage actions, "
     "linked work orders and the full request activity. <b>Triage / adjust severity</b> "
     "qualifies the request; <b>Accept</b> commits to acting on it; <b>Request "
     "information</b> sets needs-information and waits for the customer; <b>Reject</b> "
     "records a reason. When the request is accepted, <b>Convert to work order</b> opens "
     "the conversion drawer described in workflow A (chapter 4.1).")
shot("16-request-detail.png",
     "Request detail for SR-2026-000001: reported issue, triage actions and the "
     "convert-to-work-order path.", max_h=225)

h2("3.4 Work orders and field execution")
body("Work orders are the dispatchable unit of work. The list shows WO-YYYY-NNNNNN "
     "numbers, type (breakdown, preventive, installation, commissioning, inspection, "
     "retrofit), priority (low, normal, high, urgent), status, resolution due time and "
     "assigned team; overdue rows are flagged in red with how long past due. Filters "
     "cover status and type, and <b>Create work order</b> opens a drawer mirroring the "
     "request form plus a scheduled window and comma-separated required skills that "
     "drive assignment matching.")
shot("work-orders.png",
     "The Work orders list with type/priority/status badges, overdue flagging and "
     "filters.", max_h=225)
table(
    ["Status", "Meaning", "Allowed next steps"],
    [
        ["Draft", "Being prepared; not yet dispatchable", "Ready, Cancelled"],
        ["Ready", "Prepared, awaiting scheduling", "Scheduled, Cancelled"],
        ["Scheduled", "Window fixed and team invited", "In progress, On hold, Cancelled"],
        ["In progress", "Technician is on site executing", "Pending review, On hold, Cancelled"],
        ["On hold", "Blocked (parts, customer shutdown window…)", "Scheduled, Cancelled"],
        ["Pending review", "Execution done; awaiting supervisor review", "Completed, In progress, Cancelled"],
        ["Completed", "Reviewed and confirmed", "Closed, Pending review"],
        ["Closed", "Financially and contractually settled", "None (terminal)"],
        ["Cancelled", "Abandoned with a recorded reason", "None (terminal)"],
    ],
    ratios=[0.16, 0.44, 0.40],
    caption="Work order lifecycle as enforced by the transitions engine.")
body("The detail page carries the whole story: status/priority/type badges, required "
     "skills, SLA response and resolution clocks, customer and site card with access "
     "instructions, asset card, assigned team, the checklist, measurements, observations, "
     "parts used, customer acknowledgement, generated service reports and the activity "
     "trail. Owners and managers additionally see the <b>Assign</b> button and the "
     "transition buttons for the allowed next steps; cancelling or holding always "
     "requires a reason, and scheduling requires the window date.")
shot("17b-wo-detail-assigned.png",
     "Work order detail (assigned, in progress): status strip, SLA clocks, context "
     "cards, execution sections and the full action bar.", max_h=240)
body("The <b>Assign</b> drawer picks a team member and an assignment role (technician, "
     "supervisor, observer). Assignment is an <i>offer</i>: the technician sees the job "
     "in My jobs with status offered and accepts it from there. Assignments can be "
     "rejected, which frees the work order for re-assignment — the seed data's Sunil "
     "Kadam (skills: LT panels, ACB, HT switchgear, VCB) is the demo's field engineer.")
shot("19-assign-drawer.png",
     "The Assign drawer: team member and assignment role. Assignment is an offer the "
     "technician accepts in My jobs.", max_h=225)
body("For the assigned technician the same page is the execution view. The checklist "
     "section renders the active template version — the demo's HT VCB half-yearly "
     "maintenance lists pole contact resistance (µΩ), insulation resistance (MΩ), "
     "interrupter integrity, spring-charged mechanism count, secondary injection test "
     "and CT/PT wiring tightness. Required items need a definite outcome — pass, fail, "
     "N/A — or an exception with a reason before the work order can leave in-progress. "
     "Measurement items add numeric capture against the template's unit and range.")
shot("23-tech-checklist.png",
     "Field execution — checklist capture: measurement inputs with units, outcome "
     "selectors and required-item flags.", max_h=235)
body("Measurements, observations and parts each open their own drawer from the "
     "corresponding section: measurements suggest keys from the template definition and "
     "store value plus unit; observations record what was seen with optional severity; "
     "parts record quantity and part reference. When execution is done, the technician "
     "captures <b>customer acknowledgement</b> (signature or named confirmation), and "
     "the supervisor path takes over: review, complete, then generate and publish the "
     "service report from the <b>Service reports</b> section.")
shot("24-measurement-drawer.png",
     "The Record measurement drawer with template-suggested measurement keys.", max_h=225)

h2("3.5 Customers")
body("The customers list is the CRM spine: account code, name, segment, status, site "
     "count, contract count and registration date. Search matches names and codes; the "
     "status filter separates active from inactive and archived accounts. Creating a "
     "customer captures legal name, billing details and segment; the detail page rolls "
     "up everything the account touches — sites, assets, contracts, requests and work "
     "orders — so account reviews never require cross-module searches.")
shot("customers.png",
     "Customers list with site and contract roll-up counts per account.", max_h=215)

h2("3.6 Sites")
body("Sites are the physical locations field teams travel to — the demo's Bhosari plant "
     "and Kharaadi weaving unit for customer Shakti Cement Industries Ltd. The list "
     "shows site code, name, owning customer, address, timezone and status; a site's "
     "timezone matters because analytics bucket timestamps per site. Site detail "
     "includes access instructions which surface on the technician's work order card, "
     "so anything a visiting engineer must know before arrival (gate procedure, "
     "safety officer contact, PPE requirements) belongs here. Sites can also be opened "
     "filtered to a single customer via the customer page.")
shot("sites.png",
     "Sites list: code, customer, address, timezone and status per location.", max_h=215)

h2("3.7 Asset register")
body("Assets are the installed base every other module hangs from. Each asset carries "
     "an AST-NNNNNN code, serial number, family (LT panel, HT switchgear, VCB panel, "
     "RMU, PCC, MCC, APFC, busduct, transformer, other), model, site, commissioning "
     "date and status (active, inactive, decommissioned). The list filters by family "
     "and status; registering an asset opens a drawer with nameplate fields — "
     "manufacturer, model, rating fields per family, incoming/outgoing feeder counts — "
     "and the asset detail page shows full nameplate data, warranty and AMC coverage, "
     "linked documents and its complete service history across requests, work orders "
     "and PM visits.")
body("Every asset has a printable <b>QR nameplate</b>: the detail page generates a QR "
     "code (served as SVG) that encodes the asset's identity, so a technician arriving "
     "at a panel scans the sticker and jumps straight to that asset's record and "
     "history. This is also the practical link between the physical world and the "
     "register: nameplate completeness is tracked on the dashboard for exactly this "
     "reason.")
shot("assets.png",
     "The Asset register: family and status filters over the three GridNova demo "
     "assets.", max_h=215)

h2("3.8 Contracts")
body("Contracts define what is covered and for how long: warranty, AMC (annual "
     "maintenance contract) or one-off service, each with contract number "
     "CTR-YYYY-NNNNNN, customer, start/end dates, status (draft, active, expired, "
     "terminated, renewed) and value in the workspace currency. The list header adds a "
     "<b>renewal pipeline</b> card flagging at-risk contracts — in the demo, the Shakti "
     "Cement AMC worth ₹18,000 ending 20 January 2027 is flagged as due soon — with "
     "filters for type, status and renewal state (not due, due soon, in progress, "
     "renewed, lost).")
body("Contract detail carries three cards that matter operationally: <b>Terms</b> "
     "(dates, value, coverage defaults), <b>Covered assets</b> — the per-asset coverage "
     "type list (full, labour only, inspection only, parts only) that entitlement "
     "checks read exactly — and <b>Linked PM plans</b> showing which maintenance "
     "recurrences the contract pays for. Renewal tracking records owner and next "
     "action so the pipeline never silently lapses.")
shot("contracts.png",
     "Contracts with the renewal pipeline card flagging the AMC that ends within 90 "
     "days.", max_h=225)

h2("3.9 PM plans and visits")
body("Preventive maintenance turns contracts into schedules. A PM plan is a named "
     "recurrence — the demo's PM-SHAKTI-Q is a quarterly LT panel plan — with plan "
     "code, asset family, recurrence (week, month, quarter, half-year, year), start "
     "date, contract linkage and status (draft, active, paused, archived). The visits "
     "table below the plans lists every generated <b>planned visit</b> with due date "
     "and status (pending, scheduled, skipped, done, cancelled).")
body("Visits are generated two ways: press <b>Generate visits</b> on an active plan to "
     "materialise the next due visit and its draft work order immediately, or wait for "
     "the scheduled background worker run, which does the same automatically (the "
     "notifications card \"2 PM visits generated — 1 draft work order ready for "
     "scheduling\" in the demo came from exactly this worker). Generated visits appear "
     "as draft work orders that coordinators schedule like any other — the PM engine "
     "deliberately stops at draft so humans stay in control of dispatch.")
shot("maintenance.png",
     "PM plans and visits: plan recurrences above, generated visit schedule below.",
     max_h=225)

h2("3.10 Checklist templates")
body("Checklist templates standardise what \"maintaining\" means per asset family. The "
     "list shows template key, name, item count and active version; opening one shows "
     "the active definition — every item with its type (check, measurement, "
     "informational), required flag, unit and expected range for measurements — plus "
     "the version history. Templates version immutably: publishing a new version never "
     "rewrites history, because work orders reference the specific version they "
     "executed (the demo shows LT panel quarterly PM v1 and HT switchgear half-yearly "
     "maintenance v1). This is what makes a two-year-old service report reproducible "
     "in an audit.")
shot("checklists.png",
     "Checklist templates with versioned, immutable definitions per asset family.",
     max_h=215)

h2("3.11 Team")
body("The team list shows every member with role, title, skills, membership status and "
     "join date. Roles follow the RBAC catalog (chapter 5); technician skills drive "
     "the assignment matching introduced in 3.4, so keeping them current directly "
     "improves dispatch suggestions. Owners and admins can invite new members by email "
     "— the invitation carries a one-time accept token, and the invited user signs up "
     "with exactly that email. Pending invitations are listed with status (pending, "
     "accepted, expired, revoked) and can be revoked until accepted. Email delivery is "
     "a production integration not enabled in this demo (ADR-011): invitations are "
     "created in-app, and the accept link is handed to the user out of band.")
shot("team.png",
     "The Team list with roles, skills and pending invitations card.", max_h=225)

h2("3.12 Audit log")
body("Every privileged mutation (sign-ins, triage decisions, transitions, "
     "assignments, invitations and settings changes) is written to the audit log with actor, "
     "action, resource, request id, reason where applicable and a metadata snapshot. "
     "The log reads newest-first with filters by action and resource type, and the "
     "detail column surfaces the first metadata entries inline. The trail is "
     "tamper-evident by design: entries are append-only, and the request id "
     "cross-references API logs. Typical uses: \"who changed this severity?\", \"who "
     "cancelled WO-2026-000002 and why?\", \"when was the invitation revoked?\".")
shot("audit.png",
     "The Audit log: every privileged mutation with actor, action and detail.",
     max_h=215)

h2("3.13 Workspace settings")
body("Settings has three cards. <b>Organization</b> edits the workspace name, legal "
     "name, default timezone, locale and currency (currency applies to contract "
     "values). <b>SLA defaults</b> shows the response and resolution targets per "
     "severity that snap onto new work orders — in the demo: critical 60/480 minutes, "
     "high 120/1440, medium 240/2880, low 480/4320 — with the note that contracts "
     "override these when they set their own. <b>Environment</b> documents what this "
     "deployment includes: plan, tenant status, PostgreSQL row-level security for "
     "isolation, in-app notifications only, local private file storage and the "
     "installable PWA. Only owners and admins can save changes; everyone else sees "
     "the page read-only.")
shot("settings.png",
     "Workspace settings: organization identity, SLA defaults per severity and the "
     "environment card.", max_h=225)

# ================================================= 4 · Workflow guides
h1("4. Step-by-Step Workflow Guides")
body("Four workflows cover the daily rhythm of a service organisation. Each guide "
     "names the module, the permission required, the exact clicks and what you should "
     "see when it works. All steps were executed against the live demo tenant while "
     "writing this manual.")

h2("4.1 Workflow A — from customer call to dispatched work order")
body("<i>Typical actor: coordinator or service manager (requests:write, "
     "requests:triage, requests:convert, work_orders:write).</i>")
steps([
    "In <b>Service requests</b>, press <b>Log request</b>. The drawer slides in from the right.",
    "Pick the <b>customer</b>; the site list unlocks. Pick the <b>site</b>; the asset list unlocks. Select the affected asset if known — it links the request to the equipment's history.",
    "Set <b>source</b> (e.g. Phone), <b>category</b> (e.g. Tripping), <b>severity</b> (e.g. High) and write a subject plus description that a technician could act on. Severity sets the SLA clocks, so judge it honestly.",
    "Press <b>Log request</b>. The drawer closes and the new SR-2026-NNNNNN appears in the list with status <b>New</b>.",
    "Open the request. In <b>Triage actions</b>, press <b>Triage / adjust severity</b> if the first assessment needs correcting, then <b>Accept</b> to commit. The status moves to Accepted.",
    "Press <b>Convert to work order</b>. Review the carried-over customer, site and asset; choose the coverage verdict — if the asset is not under contract, enter a <b>coverage reason</b> (e.g. \"goodwill visit pending AMC signing\") so the audit trail explains why a non-covered job was dispatched.",
    "Press <b>Convert</b>. The work order is created in <b>Draft</b> and linked back on the request page under Work orders; the request status becomes Converted.",
    "Continue in Workflow B to schedule and assign the new work order.",
])
callout("The coverage field on the request list reads directly from contract entitlement. "
        "An em-dash means no contract covers that asset for the request's date — convert "
        "with a reason, or fix coverage in Contracts first.",
        title="Why the Coverage column shows —")

h2("4.2 Workflow B — scheduling, assigning and reviewing a work order")
body("<i>Typical actor: coordinator or service manager (work_orders:assign, "
     "work_orders:transition, work_orders:review).</i>")
steps([
    "In <b>Work orders</b>, open the draft created in Workflow A (or press <b>Create work order</b> to raise one directly, adding the scheduled window and required skills such as \"HT switchgear, VCB\").",
    "Move the status <b>Draft → Ready</b> with the transition button — this marks it prepared for dispatch.",
    "Press <b>Assign</b>. In the drawer, select the team member (the list offers technicians, service managers and coordinators) and the assignment role, then confirm. The assignment is an <b>offer</b> that appears in the technician's My jobs.",
    "Move <b>Ready → Scheduled</b>; the transition asks for the scheduled start window. The technician accepts the offer from My jobs (assignment status Offered → Accepted).",
    "When the technician is on site they move the order to <b>In progress</b> themselves and execute per Workflow C.",
    "When execution completes the technician sets <b>Pending review</b>. Review the checklist outcomes, measurements, observations, parts and acknowledgement on the detail page.",
    "Approve with <b>Completed</b>, or send it back to <b>In progress</b> with a reason if the work is not actually done. Then press <b>Generate</b> in the Service reports section to draft the customer report, and publish it when correct.",
    "Close the work order once billing/reconciliation is settled. <b>Closed</b> is terminal.",
])
callout("Cancelling or putting a work order on hold always requires a typed reason — "
        "\"duplicate of WO-…\", \"waiting on customer shutdown window\" — and the reason "
        "lands in both the work order activity and the audit log.",
        title="Reasons are first-class")

h2("4.3 Workflow C — technician field execution")
body("<i>Typical actor: technician (work_orders:execute, on ASSIGNED jobs only).</i>")
steps([
    "Sign in; you land on <b>My jobs</b> (technicians do not see the dashboard). If you expect poor connectivity on the road, press <b>Refresh pack</b> first so the device caches your jobs.",
    "Review the job card: priority, SLA clocks, site access instructions and the asset you are attending. Press <b>Start work</b> when on site; the work order moves to In progress.",
    "Work through the <b>checklist</b>. Required items need pass, fail or N/A — or an exception with a reason. Measurement items capture the numeric value against the template unit (µΩ, MΩ…); out-of-range values are your cue to investigate, not to guess.",
    "Record <b>measurements</b> (the drawer suggests the keys your template defines), <b>observations</b> (anything noteworthy, with severity) and <b>parts used</b> (quantity and reference) as you go. Offline, these queue in device storage and sync when connectivity returns — the synchronization card shows pending counts.",
    "Capture <b>customer acknowledgement</b> — signature or confirmed name — before leaving site. Work orders cannot leave the review gate without it.",
    "Set the work order to <b>Pending review</b>. Your supervisor reviews and completes it; the generated service report is what the customer receives.",
])
shot("22-tech-wo-execution.png",
     "The technician's execution view: status strip, SLA clocks, site access "
     "instructions and assigned team before the checklist.", max_h=235)

h2("4.4 Workflow D — preventive maintenance round")
body("<i>Typical actors: contract admin or service manager (maintenance:manage), then "
     "the coordinator for dispatch.</i>")
steps([
    "In <b>PM plans & visits</b>, confirm the plan is Active and its contract linkage is correct (visits are only as valid as the contract paying for them).",
    "Press <b>Generate visits</b> on the plan, or wait for the background worker's scheduled run — either way the visit appears in the visits table with its due date and a draft work order is created.",
    "Open the draft work order, assign the technician and schedule the window exactly as in Workflow B. The PM work order arrives with its checklist template pre-attached (e.g. LT Panel — Quarterly Preventive Maintenance).",
    "The technician executes it as Workflow C. On completion the visit status flips to Done.",
    "Watch the dashboard's <b>PM visits due (30d)</b> card and the renewal pipeline in Contracts: recurring PM delivered on time is the strongest argument at AMC renewal time.",
])
callout("The PM engine intentionally stops at draft work orders. Nothing is dispatched "
        "automatically — a human schedules every visit, so an unexpected plant shutdown "
        "never triggers an unattended field job.",
        title="Humans stay in the loop")

# ============================================ 5 · Roles and permissions
h1("5. User Roles and Permissions")
body("Access control is role-based with default-deny semantics: a role not listed for "
     "a permission does not have it, and the API enforces every permission "
     "server-side — the UI merely hides what you could not use anyway. Seven roles "
     "ship in this release. The table shows exactly which modules each role can open "
     "(read) and where it can act (write/manage).")
table(
    ["Role", "Intended for", "Distinctive access"],
    [
        ["Owner", "The business head; full control of the workspace", "Everything, including tenant settings (tenant:manage) and team management"],
        ["Admin", "Day-to-day workspace administration", "Same permission set as owner"],
        ["Service manager", "Running the service operation", "All operations modules and analytics; no tenant settings"],
        ["Coordinator", "Service desk and dispatch", "Intake, triage, convert, assign and transition; no analytics, no team, no audit"],
        ["Technician", "Field execution", "My jobs, own assignments, checklists, read-only requests/assets/reports; execution limited to ASSIGNED jobs"],
        ["Contract admin", "Coverage and renewal desk", "Contracts and PM manage, asset QR printing, analytics; no work order writes"],
        ["Auditor", "Read-only assurance", "Everything readable including the audit log; writes nothing"],
    ],
    ratios=[0.15, 0.32, 0.53],
    caption="The seven RBAC roles as implemented in this release.")
body("The sidebar reflects this directly: signing in as the GridNova technician shows "
     "only My jobs, Service requests, Work orders, Assets, Checklist templates and "
     "Contracts; the coordinator additionally sees Customers, Sites and PM plans but "
     "no Dashboard, Team, Audit log or Settings. Where a role lacks a module, "
     "deep-linking to it shows an explicit \"Not available with your role\" page "
     "rather than a broken screen.")
shot("25-coordinator-requests.png",
     "The coordinator's navigation: service operations and installed base without "
     "dashboard, team, audit or settings entries.", max_h=225)
body("Two nuances matter in practice. First, <i>work_orders:execute</i> is scoped: "
     "technicians act only on work orders assigned to them, regardless of the broad "
     "read permission. Second, <i>audit:read</i> is deliberately separated from "
     "operational roles — coordinators generate audit events all day but cannot read "
     "the log; only owner, admin, service manager and auditor can.")

h3("5.1 Permission matrix (as implemented)")
_perm_rows = [
    ["Tenant settings / team manage", "●", "●", "none", "none", "none", "none", "none"],
    ["Audit log read", "●", "●", "●", "none", "none", "none", "●"],
    ["Customers / sites / assets write", "●", "●", "●", "●", "none", "none", "none"],
    ["Asset QR print", "●", "●", "●", "●", "none", "●", "none"],
    ["Requests: triage / convert", "●", "●", "●", "●", "none", "none", "none"],
    ["Work orders: assign / transition", "●", "●", "●", "●", "none", "none", "none"],
    ["Work orders: review", "●", "●", "●", "none", "none", "none", "none"],
    ["Work orders: execute (own)", "●", "●", "●", "●", "●", "none", "none"],
    ["Checklist manage", "●", "●", "●", "none", "none", "none", "none"],
    ["Contracts manage", "●", "●", "none", "none", "none", "●", "none"],
    ["PM plans manage", "●", "●", "●", "none", "none", "●", "none"],
    ["Reports publish", "●", "●", "●", "none", "none", "●", "none"],
    ["Analytics read", "●", "●", "●", "none", "none", "●", "●"],
]
table(
    ["Capability", "Owner", "Admin", "Svc mgr", "Coord", "Tech", "Ctr adm", "Auditor"],
    _perm_rows,
    ratios=[0.34, 0.095, 0.095, 0.10, 0.095, 0.09, 0.10, 0.085],
    caption="Permission matrix distilled from the shipped RBAC catalog (● = granted; — = default deny).")

# ======================================== 6 · Reports and dashboard analytics
h1("6. Reports and Dashboard Analytics")
body("Analytics in Servictro are computed, not declared: every number on the dashboard "
     "is aggregated live from the operational tables at request time, and the header "
     "stamps how fresh the computation is. There are no imported spreadsheets and no "
     "manually entered KPIs, which is why the dashboard and the lists can never "
     "quietly disagree.")
h3("6.1 Reading the service volume chart")
body("The chart plots two series per day across the last 30 days: requests logged "
     "and work orders closed. In the demo tenant the activity clusters around the "
     "seeded events of November 2026. Use it to spot load imbalance — a week where "
     "the requests line towers over the closures line, a queue is building up, and the "
     "overdue KPI will usually confirm it a few days later.")
h3("6.2 SLA attainment and the resolution clock")
body("SLA attainment (30d) is the share of work orders resolved within their SLA "
     "resolution target, with the average resolution hours as context. The demo "
     "tenant shows 100% attainment with two open work orders in flight. Attainment "
     "is colour-coded green at 90% and above and amber below — treat amber as a "
     "dispatch-practice conversation, not a blame exercise: the SLA targets are "
     "tenant settings (visible in Settings → SLA defaults) and should be validated "
     "against pilot experience before being treated as contractual commitments.")
h3("6.3 Technician workload")
body("The workload card counts open assignments per technician. It exists for one "
     "decision: who takes the next job. Pair it with the required-skills field on "
     "the work order — assignment matching is skills-driven, so a VCB job should go "
     "to whoever carries VCB in their team profile, not merely to whoever is free.")
h3("6.4 Service reports")
body("Service reports are generated per work order from the execution record — "
     "checklist outcomes, measurements, observations, parts and the customer "
     "acknowledgement — and follow their own status flow: draft → pending review → "
     "approved → published, with superseded handling when regenerated. Publishing "
     "requires the reports:publish permission; the report is what the customer "
     "ultimately receives as evidence of the visit.")

# ============================================ 7 · Settings and configuration
h1("7. Settings and Configuration")
body("Workspace settings (Workspace → Settings) is deliberately compact in this "
     "release; it holds the identity card, the SLA defaults and an honest environment "
     "statement. Only owners and admins can save — other roles see the same cards "
     "read-only with an explanatory banner.")
table(
    ["Setting", "Demo value", "Effect"],
    [
        ["Workspace name", "GridNova Systems", "Shown in sidebar and header across the app"],
        ["Legal name", "GridNova Systems Private Limited", "Used on contracts and reports"],
        ["Default timezone", "Asia/Kolkata", "Sites can override; analytics bucket by site timezone"],
        ["Locale", "en-IN", "Date and number formatting"],
        ["Currency", "INR", "Contract values, e.g. the ₹18,000 AMC"],
        ["SLA response (crit/high/med/low)", "60 / 120 / 240 / 480 minutes", "Snapshotted onto new work orders; contracts override"],
        ["SLA resolution (crit/high/med/low)", "480 / 1440 / 2880 / 4320 minutes", "Drives the overdue flags and attainment KPI"],
    ],
    ratios=[0.30, 0.28, 0.42],
    caption="Workspace settings as configured in the demo tenant.")
body("The environment card states the deployment posture: data isolation via "
     "PostgreSQL row-level security with tenant-scoped transactions, email and "
     "WhatsApp delivery not configured (in-app notifications only, per ADR-011), "
     "local private file storage (S3 in production, per ADR-010), and the installable "
     "PWA as the field client (native app post-pilot, per ADR-08). These are current "
     "constraints, not aspirations — plan integrations around them.")
callout("Changing the SLA defaults affects only work orders created afterwards — "
        "existing work orders keep the targets snapshotted at their creation, so "
        "historical attainment stays comparable.",
        title="SLA changes are forward-looking")

# ==================================== 8 · Troubleshooting and FAQ
h1("8. Troubleshooting and Frequently Asked Questions")
h3("8.1 Sign-in problems")
table(
    ["Symptom", "Cause", "What to do"],
    [
        ["\"Invalid credentials\" with correct password", "Password changed, or account invited but not yet signed up", "Create account with the invited email first; the invitation token binds you to the workspace"],
        ["Sign-in suddenly rejected during testing", "Rate limit: 10 attempts per minute per source", "Wait a minute; every attempt is audit-logged, so brute force is both futile and visible"],
        ["Signed in but modules are missing", "Role-based sidebar (chapter 5)", "Check with an owner which role your membership carries; roles are per workspace"],
        ["Wrong tenant's data after switching", "Cached pack from previous workspace", "Sign out and back in; job packs are scoped per user+tenant and purged on switch"],
    ],
    ratios=[0.30, 0.30, 0.40],
    caption="Sign-in issues and their resolutions.")
h3("8.2 Field execution problems")
table(
    ["Symptom", "Cause", "What to do"],
    [
        ["Cannot start work on a job", "work_orders:execute applies to ASSIGNED jobs only", "Check the Assigned team card — you may be offered but not yet accepted, or not assigned at all"],
        ["Checklist will not complete", "Required items lack pass/fail/N/A or an exception reason", "Clear every red Required flag; exceptions need a typed reason"],
        ["Measurements recorded but missing", "Recorded offline while disconnected", "Open the synchronization card — items queue locally and sync on reconnect; nothing is lost"],
        ["Work order stuck in Pending review", "Supervisor has not reviewed yet", "Ping your service manager — review (work_orders:review) is an owner/admin/service-manager permission"],
        ["Cannot convert a request", "Request not in Accepted status, or missing coverage reason", "Accept the request first; non-covered conversions require a coverage reason by design"],
    ],
    ratios=[0.30, 0.32, 0.38],
    caption="Execution issues and their resolutions.")
h3("8.3 Frequently asked questions")
body("<b>Can two tenants see each other's data?</b> No. Tenant isolation is enforced "
     "in the database with row-level security on every table; the demo deliberately "
     "seeds identical asset codes in GridNova Systems and Voltline Power to prove the "
     "boundary holds. If a record is missing, it belongs to the other tenant.")
body("<b>What happens when a contract expires?</b> Coverage checks stop matching, so "
     "conversion from request asks for a coverage reason. The contract stays in the "
     "register with its renewal state; the Contracts page's renewal pipeline and the "
     "dashboard's expiring-90-days card surface it before that happens.")
body("<b>Can I edit a published service report?</b> Published reports are immutable; "
     "corrections generate a new version and the old one is marked superseded. The "
     "audit trail keeps the full lineage.")
body("<b>Does the technician need connectivity on site?</b> Only for sync. The My "
     "jobs pack caches jobs, checklists and customer data to the device; observations "
     "and measurements queue offline and upload when the connection returns.")
body("<b>Why is a button I normally use missing?</b> The UI hides actions your role "
     "lacks permission for (chapter 5). If you believe that is wrong, an owner or "
     "admin adjusts your role — the API would have rejected the action anyway.")
body("<b>Is there email or WhatsApp notification?</b> Not in this deployment "
     "(ADR-011). Notifications are in-app: the bell popover, the notifications page, "
     "and toasts while you work.")

# ============================== 9 · Best practices and quick reference
h1("9. Best Practices and Quick Reference")
h3("9.1 Best practices")
bullets([
    "<b>Register assets at handover, not at first breakdown.</b> Nameplate completeness feeds coverage checks and QR nameplates; retrofitting data under pressure produces errors.",
    "<b>Triage honestly.</b> Severity sets the SLA clocks; inflating it distorts attainment, deflating it hides risk. The triage action exists precisely for second thoughts.",
    "<b>Record the coverage reason when converting non-covered work.</b> It is the difference between an auditable goodwill decision and an unexplained free visit.",
    "<b>Keep technician skills current in Team.</b> Assignment matching is skills-driven; a stale skill list quietly degrades every dispatch decision.",
    "<b>Write rejection, hold and cancel reasons a stranger could act on.</b> They surface in the activity trail and audit log with your name attached.",
    "<b>Review PM visits weekly.</b> The worker generates drafts; nobody dispatches them but you. A stale draft queue is deferred maintenance wearing a disguise.",
    "<b>Treat SLA defaults as hypotheses.</b> The settings page itself says to validate targets with pilots before treating them as commitments.",
])
h3("9.2 Keyboard and interaction quick reference")
table(
    ["Action", "How"],
    [
        ["Collapse / expand sidebar", "Sidebar toggle (top of the sidebar); state remembered per browser"],
        ["Close a drawer or popover", "Escape key, or the × in the drawer header"],
        ["Sort any list", "Press the column header in any data table"],
        ["Search within a module", "Search box above each list (subject/code/serial as applicable)"],
        ["Open notifications", "Bell icon in the top bar; Mark all read clears the badge"],
        ["Switch workspace (tenant)", "Workspace chip in the header, next to the logo"],
        ["Sign out", "Account chip (top right) → Sign out"],
    ],
    ratios=[0.38, 0.62],
    caption="Everyday interactions.")
h3("9.3 Demo accounts quick reference")
table(
    ["Account", "Role", "Use it to see"],
    [
        ["owner@gridnova.example / DemoOwner#2026", "Owner", "Every module, settings, audit log, full action bar"],
        ["coord@gridnova.example / DemoCoord#2026", "Coordinator", "Service desk, dispatch, no analytics or team pages"],
        ["tech@gridnova.example / DemoTech#2026", "Technician", "My jobs pack, field execution, offline sync"],
        ["manager@gridnova.example / DemoOwner#2026", "Service manager", "Operations without tenant settings"],
        ["owner@voltline.example / DemoOwner#2026", "Owner (Voltline)", "Tenant isolation — same asset codes, different world"],
    ],
    ratios=[0.42, 0.20, 0.38],
    caption="Seeded demo accounts in the GridNova/Voltline demo environment.")
callout("The demo data is fictional seed data created for evaluation — the sidebar "
        "footer says so on every page. Do not put real customer or asset data into the "
        "demo environment.",
        title="Demo environment notice")

h3("9.4 Where to go next")
body("New users get productive fastest by following one full thread through the "
     "product: sign in as the owner, log a request against Shakti Cement, triage and "
     "convert it, assign Sunil Kadam, then sign in as the technician and execute the "
     "checklist end-to-end. That single pass exercises every workflow in chapter 4 "
     "and most of the permission boundaries in chapter 5. After it, explore the "
     "modules your role lives in, and keep chapters 8 and 9 within reach — the "
     "troubleshooting tables and quick reference exist precisely so that a new "
     "user can self-serve instead of waiting for help.")

# ================================================================ build ====
doc = TocDocTemplate(
    BODY_PDF, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=0.95 * inch, bottomMargin=0.85 * inch,
    title="Servictro User Manual",
    author="Z.ai",
    creator="Z.ai",
    subject="Complete user manual for the Servictro after-sales service and asset operations platform",
)
doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
print("body pages built:", doc.page)
print("figures:", _fig_no[0])
print("OK ->", BODY_PDF)
