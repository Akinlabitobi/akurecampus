function readPublicUrl(name) {
  const value = import.meta.env[name]?.trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export const externalLinks = Object.freeze({
  dailyPrayer: readPublicUrl("VITE_DAILY_PRAYER_URL"),
  weeklyPrayerWhatsapp: readPublicUrl("VITE_WEEKLY_PRAYER_WHATSAPP_URL"),
  giving: readPublicUrl("VITE_GIVING_URL")
});



