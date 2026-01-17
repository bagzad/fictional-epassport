import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

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
  if (!m) throw new Error("Invalid photoDataUrl");
  return { bytes: Buffer.from(m[2], "base64"), mime: m[1] };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    const b = req.body || {};
    const passportNo = "SPL-" + Math.floor(Math.random() * 1e6).toString().padStart(6, "0");

    const payload = {
      schema: "fictional-epassport.v1",
      issuer: {
        name: "Sampleland (Fictional)",
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

    payload.mrz = makeMRZ({ ...payload.subject, passportNo, dob: payload.subject.dob, doe: payload.doe, sex: payload.subject.sex });

    // Sign
    const msg = stableStringify(payload);
    const kp = nacl.sign.keyPair();
    const sig = nacl.sign.detached(naclUtil.decodeUTF8(msg), kp.secretKey);

    const bundle = {
      payload,
      signatureB64: naclUtil.encodeBase64(sig),
      publicKeyB64: naclUtil.encodeBase64(kp.publicKey),
    };
    const bundleBase64 = Buffer.from(JSON.stringify(bundle), "utf8").toString("base64");

    // QR encodes bundleBase64
    const qrDataUrl = await QRCode.toDataURL(bundleBase64, { margin: 1, scale: 6 });

    // PDF build
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Header block
    page.drawRectangle({ x: 40, y: 650, width: 515, height: 150, color: rgb(0.05, 0.23, 0.36) });
    page.drawText("FICTIONAL PASSPORT (SAMPLE)", { x: 58, y: 765, size: 18, font: bold, color: rgb(1,1,1) });
    page.drawText("NO LEGAL VALUE • FOR DEMO/RESEARCH ONLY", { x: 58, y: 742, size: 10, font, color: rgb(1,1,1) });

    // Watermark
    page.drawText("SAMPLE • FICTIONAL • NO LEGAL VALUE", {
      x: 70, y: 420, size: 28, font: bold, color: rgb(0.7,0.7,0.7),
      rotate: degrees(25), opacity: 0.18
    });

    // Photo
    const { bytes: pb, mime } = await dataUrlToBytes(b.photoDataUrl);
    const pimg = mime.includes("png") ? await pdf.embedPng(pb) : await pdf.embedJpg(pb);
    page.drawRectangle({ x: 60, y: 520, width: 140, height: 180, borderColor: rgb(0.2,0.2,0.2), borderWidth: 1, color: rgb(1,1,1) });
    page.drawImage(pimg, { x: 62, y: 522, width: 136, height: 176 });

    // Fields
    const leftX = 220, topY = 690, lineH = 18;
    const lines = [
      ["Passport No", passportNo],
      ["Surname", payload.subject.surname],
      ["Given Names", payload.subject.givenNames],
      ["Nationality", payload.subject.nationality],
      ["Sex", payload.subject.sex],
      ["Date of Birth", payload.subject.dob],
      ["Place of Birth", payload.subject.pob],
      ["Date of Issue", payload.doi],
      ["Date of Expiry", payload.doe],
      ["Issuer Country Code", payload.issuer.countryCode],
    ];
    page.drawText("PERSONAL DATA (SAMPLE)", { x: leftX, y: topY + 10, size: 12, font: bold, color: rgb(0,0,0) });
    lines.forEach((kv, i) => {
      const y = topY - i * lineH;
      page.drawText(`${kv[0]}:`, { x: leftX, y, size: 10, font: bold, color: rgb(0,0,0) });
      page.drawText(String(kv[1]), { x: leftX + 140, y, size: 10, font, color: rgb(0,0,0) });
    });

    // MRZ-like
    page.drawRectangle({ x: 60, y: 220, width: 475, height: 70, borderColor: rgb(0.2,0.2,0.2), borderWidth: 1, color: rgb(0.96,0.96,0.96) });
    page.drawText("MRZ-LIKE (FICTIONAL)", { x: 62, y: 284, size: 9, font: bold, color: rgb(0.2,0.2,0.2) });
    page.drawText(payload.mrz.line1, { x: 70, y: 255, size: 11, font, color: rgb(0,0,0) });
    page.drawText(payload.mrz.line2, { x: 70, y: 235, size: 11, font, color: rgb(0,0,0) });

    // QR
    const { bytes: qb } = await dataUrlToBytes(qrDataUrl);
    const qrImg = await pdf.embedPng(qb);
    page.drawText("Verify: paste bundleBase64 into /verify", { x: 60, y: 195, size: 9, font, color: rgb(0.2,0.2,0.2) });
    page.drawRectangle({ x: 435, y: 60, width: 100, height: 100, borderColor: rgb(0.2,0.2,0.2), borderWidth: 1, color: rgb(1,1,1) });
    page.drawImage(qrImg, { x: 437, y: 62, width: 96, height: 96 });

    // Return
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
