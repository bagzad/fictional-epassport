import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

/*
  Fictional passport booklet generator (A-track)
  - Higher visual density: guilloche rosettes, wave lines, microtext, perforation dots
  - Asymmetric information page layout
  - Booklet pages with consistent design motif
  - ASCII ONLY (WinAnsi safe)
  - Fictional issuer: XAA
*/

function stableStringify(obj) {
  const seen = new Set();
  const sorter = (x) => {
    if (x && typeof x === "object") {
      if (seen.has(x)) throw new Error("circular");
      seen.add(x);
      if (Array.isArray(x)) return x.map(sorter);
      return Object.keys(x).sort().reduce((a, k) => { a[k] = sorter(x[k]); return a; }, {});
    }
    return x;
  };
  return JSON.stringify(sorter(obj));
}

function yymmdd(iso){
  const p = (iso || "1990-01-01").split("-");
  const y = (p[0] || "1990").slice(2);
  const m = (p[1] || "01").padStart(2, "0");
  const d = (p[2] || "01").padStart(2, "0");
  return y + m + d;
}

function padRight(s, l, c){
  s = (s || "").toUpperCase().replace(/[^A-Z0-9<]/g, "<");
  return (s + String(c || "<").repeat(l)).slice(0, l);
}

function makeMRZ(o){
  const name = (o.surname || "DOE").toUpperCase() + "<<"
    + (o.givenNames || "JANE").toUpperCase().replace(/\s+/g, "<");
  const l1 = padRight("P<XAA<" + name, 44, "<");
  const pno = padRight(o.passportNo, 9, "<");
  const l2 = padRight(
    pno + "<XAA" + yymmdd(o.dob) + (o.sex || "X") + yymmdd(o.doe),
    44, "<"
  );
  return { line1: l1, line2: l2 };
}

async function dataUrlToBytes(d){
  const m = /^data:(.*?);base64,(.*)$/.exec(d || "");
  if (!m) throw new Error("Invalid dataUrl");
  return { bytes: Buffer.from(m[2], "base64"), mime: m[1] };
}

/* ---------- Visual primitives ---------- */

function drawSoftVerticalGradient(page, x, y, w, h, cTop, cBot, steps) {
  // simulate gradient with many thin rectangles
  const n = Math.max(8, Math.min(steps || 60, 120));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rr = cTop.r + (cBot.r - cTop.r) * t;
    const gg = cTop.g + (cBot.g - cTop.g) * t;
    const bb = cTop.b + (cBot.b - cTop.b) * t;
    page.drawRectangle({
      x,
      y: y + (h * i) / n,
      width: w,
      height: h / n + 0.2,
      color: rgb(rr, gg, bb),
      opacity: 0.95
    });
  }
}

function hypotrochoidPath(cx, cy, R, r, d, turns, samples) {
  // rosette-like guilloche using a hypotrochoid
  const T = Math.PI * 2 * (turns || 7);
  const n = Math.max(240, Math.min(samples || 900, 1400));
  let p = "";
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * T;
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    const px = cx + x;
    const py = cy + y;
    p += (i === 0 ? "M " : "L ") + px.toFixed(2) + " " + py.toFixed(2) + " ";
  }
  return p;
}

function wavePath(x0, y0, x1, amp, waves, samples) {
  const n = Math.max(120, Math.min(samples || 520, 900));
  let p = "";
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + Math.sin(t * Math.PI * 2 * (waves || 6)) * (amp || 10);
    p += (i === 0 ? "M " : "L ") + x.toFixed(2) + " " + y.toFixed(2) + " ";
  }
  return p;
}

function tiledWatermark(page, text, fontBold) {
  const s = page.getSize();
  for (let y = -120; y < s.height + 200; y += 160) {
    for (let x = -180; x < s.width + 240; x += 260) {
      page.drawText(text, {
        x, y,
        size: 16,
        font: fontBold,
        color: rgb(0.62, 0.62, 0.62),
        rotate: degrees(25),
        opacity: 0.12
      });
    }
  }
}

function microtextLine(text, repeatCount) {
  const base = (text || "SAMPLELAND FICTIONAL DOCUMENT").replace(/[^A-Z0-9 ]/g, " ").toUpperCase();
  const seg = (base + " ").repeat(1);
  return (seg + " ").repeat(Math.max(10, repeatCount || 40)).trim();
}

