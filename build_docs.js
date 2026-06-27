const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  ExternalHyperlink, LevelFormat, Header, Footer, PageNumber
} = require("docx");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "grants-data.json"), "utf8"));
const outDir = path.join(__dirname, "docs", "grant-summaries");
fs.mkdirSync(outDir, { recursive: true });

const BRAND = "1D4940", ACCENT = "C8732F", INK = "1F2D2B", SOFT = "46605C", LINE = "DDD8CC";
const fmtDate = iso => {
  const m = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const d = new Date(iso + "T00:00:00");
  return `${m[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

function labelValueRow(label, value, shade) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: LINE };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new TableRow({
    children: [
      new TableCell({
        borders, width: { size: 2600, type: WidthType.DXA },
        shading: { fill: "EEF3F1", type: ShadingType.CLEAR },
        margins: { top: 90, bottom: 90, left: 130, right: 130 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, color: BRAND, size: 20 })] })]
      }),
      new TableCell({
        borders, width: { size: 6760, type: WidthType.DXA },
        shading: shade ? { fill: shade, type: ShadingType.CLEAR } : undefined,
        margins: { top: 90, bottom: 90, left: 130, right: 130 },
        children: [new Paragraph({ children: [new TextRun({ text: value, size: 20, color: INK })] })]
      })
    ]
  });
}

function buildDoc(g) {
  const neededParas = (g.needed || []).map(n =>
    new Paragraph({ numbering: { reference: "checklist", level: 0 },
      children: [new TextRun({ text: n, size: 22 })] }));

  return new Document({
    creator: "Proud Ground Grant Tracker",
    title: g.name,
    styles: {
      default: { document: { run: { font: "Arial", size: 22, color: INK } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 30, bold: true, color: BRAND, font: "Arial" },
          paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, color: ACCENT, font: "Arial" },
          paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
      ]
    },
    numbering: {
      config: [
        { reference: "checklist",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2610", alignment: AlignmentType.LEFT,
            style: { run: { font: "Arial" }, paragraph: { indent: { left: 620, hanging: 320 } } } }] },
      ]
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 },
        margin: { top: 1300, right: 1300, bottom: 1300, left: 1300 } } },
      headers: { default: new Header({ children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 4 } },
        children: [new TextRun({ text: "PROUD GROUND  \u2022  GRANT OPPORTUNITY SUMMARY", bold: true, size: 16, color: SOFT })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Research aid \u2014 confirm all details on the funder\u2019s official page before applying.  Compiled June 26, 2026.  Page ", size: 14, color: SOFT }),
          new TextRun({ children: [PageNumber.CURRENT], size: 14, color: SOFT })] })] }) },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(g.name)] }),
        new Paragraph({ spacing: { after: 60 },
          children: [new TextRun({ text: g.funder, bold: true, size: 22, color: SOFT })] }),

        // Key facts table
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Key Facts")] }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2600, 6760],
          rows: [
            labelValueRow("Deadline", fmtDate(g.deadline), "FBEFE0"),
            labelValueRow("Status", g.status),
            labelValueRow("Award amount", g.amount),
            labelValueRow("Strategic fit", g.fit),
            labelValueRow("Eligible uses", g.use),
            labelValueRow("Eligibility", g.eligibility),
          ]
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Deadline Detail")] }),
        new Paragraph({ children: [new TextRun({ text: g.deadline_note, size: 22 })] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Summary & Why It Fits")] }),
        new Paragraph({ children: [new TextRun({ text: g.summary, size: 22 })] }),

        ...(g.pg_application ? [
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("How This Applies to Proud Ground")] }),
          new Paragraph({ children: [new TextRun({ text: g.pg_application, size: 22 })] }),
        ] : []),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Application Checklist \u2014 What You\u2019ll Need")] }),
        ...neededParas,

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Where to Apply")] }),
        new Paragraph({ spacing: { after: 40 }, children: [
          new TextRun({ text: "Official funder page: ", size: 22 }),
          new ExternalHyperlink({ link: g.url,
            children: [new TextRun({ text: g.url, style: "Hyperlink", color: "1155CC", underline: {}, size: 22 })] })
        ] }),

        new Paragraph({ spacing: { before: 320 },
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } },
          children: [new TextRun({ text: "Prepared for Proud Ground (EIN 93-1290320), a 501(c)(3) Community Land Trust serving Oregon and SW Washington. This summary is a research aid and not legal or financial advice.", italics: true, size: 16, color: SOFT })] }),
      ]
    }]
  });
}

(async () => {
  for (const g of data.grants) {
    if (!g.deadline) continue;             // need a deadline for the Key Facts table
    if (g.source && g.source !== "curated") continue; // only curated grants get a Word summary (the UI only links those)
    const doc = buildDoc(g);
    const buf = await Packer.toBuffer(doc);
    fs.writeFileSync(path.join(outDir, `${g.id}.docx`), buf);
    console.log("wrote", g.id + ".docx");
  }
})();
