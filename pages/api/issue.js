import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

/*
  Fictional passport booklet generator
  ASCII ONLY text (WinAnsi safe)
  Country code: XAA (fictional)
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
  return (p[0] || "1990").slice(2) + (p[1] || "01") + (p[2] || "01");
}

function padRight(s, l, c){
  s = (s || "").toUpperCase().replace(/[^A-Z0-9<]/g, "<");
  return (s + c.repeat(l)).slice(0, l);
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

function tiledWatermark(page, text, font){
  const s = page.getSize();
  for (let y = -80; y < s.height + 120; y += 140) {
    for (let x = -120; x < s.width + 120; x += 220) {
      page.drawText(text, {
        x, y, size: 16, font,
        color: rgb(0.65, 0.65, 0.65),
        rotate: degrees(25), opacity: 0.14
      });
    }
  }
}

function drawCover(page, font, bold){
  const s = page.getSize();
  page.drawRectangle({ x: 0, y: 0, width: s.width, height: s.height, color: rgb(0.12, 0.18, 0.22) });
  page.drawRectangle({
    x: 30, y: 30, width: s.width - 60, height: s.height - 60,
    borderColor: rgb(0.90,0.80,0.52), borderWidth: 1.2, opacity: 0.8
  });
  page.drawText("PASSPORT", { x: 200, y: s.height - 240, size: 34, font: bold, color: rgb(0.90,0.80,0.52) });
  page.drawText("REPUBLIC OF SAMPLELAND", { x: 160, y: s.height - 280, size: 14, font: bold, color: rgb(0.90,0.80,0.52) });
  page.drawText("FICTIONAL SAMPLE NO LEGAL VALUE", { x: 150, y: 90, size: 10, font, color: rgb(1,1,1), opacity: 0.8 });
  tiledWatermark(page, "SAMPLE FICTIONAL", bold);
}

function drawDataPage(page, payload, photoImg, qrImg, font, bold){
  const s = page.getSize();
  page.drawRectangle({ x: 0, y: 0, width: s.width, height: s.height, color: rgb(0.98,0.985,0.99) });

  page.drawRectangle({ x: 40, y: s.height - 160, width: s.width - 80, height: 110, color: rgb(0.06,0.25,0.36) });
  page.drawText("PERSONAL DATA", { x: 58, y: s.height - 92, size: 16, font: bold, color: rgb(1,1,1) });
  page.drawText("FICTIONAL DOCUMENT NO LEGAL VALUE", { x: 58, y: s.height - 116, size: 10, font, color: rgb(1,1,1) });

  page.drawRectangle({ x: 60, y: s.height - 390, width: 150, height: 190, borderColor: rgb(0,0,0), borderWidth: 1 });
  page.drawImage(photoImg, { x: 63, y: s.height - 387, width: 144, height: 184 });

  const leftX = 230;
  let y = s.height - 220;
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

  rows.forEach(r => {
    page.drawText(r[0] + ":", { x: leftX, y, size: 10, font: bold, color: rgb(0,0,0) });
    page.drawText(String(r[1]), { x: leftX + 150, y, size: 10, font, color: rgb(0,0,0) });
    y -= lh;
  });

  page.drawRectangle({ x: 60, y: 135, width: s.width - 120, height: 85, borderColor: rgb(0,0,0), borderWidth: 1 });
  page.drawText(payload.mrz.line1, { x: 70, y: 175, size: 12, font });
  page.drawText(payload.mrz.line2, { x: 70, y: 155, size: 12, font });

  page.drawRectangle({ x: s.width - 170, y: 30, width: 120, height: 120, borderColor: rgb(0,0,0), borderWidth: 1 });
  page.drawImage(qrImg, { x: s.width - 165, y: 35, width: 110, height: 110 });

  page.drawText("Verify at slash verify", { x: 60, y: 54, size: 9, font });

  tiledWatermark(page, "SAMPLE FICTIONAL NO LEGAL VALUE", bold);
}

function drawVisaPage(page, pageNo, font, bold){
  const s = page.getSize();
  page.drawRectangle({ x: 0, y: 0, width: s.width, height: s.height, color: rgb(0.985,0.99,0.995) });
  page.drawText("VISA PAGE SAMPLE", { x: 60, y: s.height - 80, size: 14, font: bold });
  page.drawText("PAGE " + pageNo, { x: s.width - 120, y: s.height - 80, size: 10, font: bold });

  let y = s.height - 140;
  for (let i = 0; i < 6; i++) {
    page.drawRectangle({ x: 60, y, width: s.width - 120, height: 120, borderColor: rgb(0,0,0), borderWidth: 0.6, opacity: 0.4 });
    page.drawText("SAMPLE STAMP", { x: 70, y + 90, size: 9, font: bold, opacity: 0.3 });
    y -= 150;
  }

  tiledWatermark(page, "SAMPLE FICTIONAL", bold);
}

export default async function handler(req, res){
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const b = req.body || {};
    if (!b.photoDataUrl) return res.status(400).send("Missing photo");

    const passportNo = "SPL-" + Math.floor(Math.random() * 1000000).toString().padStart(6, "0");

    const payload = {
      issuer: { name: "Republic of Sampleland", countryCode: "XAA" },
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
      doe: b.doe || "2035-01-01"
    };

    payload.mrz = makeMRZ({
      surname: payload.subject.surname,
      givenNames: payload.subject.givenNames,
      passportNo,
      dob: payload.subject.dob,
      doe: payload.doe,
      sex: payload.subject.sex
    });

    const msg = stableStringify(payload);
    const kp = nacl.sign.keyPair();
    const sig = nacl.sign.detached(naclUtil.decodeUTF8(msg), kp.secretKey);

    const bundle = {
      payload,
      signatureB64: naclUtil.encodeBase64(sig),
      publicKeyB64: naclUtil.encodeBase64(kp.publicKey)
    };
    const bundleBase64 = Buffer.from(JSON.stringify(bundle), "utf8").toString("base64");

    const qrDataUrl = await QRCode.toDataURL(bundleBase64, { margin: 1, scale: 6 });

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const { bytes: pb, mime } = await dataUrlToBytes(b.photoDataUrl);
    const photoImg = mime.includes("png") ? await pdf.embedPng(pb) : await pdf.embedJpg(pb);
    const { bytes: qb } = await dataUrlToBytes(qrDataUrl);
    const qrImg = await pdf.embedPng(qb);

    const cover = pdf.addPage([595.28, 841.89]);
    drawCover(cover, font, bold);

    const dataPage = pdf.addPage([595.28, 841.89]);
    drawDataPage(dataPage, payload, photoImg, qrImg, font, bold);

    for (let i = 3; i <= 8; i++) {
      const p = pdf.addPage([595.28, 841.89]);
      drawVisaPage(p, i, font, bold);
    }

    const pdfBytes = await pdf.save();

    res.status(200).json({
      filename: "fictional-passport-" + passportNo + ".pdf",
      pdfBase64: Buffer.from(pdfBytes).toString("base64"),
      bundleBase64
    });
  } catch (e) {
    res.status(400).send(String(e.message || e));
  }
}