function drawMicrotextBlock(page, x, y, w, lines, font, size, opacity) {
  const n = Math.max(3, Math.min(lines || 10, 24));
  const s = Math.max(3.6, Math.min(size || 4.2, 6));
  let yy = y;
  const t = microtextLine("NO LEGAL VALUE SAMPLELAND FICTIONAL", 60);
  for (let i = 0; i < n; i++) {
    page.drawText(t, {
      x, y: yy,
      size: s,
      font,
      color: rgb(0.10, 0.18, 0.24),
      opacity: Math.max(0.08, Math.min(opacity || 0.22, 0.35)),
      maxWidth: w
    });
    yy -= (s + 1.2);
  }
}

function drawPerforationDots(page, x, y0, y1, step, radius, opacity) {
  const s = Math.max(10, Math.min(step || 12, 22));
  const r = Math.max(0.7, Math.min(radius || 1.1, 1.6));
  const o = Math.max(0.10, Math.min(opacity || 0.28, 0.45));
  let y = y0;
  while (y <= y1) {
    page.drawCircle({ x, y, size: r, color: rgb(0.10,0.16,0.20), opacity: o });
    y += s;
  }
}

function drawBindingSpine(page, x, y, h) {
  // spine strip with subtle lines
  page.drawRectangle({ x: x - 10, y, width: 18, height: h, color: rgb(0.92,0.93,0.94), opacity: 0.35 });
  for (let i = 0; i < 24; i++) {
    const yy = y + (h * i) / 24;
    page.drawLine({
      start: { x: x - 10, y: yy },
      end: { x: x + 8, y: yy },
      thickness: 0.35,
      color: rgb(0.08,0.12,0.16),
      opacity: 0.10
    });
  }
}

/* ---------- Pages ---------- */

function drawCover(page, font, bold) {
  const s = page.getSize();

  // cover base (deep color + inner frames)
  page.drawRectangle({ x: 0, y: 0, width: s.width, height: s.height, color: rgb(0.12, 0.18, 0.22) });

  page.drawRectangle({
    x: 28, y: 28, width: s.width - 56, height: s.height - 56,
    borderColor: rgb(0.88,0.78,0.52), borderWidth: 1.2, opacity: 0.85
  });
  page.drawRectangle({
    x: 42, y: 42, width: s.width - 84, height: s.height - 84,
    borderColor: rgb(0.88,0.78,0.52), borderWidth: 0.6, opacity: 0.55
  });

  // motif rosette
  const ro1 = hypotrochoidPath(s.width/2, s.height/2 + 12, 70, 22, 34, 7, 980);
  const ro2 = hypotrochoidPath(s.width/2, s.height/2 + 12, 62, 19, 30, 7, 860);
  page.drawSvgPath(ro1, { borderColor: rgb(0.88,0.78,0.52), borderWidth: 1.0, opacity: 0.75 });
  page.drawSvgPath(ro2, { borderColor: rgb(0.88,0.78,0.52), borderWidth: 0.7, opacity: 0.50 });

  // titles
  page.drawText("PASSPORT", { x: 205, y: s.height - 230, size: 34, font: bold, color: rgb(0.90,0.80,0.52), opacity: 0.96 });
  page.drawText("REPUBLIC OF SAMPLELAND", { x: 158, y: s.height - 272, size: 14, font: bold, color: rgb(0.90,0.80,0.52), opacity: 0.92 });

  page.drawText("FICTIONAL SAMPLE NO LEGAL VALUE", { x: 150, y: 90, size: 10, font, color: rgb(0.97,0.97,0.97), opacity: 0.78 });

  // watermark
  tiledWatermark(page, "SAMPLE FICTIONAL", bold);
}

