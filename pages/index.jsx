import React, { useMemo, useState } from "react";

export default function Home() {
  const [photoFile, setPhotoFile] = useState(null);
  const [form, setForm] = useState({
    surname: "DOE",
    givenNames: "JANE",
    nationality: "SAMPLELAND",
    sex: "X",
    dob: "1990-01-01",
    pob: "SAMPLE CITY",
    doi: "2025-01-01",
    doe: "2035-01-01",
  });
  const [result, setResult] = useState(null);
  const canIssue = useMemo(() => !!photoFile, [photoFile]);

  async function toDataUrl(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:${file.type};base64,${btoa(bin)}`;
  }

  async function issue() {
    if (!photoFile) return;

    const photoDataUrl = await toDataUrl(photoFile);
    const r = await fetch("/api/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, photoDataUrl }),
    });

    if (!r.ok) return alert(await r.text());

    const data = await r.json();
    setResult(data);

    // download PDF
    const pdfBytes = Uint8Array.from(atob(data.pdfBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename || "fictional-epassport.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: 18, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <div style={{ background: "#fff", border: "1px solid #e6e8ee", borderRadius: 16, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Fictional ePassport Issuer (Booklet)</h2>
            <div style={{ marginTop: 6, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
              Generates a <b>multi-page</b> fictional passport-like PDF booklet (cover + data page + visa pages) with
              guilloché-style patterns, microtext, QR bundle and Ed25519 signature.{" "}
              Verify at <a href="/verify" target="_blank" rel="noreferrer">/verify</a>.
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#666" }}>
            <div><b>Mode:</b> FICTIONAL / SAMPLE</div>
            <div><b>Country code:</b> XAA</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 14, marginTop: 14 }}>
        <div style={{ background: "#fff", border: "1px solid #e6e8ee", borderRadius: 16, padding: 14 }}>
          <h3 style={{ margin: "0 0 10px" }}>Input</h3>

          <Label>Photo</Label>
          <input style={I} type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />

          <div style={ROW}>
            <div style={{ flex: 1 }}>
              <Label>Surname</Label>
              <input style={I} value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <Label>Given Names</Label>
              <input style={I} value={form.givenNames} onChange={(e) => setForm({ ...form, givenNames: e.target.value })} />
            </div>
          </div>

          <div style={ROW}>
            <div style={{ flex: 1 }}>
              <Label>Nationality</Label>
              <input style={I} value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <Label>Sex</Label>
              <select style={I} value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
                <option value="X">X</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </div>
          </div>

          <div style={ROW}>
            <div style={{ flex: 1 }}>
              <Label>Date of Birth</Label>
              <input style={I} type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <Label>Place of Birth</Label>
              <input style={I} value={form.pob} onChange={(e) => setForm({ ...form, pob: e.target.value })} />
            </div>
          </div>

          <div style={ROW}>
            <div style={{ flex: 1 }}>
              <Label>Date of Issue</Label>
              <input style={I} type="date" value={form.doi} onChange={(e) => setForm({ ...form, doi: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <Label>Date of Expiry</Label>
              <input style={I} type="date" value={form.doe} onChange={(e) => setForm({ ...form, doe: e.target.value })} />
            </div>
          </div>

          <button
            onClick={issue}
            disabled={!canIssue}
            style={{
              marginTop: 12, width: "100%", padding: 11, borderRadius: 12,
              border: 0, background: "#0b3c5d", color: "#fff",
              cursor: "pointer", opacity: canIssue ? 1 : 0.6
            }}
          >
            Issue Booklet & Download PDF
          </button>

          <div style={{ marginTop: 10, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
            每页都会强制叠加 <b>SAMPLE / FICTIONAL / NO LEGAL VALUE</b> 水印与微缩字，不能用来冒充真实护照。
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e6e8ee", borderRadius: 16, padding: 14 }}>
          <h3 style={{ margin: "0 0 10px" }}>Result JSON</h3>
          {!result ? (
            <div style={{ fontSize: 12, color: "#666" }}>发行后这里会显示 payload / signature / publicKey / bundleBase64。</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={badge}>Passport No: {result.payload?.passportNo}</span>
                <span style={badge}>Pages: cover + data + visa pages</span>
                <span style={badge}>Verify: /verify</span>
              </div>
              <Label>bundleBase64 (paste into /verify)</Label>
              <textarea style={{ ...I, height: 110, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }} readOnly value={result.bundleBase64 || ""} />
              <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#0b0f1a", color: "#cfe6ff", padding: 12, borderRadius: 14 }}>
                {JSON.stringify(result, null, 2)}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <div style={{ marginTop: 10, marginBottom: 6, fontSize: 12, color: "#444" }}>{children}</div>;
}

const I = { width: "100%", padding: 10, borderRadius: 12, border: "1px solid #d7dbe6", fontSize: 14, background: "#fff" };
const ROW = { display: "flex", gap: 10, flexWrap: "wrap" };
const badge = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: 999,
  background: "#fff",
  border: "1px solid #e6e8ee",
  fontSize: 12
};
