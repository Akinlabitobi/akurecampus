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

export const contactInfo = Object.freeze({
  phone: "0811 723 7752",
  phoneHref: "tel:+2348117237752"
});

export const socialLinks = Object.freeze([
  { name: "Facebook", handle: "@harvestersakure", url: "https://www.facebook.com/harvestersakure" },
  { name: "Instagram", handle: "@harvestersakure", url: "https://www.instagram.com/harvestersakure" },
  { name: "TikTok", handle: "@harvestersakure", url: "https://www.tiktok.com/@harvestersakure" }
]);