function drawDataPage(page, payload, photoImg, qrImg, font, bold) {
  const s = page.getSize();

  // background gradient (soft)
  drawSoftVerticalGradient(
    page,
    0, 0, s.width, s.height,
    { r: 0.975, g: 0.985, b: 0.995 },
    { r: 0.945, g: 0.955, b: 0.965 },
    70
  );

  // binding spine and perforation dots (left)
  drawBindingSpine(page, 44, 50, s.height - 100);
  drawPerforationDots(page, 58, 70, s.height - 70, 14, 1.05, 0.28);

  // top band with waves + rosettes (mother motif)
  page.drawRectangle({ x: 40, y: s.height - 190, width: s.width - 80, height: 130, color: rgb(0.06, 0.25, 0.36), opacity: 0.92 });

  const w1 = wavePath(60, s.height - 120, s.width - 60, 9, 7, 720);
  const w2 = wavePath(60, s.height - 145, s.width - 60, 7, 9, 720);
  page.drawSvgPath(w1, { borderColor: rgb(0.75, 0.88, 0.92), borderWidth: 0.55, opacity: 0.22 });
  page.drawSvgPath(w2, { borderColor: rgb(0.75, 0.88, 0.92), borderWidth: 0.45, opacity: 0.18 });

  const rA = hypotrochoidPath(520, s.height - 125, 26, 9, 14, 6, 540);
  const rB = hypotrochoidPath(520, s.height - 125, 22, 8, 12, 6, 460);
  page.drawSvgPath(rA, { borderColor: rgb(0.92, 0.97, 0.99), borderWidth: 0.8, opacity: 0.28 });
  page.drawSvgPath(rB, { borderColor: rgb(0.92, 0.97, 0.99), borderWidth: 0.6, opacity: 0.22 });

  page.drawText("FICTIONAL PASSPORT", { x: 62, y: s.height - 94, size: 16, font: bold, color: rgb(1,1,1) });
  page.drawText("PERSONAL DATA PAGE", { x: 62, y: s.height - 116, size: 10.5, font, color: rgb(1,1,1), opacity: 0.92 });
  page.drawText("SAMPLE NO LEGAL VALUE", { x: 62, y: s.height - 136, size: 10, font, color: rgb(1,1,1), opacity: 0.90 });

  // Asymmetric layout: photo block left, data block right, signature strip bottom-left
  // photo frame with layered borders
  page.drawRectangle({ x: 72, y: s.height - 430, width: 160, height: 210, color: rgb(1,1,1), borderColor: rgb(0.10,0.16,0.20), borderWidth: 1.2, opacity: 0.98 });
  page.drawRectangle({ x: 78, y: s.height - 424, width: 148, height: 198, borderColor: rgb(0.10,0.16,0.20), borderWidth: 0.6, opacity: 0.40 });
  page.drawImage(photoImg, { x: 80, y: s.height - 422, width: 144, height: 194 });

  // photo overlay rosette (semi-transparent)
  const pr = hypotrochoidPath(152, s.height - 320, 34, 11, 18, 6, 620);
  page.drawSvgPath(pr, { borderColor: rgb(0.10,0.30,0.40), borderWidth: 0.7, opacity: 0.10 });

  // data panel (not a table grid; document-like blocks)
  const panelX = 260;
  const panelY = s.height - 470;
  const panelW = s.width - panelX - 60;
  const panelH = 270;

  page.drawRectangle({ x: panelX, y: panelY, width: panelW, height: panelH, color: rgb(1,1,1), opacity: 0.72, borderColor: rgb(0.12,0.16,0.20), borderWidth: 0.9, opacity: 0.35 });

  // subtle guilloche inside panel
  const g1 = hypotrochoidPath(panelX + panelW - 85, panelY + 80, 42, 14, 22, 6, 700);
  const g2 = hypotrochoidPath(panelX + panelW - 85, panelY + 80, 36, 12, 18, 6, 600);
  page.drawSvgPath(g1, { borderColor: rgb(0.10,0.26,0.34), borderWidth: 0.65, opacity: 0.14 });
  page.drawSvgPath(g2, { borderColor: rgb(0.10,0.26,0.34), borderWidth: 0.45, opacity: 0.10 });

  const rows = [
    ["Passport No", payload.passportNo],
    ["Surname", payload.subject.surname],
    ["Given Names", payload.subject.givenNames],
    ["Nationality", payload.subject.nationality],
    ["Sex", payload.subject.sex],
    ["Date of Birth", payload.subject.dob],
    ["Place of Birth", payload.subject.pob],
    ["Date of Issue", payload.doi],
    ["Date of Expiry", payload.doe],
    ["Issuer Code", payload.issuer.countryCode]
  ];

  page.drawText("DOCUMENT DETAILS", { x: panelX + 14, y: panelY + panelH - 26, size: 10.5, font: bold, color: rgb(0.06,0.10,0.14), opacity: 0.92 });

  let yy = panelY + panelH - 50;
  for (let i = 0; i < rows.length; i++) {
    const k = rows[i][0];
    const v = String(rows[i][1]);
    page.drawText(k, { x: panelX + 14, y: yy, size: 9.5, font: bold, color: rgb(0.08,0.12,0.16), opacity: 0.92 });
    page.drawText(v, { x: panelX + 150, y: yy, size: 9.5, font, color: rgb(0,0,0), opacity: 0.92 });
    // light divider line
    page.drawLine({
      start: { x: panelX + 12, y: yy - 6 },
      end: { x: panelX + panelW - 12, y: yy - 6 },
      thickness: 0.35,
      color: rgb(0.08,0.12,0.16),
      opacity: 0.12
    });
    yy -= 22;
  }

  // signature strip (visual cue)
  page.drawRectangle({ x: 72, y: 290, width: 220, height: 55, color: rgb(1,1,1), opacity: 0.55, borderColor: rgb(0.12,0.16,0.20), borderWidth: 0.8, opacity: 0.30 });
  page.drawText("HOLDER SIGNATURE", { x: 84, y: 328, size: 8.5, font: bold, color: rgb(0.10,0.16,0.20), opacity: 0.35 });
  // a wave stroke as pseudo signature
  const sigPath = wavePath(90, 305, 270, 6, 4, 420);
  page.drawSvgPath(sigPath, { borderColor: rgb(0.10,0.16,0.20), borderWidth: 1.0, opacity: 0.25 });

  // MRZ zone (bottom, visual base)
  page.drawRectangle({ x: 72, y: 170, width: s.width - 144, height: 92, color: rgb(0.965,0.965,0.96), borderColor: rgb(0.12,0.16,0.20), borderWidth: 1.0, opacity: 0.55 });
  page.drawText(payload.mrz.line1, { x: 84, y: 218, size: 12, font, color: rgb(0,0,0), opacity: 0.92 });
  page.drawText(payload.mrz.line2, { x: 84, y: 196, size: 12, font, color: rgb(0,0,0), opacity: 0.92 });

  // microtext + security wave under MRZ
  drawMicrotextBlock(page, 72, 160, s.width - 144, 9, font, 4.1, 0.22);
  const secWave = wavePath(72, 262, s.width - 72, 6, 10, 720);
  page.drawSvgPath(secWave, { borderColor: rgb(0.10,0.26,0.34), borderWidth: 0.55, opacity: 0.14 });

  // QR (bottom-right)
  page.drawRectangle({ x: s.width - 182, y: 40, width: 120, height: 120, color: rgb(1,1,1), borderColor: rgb(0.12,0.16,0.20), borderWidth: 1.0, opacity: 0.70 });
  page.drawImage(qrImg, { x: s.width - 176, y: 46, width: 108, height: 108 });
  page.drawText("VERIFY AT /VERIFY", { x: 72, y: 58, size: 9, font: bold, color: rgb(0.10,0.16,0.20), opacity: 0.75 });

  // global watermark (strong)
  tiledWatermark(page, "SAMPLE FICTIONAL NO LEGAL VALUE", bold);
}

