/**
 * lumeo_pdf.js — Professional PDF Creator
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 * Templates: Receipt/Invoice, Certificate, Exam, Letter, CV, General
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const TMP  = "/tmp";

const BRAND = { dark: "#1a1a2e", accent: "#c8a415", text: "#1a202c", sub: "#4a5568", light: "#f7f9fc", muted: "#718096" };

function detectType(t, c) {
  const s = ((t || "") + " " + (c || "")).toLowerCase();
  if (/\bcv\b|resume|curriculum vitae|professional summary|work experience/i.test(s)) return "cv";
  if (/receipt|payment|paid|amount|invoice|total.*₦|naira/i.test(s))               return "invoice";
  if (/certificate|certif|awarded|hereby certify|completion/i.test(s))              return "certificate";
  if (/exam|question.*\d|time allowed|instruction.*student/i.test(s))               return "exam";
  if (/dear\s|yours sincerely|yours faithfully|formal letter/i.test(s))             return "letter";
  return "general";
}

function hr(doc, y, color = "#e2e8f0", w = 1) {
  doc.save().moveTo(50, y).lineTo(doc.page.width - 50, y).lineWidth(w).strokeColor(color).stroke().restore();
}

async function createPDF(rawContent, title = "Lumeo Document") {
  const PDFDoc  = require("pdfkit");
  const ts      = Date.now();
  const out     = path.join(TMP, `lumeo_pdf_${ts}.pdf`);
  const docType = detectType(title, rawContent);

  console.log(`[PDF] Building ${docType}: "${title.slice(0, 50)}"`);

  return new Promise((resolve) => {
    try {
      const doc = new PDFDoc({ margin: 0, size: "A4", autoFirstPage: true, info: { Title: title, Author: "Lumeo AI — EMEMZYVISUALS DIGITALS" } });
      const ws  = fs.createWriteStream(out);
      doc.pipe(ws);
      const PW = doc.page.width;
      const PH = doc.page.height;

      if (docType === "invoice") {
        // ─ Header ────
        doc.rect(0, 0, PW, 80).fill(BRAND.dark);
        doc.fontSize(22).font("Helvetica-Bold").fillColor("white").text("EMEMZYVISUALS DIGITALS", 50, 18);
        doc.fontSize(9).font("Helvetica").fillColor("#a0aec0").text("DIGITALS", 50, 44);
        doc.fontSize(10).fillColor("white").text("INVOICE", PW - 120, 22);
        const invNo = "INV-" + Date.now().toString().slice(-6);
        doc.fontSize(9).fillColor("#a0aec0").text(`No: ${invNo}`, PW - 120, 38);
        doc.text(`Date: ${new Date().toLocaleDateString("en-NG")}`, PW - 120, 52);
        doc.rect(0, 80, PW, 28).fill(BRAND.accent);
        doc.fontSize(8).font("Helvetica").fillColor(BRAND.dark).text("info@ememzyvisuals.com  |  +234 904 711 5612  |  Nigeria (GMT+1)", 50, 90, { width: PW - 100, align: "center" });

        // ─ Billing blocks ────
        doc.rect(50, 125, 235, 80).fill("#f9fafb").stroke("#e2e8f0");
        doc.rect(305, 125, 235, 80).fill("#f9fafb").stroke("#e2e8f0");
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND.sub).text("FROM:", 60, 133);
        doc.fontSize(10).font("Helvetica-Bold").fillColor(BRAND.dark).text("EMEMZYVISUALS DIGITALS", 60, 147);
        doc.fontSize(9).font("Helvetica").fillColor(BRAND.sub).text("Emmanuel.A — CEO & Founder\nNigeria | GMT+1", 60, 162);

        const clientMatch = rawContent.match(/(?:for|client|customer|bill to)[:\s]+([^\n,\.]{3,50})/i);
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND.sub).text("TO:", 315, 133);
        doc.fontSize(10).font("Helvetica-Bold").fillColor(BRAND.dark).text(clientMatch ? clientMatch[1].trim() : "Client", 315, 147);

        // ─ Items table ────
        const colW = [250, 80, 80, 80];
        const tTop = 222;
        doc.rect(50, tTop, 490, 22).fill(BRAND.dark);
        ["DESCRIPTION", "QTY", "UNIT PRICE", "AMOUNT"].forEach((h, i) => {
          let x = 50; for (let j = 0; j < i; j++) x += colW[j];
          doc.fontSize(9).font("Helvetica-Bold").fillColor("white").text(h, x + 6, tTop + 7, { width: colW[i] - 8, lineBreak: false });
        });

        let tY = tTop + 22, total = 0, rowN = 0;
        for (const line of rawContent.split("\n")) {
          const t = line.trim(); if (!t || /^(for|client|date|receipt|invoice)/i.test(t)) continue;
          const amtMatch = t.match(/[₦#$€£]?\s*([0-9,]{3,}(?:\.[0-9]{2})?)/);
          const amt = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : 0;
          if (amt > 0) {
            doc.rect(50, tY, 490, 20).fill(rowN % 2 === 0 ? "#f9fafb" : "white");
            const desc = t.replace(/[₦#$€£]\s*[0-9,]+(?:\.[0-9]{2})?/, "").trim().slice(0, 40);
            doc.fontSize(9.5).font("Helvetica").fillColor(BRAND.text).text(desc || "Service", 56, tY + 6, { width: 242, lineBreak: false });
            doc.text("1", 306, tY + 6, { width: 72, lineBreak: false });
            doc.text(`₦${amt.toLocaleString()}`, 386, tY + 6, { width: 72, lineBreak: false });
            doc.text(`₦${amt.toLocaleString()}`, 466, tY + 6, { width: 72, lineBreak: false });
            total += amt; tY += 20; rowN++;
          }
        }
        if (rowN === 0) { doc.rect(50, tY, 490, 20).fill("#f9fafb"); doc.fontSize(9.5).font("Helvetica").fillColor(BRAND.text).text(title.replace(/receipt|invoice/gi, "").trim() || "Professional Service", 56, tY + 6, { width: 242, lineBreak: false }); tY += 20; }

        hr(doc, tY + 5);
        doc.rect(320, tY + 8, 220, 24).fill(BRAND.dark);
        doc.fontSize(10).font("Helvetica-Bold").fillColor("white").text("TOTAL DUE:", 328, tY + 15, { width: 100 });
        doc.text(`₦${total ? total.toLocaleString() : "—"}`, 425, tY + 15, { width: 110, align: "right" });

        doc.rect(50, tY + 42, 235, 58).fill("#f9fafb").stroke("#e2e8f0");
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND.sub).text("PAYMENT INFO", 60, tY + 50);
        doc.fontSize(9).font("Helvetica").fillColor(BRAND.text).text("Bank: GTBank Nigeria\nAccount: EMEMZYVISUALS DIGITALS\nContact for sort code", 60, tY + 62);

        doc.moveTo(320, tY + 78).lineTo(520, tY + 78).lineWidth(0.5).stroke("#999");
        doc.fontSize(8).fillColor(BRAND.muted).text("Authorized Signature | EMEMZYVISUALS DIGITALS", 320, tY + 82);
        doc.rect(0, PH - 35, PW, 35).fill(BRAND.dark);
        doc.fontSize(8).font("Helvetica").fillColor("#a0aec0").text("Thank you for your business! • Generated by Lumeo AI • EMEMZYVISUALS DIGITALS", 50, PH - 22, { width: PW - 100, align: "center" });

      } else if (docType === "certificate") {
        doc.rect(15, 15, PW - 30, PH - 30).lineWidth(5).strokeColor(BRAND.accent).stroke();
        doc.rect(25, 25, PW - 50, PH - 50).lineWidth(1).strokeColor(BRAND.accent).stroke();
        doc.rect(25, 25, PW - 50, 100).fill(BRAND.dark);
        [[30,30],[PW-30,30],[30,PH-30],[PW-30,PH-30]].forEach(([cx,cy]) => { doc.save().translate(cx,cy).rotate(45).rect(-8,-8,16,16).fill(BRAND.accent).restore(); });
        doc.fontSize(9).font("Helvetica").fillColor(BRAND.accent).text("EMEMZYVISUALS DIGITALS", 0, 42, { width: PW, align: "center" });
        doc.fontSize(30).font("Helvetica-Bold").fillColor("white").text("CERTIFICATE", 0, 62, { width: PW, align: "center" });
        doc.fillColor("#888").fontSize(13).font("Helvetica").text("— OF —", 0, 138, { width: PW, align: "center" });
        const certType = title.replace(/certificate/i, "").trim().toUpperCase() || "ACHIEVEMENT";
        doc.fontSize(22).font("Helvetica-Bold").fillColor(BRAND.dark).text(certType, 0, 160, { width: PW, align: "center" });
        doc.moveTo(150, 197).lineTo(PW - 150, 197).lineWidth(2).strokeColor(BRAND.accent).stroke();
        doc.fontSize(12).font("Helvetica").fillColor(BRAND.sub).text("This is to certify that", 0, 212, { width: PW, align: "center" });
        const lines = rawContent.split("\n").filter(l => l.trim());
        const nameLine = lines.find(l => l.trim().split(" ").length <= 4 && !/[.,:;]/.test(l) && l.trim().length > 2) || "";
        doc.fontSize(24).font("Helvetica-BoldOblique").fillColor(BRAND.dark).text(nameLine || "—", 0, 234, { width: PW, align: "center" });
        let y = 270;
        for (const line of lines) { if (!line.trim() || line.trim() === nameLine) continue; if (y > PH - 140) break; doc.fontSize(11).font("Helvetica").fillColor(BRAND.sub).text(line.trim(), 80, y, { width: PW - 160, align: "center" }); y = doc.y + 4; }
        const dStr = new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
        doc.moveTo(80, PH - 120).lineTo(220, PH - 120).stroke("#aaa");
        doc.moveTo(PW - 220, PH - 120).lineTo(PW - 80, PH - 120).stroke("#aaa");
        doc.fontSize(9).fillColor(BRAND.sub).text(dStr, 80, PH - 115, { width: 140, align: "center" }).text("Authorized Signature", PW - 220, PH - 115, { width: 140, align: "center" });
        doc.rect(25, PH - 58, PW - 50, 30).fill(BRAND.accent);
        doc.fontSize(9).font("Helvetica-Bold").fillColor(BRAND.dark).text("EMEMZYVISUALS DIGITALS  •  Issued by Lumeo AI  •  Authentic & Verified", 25, PH - 48, { width: PW - 50, align: "center" });

      } else if (docType === "exam") {
        doc.rect(0, 0, PW, 90).fill(BRAND.dark);
        doc.fontSize(14).font("Helvetica-Bold").fillColor("white").text("EMEMZYVISUALS DIGITALS EDUCATIONAL INSTITUTE", 0, 14, { width: PW, align: "center" });
        doc.fontSize(16).fillColor(BRAND.accent).text(title.toUpperCase(), 0, 36, { width: PW, align: "center" });
        doc.rect(0, 90, PW, 28).fill(BRAND.accent);
        doc.fontSize(9).font("Helvetica").fillColor(BRAND.dark)
          .text(`Date: ${new Date().toLocaleDateString("en-NG")}`, 55, 100, { width: 130 })
          .text("Time Allowed: _____ Hrs", 200, 100, { width: 150 })
          .text("Total Marks: _____", 370, 100, { width: 130, align: "right" });
        doc.rect(50, 130, PW - 100, 36).fill("#fff9e6").stroke(BRAND.accent);
        doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND.dark).text("INSTRUCTIONS:", 58, 140);
        doc.font("Helvetica").fillColor(BRAND.sub).text("1. Answer all questions clearly.  2. No unauthorized materials.  3. Write your name and index number.", 130, 140, { width: PW - 180 });
        doc.rect(50, 178, PW - 100, 26).fill("#f9fafb").stroke("#e2e8f0");
        doc.fontSize(9).font("Helvetica").fillColor(BRAND.sub).text("Name: ___________________", 60, 186, { width: 220 }).text("Index No: ____________", 290, 186, { width: 160 }).text("Class: __________", 460, 186, { width: 90 });
        hr(doc, 214, BRAND.accent, 1);
        let qy = 222, qnum = 0;
        for (const line of rawContent.split("\n")) {
          const t = line.trim(); if (!t) { qy += 4; continue; } if (qy > PH - 70) break;
          if (/^section\s+[a-z]/i.test(t) || /^part\s+[a-z1-9]/i.test(t)) {
            qy += 8; doc.rect(50, qy, PW - 100, 20).fill(BRAND.dark); doc.fontSize(10).font("Helvetica-Bold").fillColor("white").text(t.toUpperCase(), 58, qy + 6, { width: PW - 120 }); qy += 28;
          } else if (/^\d+[.)]\s/.test(t)) {
            qnum++;
            doc.rect(50, qy - 1, PW - 100, 18).fill(qnum % 2 === 0 ? "#f9fafb" : "white");
            doc.fontSize(10.5).font("Helvetica-Bold").fillColor(BRAND.dark).text(`${qnum}.`, 54, qy + 2, { width: 20 });
            doc.font("Helvetica").fillColor(BRAND.text).text(t.replace(/^\d+[.)]\s*/, ""), 76, qy + 2, { width: PW - 140 }); qy = doc.y + 4;
            doc.moveTo(76, qy + 6).lineTo(PW - 55, qy + 6).lineWidth(0.3).stroke("#ccc"); qy += 18;
          } else if (/^[a-d][.)]\s/i.test(t)) {
            doc.fontSize(10).font("Helvetica").fillColor(BRAND.sub).text("○  " + t, 76, qy, { width: 200 }); qy = doc.y + 2;
          } else { doc.fontSize(10).font("Helvetica").fillColor(BRAND.sub).text(t, 76, qy, { width: PW - 136 }); qy = doc.y + 2; }
        }
        doc.rect(0, PH - 35, PW, 35).fill(BRAND.dark);
        doc.fontSize(8).font("Helvetica").fillColor("#a0aec0").text("EMEMZYVISUALS DIGITALS  •  Generated by Lumeo AI  •  Confidential", 50, PH - 22, { width: PW - 100, align: "center" });

      } else if (docType === "letter") {
        doc.rect(0, 0, PW, 75).fill(BRAND.dark);
        doc.fontSize(18).font("Helvetica-Bold").fillColor("white").text("EMEMZYVISUALS DIGITALS", 50, 16, { width: PW - 100 });
        doc.fontSize(9).font("Helvetica").fillColor("#a0aec0").text("info@ememzyvisuals.com  |  +234 904 711 5612  |  Nigeria", 50, 42);
        doc.rect(0, 75, PW, 5).fill(BRAND.accent);
        doc.fontSize(10).font("Helvetica").fillColor(BRAND.text).text(new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }), 50, 98, { width: PW - 100, align: "right" });
        let y = 125;
        for (const line of rawContent.split("\n")) {
          const t = line.trim(); if (!t) { y += 8; continue; } if (y > PH - 70) break;
          if (/^(re:|subject:)/i.test(t)) { y += 4; doc.fontSize(11).font("Helvetica-Bold").fillColor(BRAND.dark).text(t, 50, y, { width: PW - 100 }); y = doc.y + 2; hr(doc, y, BRAND.dark, 1); y += 10; }
          else if (/^(dear |to whom)/i.test(t)) { doc.fontSize(11).font("Helvetica-Bold").fillColor(BRAND.text).text(t, 50, y, { width: PW - 100 }); y = doc.y + 12; }
          else if (/^(yours |sincerely|regards|best regards)/i.test(t)) { y += 8; doc.fontSize(11).font("Helvetica").fillColor(BRAND.text).text(t, 50, y, { width: PW - 100 }); y += 35; doc.moveTo(50, y).lineTo(200, y).lineWidth(0.5).stroke("#aaa"); y += 6; doc.fontSize(10).font("Helvetica-Bold").fillColor(BRAND.dark).text("EMEMZYVISUALS DIGITALS", 50, y); y = doc.y + 3; doc.fontSize(9).font("Helvetica").fillColor(BRAND.sub).text("Emmanuel.A — CEO & Founder", 50, y); y = doc.y; }
          else { doc.fontSize(11).font("Helvetica").fillColor(BRAND.text).text(t, 50, y, { width: PW - 100, align: "justify" }); y = doc.y + 5; }
        }
        doc.rect(0, PH - 35, PW, 35).fill("#f9fafb").stroke("#e2e8f0");
        doc.fontSize(8).fillColor(BRAND.muted).text("Generated by Lumeo AI  •  EMEMZYVISUALS DIGITALS", 50, PH - 22, { width: PW - 100, align: "center" });

      } else if (docType === "cv") {
        const SW = 175, MX = SW + 20, MW = PW - MX - 30;
        doc.rect(0, 0, SW, PH).fill(BRAND.dark);
        const nameMatch = rawContent.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+)+)/m);
        const fullName  = nameMatch ? nameMatch[1] : title.replace(/resume|cv|pdf/gi, "").trim();
        const parts     = fullName.trim().split(" ");
        doc.fontSize(20).font("Helvetica-Bold").fillColor("white").text(parts[0] || "Name", 15, 28);
        if (parts.length > 1) doc.fontSize(18).font("Helvetica").fillColor(BRAND.accent).text(parts.slice(1).join(" "), 15, doc.y);
        const roleM = rawContent.match(/Full.?Stack|AI Engineer|Developer|Engineer|Designer|Specialist/i);
        if (roleM) doc.fontSize(9).font("Helvetica").fillColor("#a0aec0").text(roleM[0], 15, doc.y + 5);

        let sy = doc.y + 18;
        function sbSec(label) { sy += 10; doc.fillColor(BRAND.accent).fontSize(8).font("Helvetica-Bold").text(label.toUpperCase(), 15, sy, { width: SW - 20 }); sy += 12; doc.moveTo(15, sy).lineTo(SW - 10, sy).lineWidth(0.5).stroke(BRAND.accent); sy += 6; doc.fillColor("#e2e8f0").fontSize(8).font("Helvetica"); }
        function sbLine(t) { if (sy > PH - 60 || !t) return; doc.text(t.slice(0, 36), 15, sy, { width: SW - 20 }); sy = doc.y + 2; }

        const emailM = rawContent.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
        const phoneM = rawContent.match(/[+]?[\d\s()-]{7,20}/);
        sbSec("Contact");
        if (emailM) sbLine("✉ " + emailM[0]);
        if (phoneM) sbLine("📱 " + phoneM[0].trim().slice(0, 20));
        sbLine("🌍 Nigeria (GMT+1)");

        sbSec("Tech Stack");
        const techM = rawContent.match(/\b(?:JavaScript|TypeScript|Node\.js|React|Python|Supabase|Firebase|Groq|Tailwind|Express|REST|HTML|CSS)\b/gi) || [];
        [...new Set(techM)].slice(0, 10).forEach(sk => sbLine("▸ " + sk));

        sbSec("Portfolio");
        const urlM = rawContent.match(/[a-z0-9-]+\.(vercel|app|io|com|ng)\S*/gi) || [];
        [...new Set(urlM)].slice(0, 3).forEach(u => { if (sy > PH - 60) return; doc.fillColor("#63b3ed").fontSize(8).text(u.slice(0, 36), 15, sy, { width: SW - 20 }); sy = doc.y + 2; });

        doc.rect(SW, 0, PW - SW, 72).fill("#f7fafc");
        doc.fillColor(BRAND.dark).fontSize(22).font("Helvetica-Bold").text(fullName, MX, 16, { width: MW });
        doc.fillColor(BRAND.sub).fontSize(9.5).font("Helvetica").text("EMEMZYVISUALS DIGITALS  ·  Full-Stack & AI Engineer", MX, doc.y + 2, { width: MW });
        doc.rect(SW, 72, PW - SW, 24).fill(BRAND.accent);
        const contactInfo = [emailM?.[0], phoneM?.[0]?.trim().slice(0, 16), "Nigeria"].filter(Boolean).join("  ·  ");
        doc.fontSize(8).font("Helvetica").fillColor(BRAND.dark).text(contactInfo, MX, 80, { width: MW, align: "center" });

        let my = 106;
        function mSec(label) { if (my > PH - 60) return; my += 6; doc.rect(MX, my, MW, 18).fill(BRAND.dark); doc.fillColor("white").fontSize(9).font("Helvetica-Bold").text(label.toUpperCase(), MX + 8, my + 5, { width: MW - 16 }); my += 22; doc.fillColor("#333").font("Helvetica").fontSize(9); }
        function mLine(t, indent = 0) { if (my > PH - 55 || !t.trim()) return; doc.text(t.trim(), MX + indent, my, { width: MW - indent, align: "justify" }); my = doc.y + 2; }

        let curSec = "";
        for (const line of rawContent.split("\n")) {
          const t = line.trim(); if (!t) { my += 4; continue; } if (my > PH - 55) break;
          if (/Professional Summary/i.test(t)) { mSec("Professional Summary"); curSec = "summary"; }
          else if (/Core Competencies|Skills/i.test(t)) { mSec("Core Competencies"); curSec = "skills"; }
          else if (/Key Projects/i.test(t)) { mSec("Key Projects"); curSec = "projects"; }
          else if (/Professional Development/i.test(t)) { mSec("Professional Development"); curSec = "dev"; }
          else if (/Why.*Clients/i.test(t)) { mSec("Why Clients Choose Me"); curSec = "why"; }
          else if (/^[A-Z].*–\s|^ClaudGPT|^STUDENTHUB/i.test(t)) { doc.fillColor(BRAND.dark).fontSize(9.5).font("Helvetica-Bold").text("▶ " + t, MX + 5, my, { width: MW - 5 }); my = doc.y + 2; }
          else if (/Tech Stack|Business Impact|Live Demo|Founded/i.test(t)) { doc.fillColor(BRAND.accent).fontSize(8.5).font("Helvetica-Bold").text(t, MX + 10, my, { width: MW - 10 }); my = doc.y + 2; }
          else if (/^[-•▸]/.test(t) || curSec === "skills") { doc.fillColor("#555").fontSize(8.5).font("Helvetica").text("• " + t.replace(/^[-•▸]\s*/, ""), MX + 12, my, { width: MW - 12 }); my = doc.y + 2; }
          else { mLine(t.replace(/\*\*/g, ""), 5); }
        }
        doc.rect(0, PH - 28, PW, 28).fill(BRAND.dark);
        doc.fontSize(8).font("Helvetica").fillColor("#a0aec0").text("Generated by Lumeo AI  •  EMEMZYVISUALS DIGITALS", 50, PH - 18, { width: PW - 100, align: "center" });

      } else {
        // General document
        doc.rect(0, 0, PW, 65).fill(BRAND.dark);
        doc.fontSize(20).font("Helvetica-Bold").fillColor("white").text(title, 50, 18, { width: PW - 100 });
        doc.fontSize(9).font("Helvetica").fillColor("#a0aec0").text(`EMEMZYVISUALS DIGITALS  •  ${new Date().toLocaleDateString("en-NG")}`, 50, 44, { width: PW - 100 });
        doc.rect(0, 65, PW, 4).fill(BRAND.accent);
        let y = 83;
        for (const line of rawContent.split("\n")) {
          const t = line.trim(); if (!t) { y += 6; continue; } if (y > PH - 55) break;
          if (/^#{1,3}\s/.test(t) || (t.endsWith(":") && t.length < 60 && !t.includes("http"))) {
            y += 6; doc.rect(50, y, PW - 100, 20).fill(BRAND.dark); doc.fontSize(10).font("Helvetica-Bold").fillColor("white").text(t.replace(/^#{1,3}\s*/, "").replace(/:$/, "").toUpperCase(), 58, y + 6, { width: PW - 120 }); y += 28;
          } else if (/^[-•*]\s/.test(t)) { doc.fontSize(10).font("Helvetica").fillColor(BRAND.text).text("•  " + t.slice(2), 65, y, { width: PW - 120 }); y = doc.y + 3; }
          else if (/^\d+[.)]\s/.test(t)) { doc.fontSize(10).font("Helvetica").fillColor(BRAND.text).text(t, 58, y, { width: PW - 110 }); y = doc.y + 3; }
          else { doc.fontSize(10.5).font("Helvetica").fillColor(BRAND.text).text(t, 50, y, { width: PW - 100, align: "justify" }); y = doc.y + 4; }
        }
        doc.rect(0, PH - 30, PW, 30).fill(BRAND.dark);
        doc.fontSize(8).font("Helvetica").fillColor("#a0aec0").text("Generated by Lumeo AI  •  EMEMZYVISUALS DIGITALS", 50, PH - 19, { width: PW - 100, align: "center" });
      }

      doc.end();
      ws.on("finish", () => {
        const buf = fs.readFileSync(out);
        try { fs.unlinkSync(out); } catch {}
        console.log(`[PDF] ✅ ${(buf.length / 1024).toFixed(0)}KB "${title.slice(0, 40)}" (${docType})`);
        resolve({ success: true, buffer: buf, title, docType, filename: title.replace(/[^a-z0-9 ]/gi, "_").replace(/\s+/g, "_").slice(0, 60) + ".pdf" });
      });
      ws.on("error", e => { console.error("[PDF]", e.message); resolve({ success: false }); });
    } catch (e) { console.error("[PDF] Fatal:", e.message); resolve({ success: false }); }
  });
}

module.exports = { createPDF };
