import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

/**
 * IMPORTANT:
 * - Fictional country code: XAA
 * - Strong visible SAMPLE / FICTIONAL watermarks on every page
 * - Design/Research demo only
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

function yymmdd(iso){ const [y,m,d]=(iso||"1990-01-01").split("-"); return y.slice(2)+m+d; }
function padRight(s,l,c="<"){ s=(s||"").toUpperCase().replace(/[^A-Z0-9<]/g,"<"); return (s+c.repeat(l)).slice(0,l); }

function makeMRZ({ surname, givenNames, passportNo, dob, doe, sex }) {
  const name = `${(surname||"DOE").toUpperCase()}<<${(givenNames||"JANE").toUpperCase().replace(/\s+/g,"<")}`;
  const line1 = padRight(`P<XAA<${name}`, 44);
  const pno = padRight(passportNo, 9);
  const line2 = padRight(`${pno}<XAA${yymmdd(dob)}${(sex||"X").toUpperCase()}${yymmdd(doe)}`, 44);
  return { line1, line2 };
}

async function dataUrlToBytes(d) {
  const m = /^data:(.*?);base64,(.*)$/.exec(d || "");
  if (!m) throw new Error("Invalid dataUrl");
  return { bytes: Buffer.from(m[2], "base64"), mime: m[1] };
}

function drawTiledWatermark(page, text, fontBold) {
  const { width, height } = page.getSize();
  page.saveGraphicsState?.(); // safe in older versions
  const stepX = 220;
  const stepY = 140;
  for (let y = -80; y < height + 120; y += stepY) {
    for (let x = -120; x < width + 120; x += stepX) {
      page.drawText(text, {
        x, y,
        size: 18,
        font: fontBold,
        color: rgb(0.65, 0.65, 0.65),
        rotate: degrees(25),
        opacity: 0.14,
      });
    }
  }
}

function hypotrochoidPath(cx, cy, R, r, d, samples = 520) {
  // Build an SVG path string for a guilloche-like rosette
  // x(t) = (R-r)cos t + d cos((R-r)/r * t)
  // y(t) = (R-r)sin t - d sin((R-r)/r * t)
  let p = "";
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2 * 6; // several revolutions
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    const px = cx + x;
    const py = cy + y;
    p += (i === 0 ? `M ${px.toFixed(2)} ${py.toFixed(2)} ` : `L ${px.toFixed(2)} ${py.toFixed(2)} `);
  }
  p += "Z";
  return p;
}

function drawGuillocheBand(page, y, height, tint = 0.86) {
  const { width } = page.getSize();
  // soft band
  page.drawRectangle({
    x: 0, y, width, height,
    color: rgb(tint, tint, tint),
    opacity: 0.18
  });

  // multiple rosettes across the band
  const centers = [110, 240, 370, 500];
  for (const cx of centers) {
    const path1 = hypotrochoidPath(cx, y + height/2, 36, 11, 18, 380);
    const path2 = hypotrochoidPath(cx, y + height/2, 30, 9, 16, 340);
    page.drawSvgPath(path1, { borderColor: rgb(0.25, 0.45, 0.55), borderWidth: 0.6, opacity: 0.35 });
    page.drawSvgPath(path2, { borderColor: rgb(0.15, 0.30, 0.40), borderWidth: 0.5, opacity: 0.25 });
  }

  // thin security lines
  for (let i = 0; i < 18; i++) {
    const yy = y + 6 + i * (height - 12) / 18;
    page.drawLine({
      start: { x: 30, y: yy },
      end: { x: width - 30, y: yy },
      thickness: 0.35,
      color: rgb(0.10, 0.20, 0.28),
      opacity: 0.12
    });
  }
}

function drawMicrotext(page, text, x, y, w, lines, font, size = 4.2) {
  // repeated microtext lines
  let cursorY = y;
  for (let i = 0; i < lines; i++) {
    const t = (text + " • ").repeat(30);
    page.drawText(t, { x, y: cursorY, size, font, color: rgb(0.12,0.22,0.30), opacity: 0.22, maxWidth: w });
    cursorY -= (size + 1.2);
  }
}

function drawPassportCover(page, bold, font) {
  const { width, height } = page.getSize();
  // deep cover
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.12, 0.18, 0.22) });

  // subtle inner border
  page.drawRectangle({
    x: 28, y: 28, width: width - 56, height: height - 56,
    borderColor: rgb(0.85, 0.78, 0.55), borderWidth: 1.2, opacity: 0.8
  });
  page.drawRectangle({
    x: 40, y: 40, width: width - 80, height: height - 80,
    borderColor: rgb(0.85, 0.78, 0.55), borderWidth: 0.6, opacity: 0.5
  });

  // faux "gold" title (not any real country)
  page.drawText("PASSPORT", { x: 0, y: height - 220, size: 34, font: bold, color: rgb(0.90,0.80,0.52), opacity: 0.95 });
  // center align by measuring approx
  page.drawText("PASSPORT", { x: 206, y: height - 220, size: 34, font: bold, color: rgb(0.90,0.80,0.52), opacity: 0.95 });

  page.drawText("REPUBLIC OF SAMPLELAND", { x: 150, y: height - 265, size: 14, font: bold, color: rgb(0.90,0.80,0.52), opacity: 0.9 });
  page.drawText("FICTIONAL / SAMPLE / NO LEGAL VALUE", { x: 140, y: 90, size: 10, font, color: rgb(0.95,0.95,0.95), opacity: 0.7 });

  // decorative rosette emblem (fictional)
  const rosette = hypotrochoidPath(width/2, height/2 + 10, 70, 22, 34, 600);
  page.drawSvgPath(rosette, { borderColor: rgb(0.90,0.80,0.52), borderWidth: 1.0, opacity: 0.75 });

  // watermark tiles
  drawTiledWatermark(page, "SAMPLELAND • FICTIONAL", bold);
}

function drawDataPage(page, payload, photoImg, qrImg, font, bold) {
  const { width, height } = page.getSize();

  // background light
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.98, 0.985, 0.99) });

  // guilloche bands
  drawGuillocheBand(page, height - 180, 120);
  drawGuillocheBand(page, 210, 90, 0.90);

  // header block
  page.drawRectangle({ x: 40, y: height - 160, width: width - 80, height: 110, color: rgb(0.06, 0.25, 0.36), opacity: 0.92 });
  page.drawText("FICTIONAL PASSPORT — PERSONAL DATA", { x: 58, y: height - 88, size: 15, font: bold, color: rgb(1,1,1) });
  page.drawText("SAMPLE / NO LEGAL VALUE / RESEARCH DEMO", { x: 58, y: height - 112, size: 9.5, font, color: rgb(1,1,1), opacity: 0.9 });

  // photo frame
  page.drawRectangle({ x: 60, y: height - 390, width: 150, height: 190, color: rgb(1,1,1), borderColor: rgb(0.12,0.18,0.22), borderWidth: 1.2 });
  page.drawImage(photoImg, { x: 63, y: height - 387, width: 144, height: 184 });

  // data fields (more “document-like” layout)
  const leftX = 230;
  const y0 = height - 220;
  const lh = 18;

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

  page.drawText("DOCUMENT DETAILS", { x: leftX, y: y0 + 24, size: 10.5, font: bold, color: rgb(0.06,0.12,0.18) });

  // table-like lines
  page.drawRectangle({ x: leftX, y: y0 - 8 - rows.length*lh, width: width - leftX - 60, height: rows.length*lh + 22, borderColor: rgb(0.15,0.22,0.28), borderWidth: 0.8, opacity: 0.5 });
  for (let i = 0; i <= rows.length; i++) {
    const yy = y0 + 8 - i*lh;
    page.drawLine({ start: { x: leftX, y: yy }, end: { x: width - 60, y: yy }, thickness: 0.4, color: rgb(0.12,0.18,0.22), opacity: 0.18 });
  }
  page.drawLine({ start: { x: leftX + 140, y: y0 + 8 }, end: { x: leftX + 140, y: y0 + 8 - rows.length*lh }, thickness: 0.4, color: rgb(0.12,0.18,0.22), opacity: 0.18 });

  rows.forEach((r, i) => {
    const yy = y0 - i*lh;
    page.drawText(`${r[0]}`, { x: leftX + 8, y: yy, size: 9.5, font: bold, color: rgb(0.08,0.12,0.16) });
    page.drawText(`${r[1]}`, { x: leftX + 150, y: yy, size: 9.5, font, color: rgb(0,0,0) });
  });

  // MRZ box
  page.drawRectangle({ x: 60, y: 135, width: width - 120, height: 85, color: rgb(0.96,0.965,0.96), borderColor: rgb(0.18,0.22,0.24), borderWidth: 1 });
  page.drawText("MRZ-LIKE (FICTIONAL CODE: XAA)", { x: 64, y: 205, size: 8.5, font: bold, color: rgb(0.16,0.20,0.22) });
  page.drawText(payload.mrz.line1, { x: 70, y: 175, size: 12, font, color: rgb(0,0,0) });
  page.drawText(payload.mrz.line2, { x: 70, y: 155, size: 12, font, color: rgb(0,0,0) });

  // microtext and security strip
  drawMicrotext(page, "SAMPLELAND FICTIONAL DOCUMENT", 60, 118, width - 120, 8, font, 4.2);

  // QR & signature info
  page.drawRectangle({ x: width - 170, y: 30, width: 120, height: 120, color: rgb(1,1,1), borderColor: rgb(0.15,0.18,0.20), borderWidth: 1 });
  page.drawImage(qrImg, { x: width - 165, y: 35, width: 110, height: 110 });

  page.drawText("Scan or copy bundleBase64 to /verify", { x: 60, y: 54, size: 8.5, font, color: rgb(0.18,0.22,0.24) });

  // strong watermarks
  drawTiledWatermark(page, "SAMPLE • FICTIONAL • NO LEGAL VALUE", bold);
}

function drawVisaPage(page, pageNo, font, bold) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.985, 0.99, 0.995) });

  // repeating background
  drawGuillocheBand(page, height - 190, 130, 0.92);
  drawGuillocheBand(page, 110, 100, 0.94);

  // header
  page.drawText(`VISA / ENTRY STAMPS (SAMPLE)`, { x: 60, y: height - 80, size: 13, font: bold, color: rgb(0.06,0.12,0.18) });
  page.drawText(`PAGE ${pageNo}`, { x: width - 120, y: height - 80, size: 10, font: bold, color: rgb(0.06,0.12,0.18) });

  // stamp frames (fictional)
  const cols = 2, rows = 3;
  const boxW = (width - 120 - 20) / cols;
  const boxH = 165;
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 60 + c * (boxW + 20);
      const y = height - 140 - r * (boxH + 24);
      page.drawRectangle({ x, y, width: boxW, height: boxH, borderColor: rgb(0.16,0.20,0.24), borderWidth: 0.9, opacity: 0.35 });
      page.drawText("SAMPLE STAMP", { x: x + 12, y: y + boxH - 26, size: 9, font: bold, color: rgb(0.12,0.18,0.22), opacity: 0.35 });
      // mini rosette per box
      const ro = hypotrochoidPath(x + boxW - 55, y + 55, 22, 8, 12, 220);
      page.drawSvgPath(ro, { borderColor: rgb(0.18,0.32,0.42), borderWidth: 0.6, opacity: 0.25 });
      idx++;
    }
  }

  // microtext footer
  drawMicrotext(page, "NO LEGAL VALUE • SAMPLELAND • FICTIONAL", 60, 90, width - 120, 6, font, 4.2);

  // watermarks
  drawTiledWatermark(page, "SAMPLE / FICTIONAL", bold);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const b = req.body || {};
    if (!b.photoDataUrl) return res.status(400).send("Missing photoDataUrl");

    // Build payload (fictional)
    const passportNo = "SPL-" + Math.floor(Math.random() * 1e6).toString().padStart(6, "0");

    const payload = {
      schema: "fictional-epassport.v2",
      issuer: {
        name: "Republic of Sampleland (Fictional)",
        countryCode: "XAA",
        disclaimer: "FICTIONAL / SAMPLE / NO LEGAL VALUE"
      },
      subject: {
        surname: b.surname || "DOE",
        givenNames: b.givenNames || "JANE",
        nationality: b.nationality || "SAMPLELAND",
        sex: b.sex || "X",
        dob: b.dob || "1990-01-01",
        pob: b.pob || "SAMPLE CITY"
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
      publicKeyB64: naclUtil.encodeBase64(kp.publicKey),
    };
    const bundleBase64 = Buffer.from(JSON.stringify(bundle), "utf8").toString("base64");

    // QR encodes bundleBase64 (for demo)
    const qrDataUrl = await QRCode.toDataURL(bundleBase64, { margin: 1, scale: 6, errorCorrectionLevel: "M" });

    // Create PDF booklet (A4 pages)
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Embed photo + QR
    const { bytes: pb, mime } = await dataUrlToBytes(b.photoDataUrl);
    const photoImg = mime.includes("png") ? await pdf.embedPng(pb) : await pdf.embedJpg(pb);
    const { bytes: qb } = await dataUrlToBytes(qrDataUrl);
    const qrImg = await pdf.embedPng(qb);

    // Page 1: cover
    const cover = pdf.addPage([595.28, 841.89]);
    drawPassportCover(cover, bold, font);

    // Page 2: data page
    const dataPage = pdf.addPage([595.28, 841.89]);
    drawDataPage(dataPage, payload, photoImg, qrImg, font, bold);

    // Pages 3..10: visa pages
    for (let i = 3; i <= 10; i++) {
      const p = pdf.addPage([595.28, 841.89]);
      drawVisaPage(p, i, font, bold);
    }

    const pdfBytes = await pdf.save();

    res.status(200).json({
      filename: `fictional-epassport-${passportNo}.pdf`,
      pdfBase64: Buffer.from(pdfBytes).toString("base64"),
      bundleBase64,
      payload,
      signatureB64: bundle.signatureB64,
      publicKeyB64: bundle.publicKeyB64
    });
  } catch (e) {
    res.status(400).send(String(e?.message || e));
  }
}