function drawVisaPage(page, pageNo, font, bold) {
  const s = page.getSize();

  // background gradient
  drawSoftVerticalGradient(
    page,
    0, 0, s.width, s.height,
    { r: 0.985, g: 0.990, b: 0.995 },
    { r: 0.955, g: 0.965, b: 0.975 },
    60
  );

  // binding and perforation
  drawBindingSpine(page, 44, 50, s.height - 100);
  drawPerforationDots(page, 58, 70, s.height - 70, 14, 1.05, 0.26);

  // header motif bar
  page.drawRectangle({ x: 40, y: s.height - 130, width: s.width - 80, height: 70, color: rgb(0.92,0.95,0.97), opacity: 0.65 });
  const ro = hypotrochoidPath(520, s.height - 96, 24, 8, 12, 6, 520);
  page.drawSvgPath(ro, { borderColor: rgb(0.10,0.26,0.34), borderWidth: 0.7, opacity: 0.18 });

  page.drawText("VISA AND ENTRY STAMPS (SAMPLE)", { x: 60, y: s.height - 92, size: 12.5, font: bold, color: rgb(0.06,0.10,0.14), opacity: 0.92 });
  page.drawText("PAGE " + pageNo, { x: s.width - 120, y: s.height - 92, size: 10, font: bold, color: rgb(0.06,0.10,0.14), opacity: 0.85 });

  // stamp frames (2 columns x 3 rows)
  const cols = 2;
  const rows = 3;
  const boxW = (s.width - 120 - 18) / cols;
  const boxH = 170;

  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 60 + c * (boxW + 18);
      const y = s.height - 180 - r * (boxH + 22);
      page.drawRectangle({
        x, y,
        width: boxW,
        height: boxH,
        borderColor: rgb(0.10,0.16,0.20),
        borderWidth: 0.8,
        opacity: 0.26
      });

      page.drawText("SAMPLE STAMP", { x: x + 12, y: y + boxH - 26, size: 9, font: bold, color: rgb(0.08,0.12,0.16), opacity: 0.28 });

      // a small rosette per box
      const rr = hypotrochoidPath(x + boxW - 52, y + 54, 20, 7, 10, 6, 360);
      page.drawSvgPath(rr, { borderColor: rgb(0.10,0.26,0.34), borderWidth: 0.55, opacity: 0.16 });

      idx++;
    }
  }

  // microtext footer + motif wave
  drawMicrotextBlock(page, 60, 95, s.width - 120, 7, font, 4.1, 0.22);
  const w = wavePath(60, 125, s.width - 60, 5, 10, 720);
  page.drawSvgPath(w, { borderColor: rgb(0.10,0.26,0.34), borderWidth: 0.5, opacity: 0.12 });

  tiledWatermark(page, "SAMPLE FICTIONAL", bold);
}

