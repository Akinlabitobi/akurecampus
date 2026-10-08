import { send } from "./http.js";
import { adminRoutes } from "./routes/admin.js";
import { broadcastRoutes } from "./routes/broadcast.js";
import { cellRoutes } from "./routes/cell.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { memberRoutes } from "./routes/member.js";
import { publicRoutes } from "./routes/public.js";

// Each route group returns true once it has answered the request.
export async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return true;
  }

  if (await publicRoutes(req, res, url)) return true;
  if (await memberRoutes(req, res, url)) return true;
  if (await cellRoutes(req, res, url)) return true;
  if (await adminRoutes(req, res, url)) return true;
  if (await broadcastRoutes(req, res, url)) return true;
  if (await dashboardRoutes(req, res, url)) return true;
  return false;
}
