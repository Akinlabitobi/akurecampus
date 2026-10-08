import { communityOf, departmentOf } from "../../src/lib/communities.js";
import { requireAdminSession } from "../auth.js";
import { csv, csvBirthdays, csvCommunity, csvWorkforce } from "../csv.js";
import { readDb } from "../db.js";
import { send } from "../http.js";
import { dashboard } from "../records.js";

// Dashboard data and CSV export.
export async function dashboardRoutes(req, res, url) {
  if (url.pathname === "/api/dashboard" && req.method === "GET") {
    const db = await readDb();
    const ctx = requireAdminSession(req, res, db, "view_dashboard");
    if (!ctx) return true;
    send(res, 200, dashboard(db));
    return true;
  }

  if (url.pathname === "/api/export" && req.method === "GET") {
    const db = await readDb();
    const ctx = requireAdminSession(req, res, db, "export_data");
    if (!ctx) return true;
    const type = url.searchParams.get("type");
    let body;
    let filename;
    if (type === "community") {
      body = csvCommunity(db.submissions.filter(communityOf));
      filename = "harvesters-akure-communities.csv";
    } else if (type === "workforce") {
      body = csvWorkforce(db.submissions.filter(departmentOf));
      filename = "harvesters-akure-workforce.csv";
    } else if (type === "birthday") {
      const protocol = String(req.headers["x-forwarded-proto"] || url.protocol.replace(":", "")).split(",")[0];
      body = csvBirthdays(db.submissions.filter(record => record.type === "birthday"), `${protocol}://${url.host}`);
      filename = "harvesters-akure-birthdays.csv";
    } else {
      body = csv(db.submissions);
      filename = "harvesters-akure-submissions.csv";
    }
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    send(res, 200, body, "text/csv; charset=utf-8");
    return true;
  }

  return false;
}