/* ---------- API ---------- */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    const b = req.body || {};
    if (!b.photoDataUrl) return res.status(400).send("Missing photoDataUrl");

    const passportNo = "SPL-" + Math.floor(Math.random() * 1000000).toString().padStart(6, "0");

    const payload = {
      schema: "fictional-epassport.a1",
      issuer: {
        name: "Republic of Sampleland (Fictional)",
        countryCode: "XAA",
        note: "SAMPLE NO LEGAL VALUE"
      },
      subject: {
        surname: (b.surname || "DOE").toUpperCase(),
        givenNames: (b.givenNames || "JANE").toUpperCase(),
        nationality: (b.nationality || "SAMPLELAND").toUpperCase(),
        sex: (b.sex || "X").toUpperCase(),
        dob: b.dob || "1990-01-01",
        pob: (b.pob || "SAMPLE CITY").toUpperCase()
      },
      passportNo,
      doi: b.doi || "2025-01-01",
      doe: b.doe || "2035-01-01",
      issuedAt: new Date().toISOString()
    };

    payload.mrz = makeMRZ({
      surname: payload.subject.surname,
      givenNames: payload.subject.givenNames,
      passportNo,
      dob: payload.subject.dob,
      doe: payload.doe,
      sex: payload.subject.sex
    });

    // Sign payload
    const msg = stableStringify(payload);
    const kp = nacl.sign.keyPair();
    const sig = nacl.sign.detached(naclUtil.decodeUTF8(msg), kp.secretKey);

    const bundle = {
      payload,
      signatureB64: naclUtil.encodeBase64(sig),
      publicKeyB64: naclUtil.encodeBase64(kp.publicKey)
    };
    const bundleBase64 = Buffer.from(JSON.stringify(bundle), "utf8").toString("base64");

    // QR encodes bundleBase64
    const qrDataUrl = await QRCode.toDataURL(bundleBase64, { margin: 1, scale: 6, errorCorrectionLevel: "M" });

    // PDF
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const { bytes: pb, mime } = await dataUrlToBytes(b.photoDataUrl);
    const photoImg = mime.includes("png") ? await pdf.embedPng(pb) : await pdf.embedJpg(pb);

    const { bytes: qb } = await dataUrlToBytes(qrDataUrl);
    const qrImg = await pdf.embedPng(qb);

    // Booklet pages
    const cover = pdf.addPage([595.28, 841.89]);
    drawCover(cover, font, bold);

    const dataPage = pdf.addPage([595.28, 841.89]);
    drawDataPage(dataPage, payload, photoImg, qrImg, font, bold);

    // visa pages (consistent motif)
    for (let i = 3; i <= 12; i++) {
      const p = pdf.addPage([595.28, 841.89]);
      drawVisaPage(p, i, font, bold);
    }

    const pdfBytes = await pdf.save();

    return res.status(200).json({
      filename: "fictional-passport-" + passportNo + ".pdf",
      pdfBase64: Buffer.from(pdfBytes).toString("base64"),
      bundleBase64,
      payload
    });
  } catch (e) {
    return res.status(400).send(String(e && (e.message || e)));
  }
}
