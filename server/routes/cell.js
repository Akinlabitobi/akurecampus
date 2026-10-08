import { randomUUID } from "node:crypto";
import { addAuditLog } from "../auth.js";
import { cellMembers, cellOverview, idList, requireCellAccess, sameCellName, weekOf } from "../cells.js";
import { readDb, writeDb } from "../db.js";
import { cleanText, parseBody, send } from "../http.js";
import { createShortCode, displayName, lagosDateKey, phoneNumber } from "../records.js";

// Cell leaders: their cells' members and weekly reports.
export async function cellRoutes(req, res, url) {
  if (url.pathname === "/api/cell/overview" && req.method === "GET") {
    const db = await readDb();
    const ctx = requireCellAccess(req, res, db);
    if (!ctx) return true;
    send(res, 200, cellOverview(db, ctx));
    return true;
  }

  if (url.pathname === "/api/cell/reports" && req.method === "POST") {
    const db = await readDb();
    const ctx = requireCellAccess(req, res, db);
    if (!ctx) return true;
    try {
      const body = await parseBody(req);
      const cell = ctx.cells.find(name => sameCellName(name, cleanText(body.cell)));
      if (!cell) {
        send(res, 403, { error: "You can only send reports for your own cells." });
        return true;
      }
      const meetingDate = cleanText(body.meetingDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate) || Number.isNaN(Date.parse(`${meetingDate}T00:00:00Z`))) throw new Error("Please choose the meeting date.");
      if (meetingDate > lagosDateKey()) throw new Error("The meeting date can't be in the future.");
      const held = body.held === "no" ? "no" : "yes";
      const members = cellMembers(db, cell);
      const memberIds = new Set(members.map(member => member.id));
      const present = held === "yes" ? idList(body.present, memberIds) : [];
      const absent = held === "yes" ? members.map(member => member.id).filter(id => !present.includes(id)) : [];
      const visitors = held === "yes" && Array.isArray(body.visitors)
        ? body.visitors.slice(0, 50)
          .map(visitor => ({ name: cleanText(visitor?.name).slice(0, 120), phone: cleanText(visitor?.phone).slice(0, 30), addToCell: visitor?.addToCell !== false }))
          .filter(visitor => visitor.name)
        : [];
      const offering = Math.max(0, Math.round(Number(String(body.offering || "0").replace(/[^\d.]/g, "")) || 0));
      const leader = ctx.admin;

      // Visitors who want to join become cell members straight away (unless
      // already in this cell), so they're on the list at the next meeting.
      const added = [];
      for (const visitor of visitors.filter(item => item.addToCell)) {
        const phoneKey = visitor.phone.replace(/\D/g, "").slice(-10);
        const alreadyMember = db.submissions.some(record => record.type === "community"
          && sameCellName(record.fields.preferredCommunity, cell)
          && ((phoneKey.length === 10 && String(phoneNumber(record.fields)).replace(/\D/g, "").slice(-10) === phoneKey)
            || displayName(record.fields).toLowerCase() === visitor.name.toLowerCase()));
        if (alreadyMember) continue;
        const record = {
          id: randomUUID(),
          type: "community",
          fields: { fullName: visitor.name, name: visitor.name, phoneNumber: visitor.phone, preferredCommunity: cell, addedBy: `${leader.name} (cell report ${meetingDate})` },
          shortCode: createShortCode(db),
          status: "Added by cell leader",
          createdAt: new Date().toISOString()
        };
        db.submissions.push(record);
        added.push(visitor.name);
      }

      const fields = {
        cell,
        meetingDate,
        week: weekOf(meetingDate),
        held,
        topic: cleanText(body.topic).slice(0, 200),
        notes: cleanText(body.notes),
        offering,
        present,
        absent,
        visitors: visitors.map(({ name, phone }) => ({ name, phone })),
        memberCount: members.length,
        presentCount: present.length,
        visitorCount: visitors.length,
        leaderId: leader.id,
        leaderName: leader.name
      };
      // One report per cell per week: any date in the same week edits it.
      const existing = db.submissions.find(record => record.type === "cell_report" && sameCellName(record.fields.cell, cell) && weekOf(record.fields.meetingDate) === fields.week);
      if (existing) {
        existing.fields = fields;
        existing.updatedAt = new Date().toISOString();
      } else {
        db.submissions.push({
          id: /^[0-9a-f-]{36}$/i.test(String(body.submissionId)) && !db.submissions.some(record => record.id === body.submissionId) ? body.submissionId : randomUUID(),
          type: "cell_report",
          fields,
          shortCode: createShortCode(db),
          status: "Submitted",
          createdAt: new Date().toISOString()
        });
      }
      addAuditLog(db, leader, existing ? "Updated cell report" : "Submitted cell report", `${cell} - ${meetingDate}${added.length ? ` (added ${added.length} visitor${added.length === 1 ? "" : "s"} to the cell)` : ""}`);
      await writeDb(db);
      send(res, existing ? 200 : 201, { updated: Boolean(existing), added, overview: cellOverview(db, ctx) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  return false;
}
