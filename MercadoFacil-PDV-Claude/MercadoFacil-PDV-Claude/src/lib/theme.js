// Convert hex color to HSL string (e.g., "#006669" → "180 100% 20%")
export function hexToHsl(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// Darken an HSL string by a factor (0-1)
function darkenHsl(hslStr, factor) {
  const parts = hslStr.split(" ");
  const h = parseInt(parts[0]);
  const s = parseInt(parts[1]);
  const l = parseInt(parts[2]);
  return `${h} ${s}% ${Math.max(5, Math.round(l * factor))}%`;
}

// Apply theme colors to CSS custom properties
export function applyTheme(primaryHex, menuHex) {
  const root = document.documentElement;
  const primaryHsl = hexToHsl(primaryHex);
  const menuHsl = hexToHsl(menuHex);

  // Primary-related variables
  root.style.setProperty("--primary", primaryHsl);
  root.style.setProperty("--accent", primaryHsl);
  root.style.setProperty("--ring", primaryHsl);
  root.style.setProperty("--chart-1", primaryHsl);

  // Sidebar variables from menu color
  root.style.setProperty("--sidebar-primary", menuHsl);
  root.style.setProperty("--sidebar-accent", menuHsl);
  root.style.setProperty("--sidebar-ring", menuHsl);

  // Derive dark sidebar background and border from menu color
  root.style.setProperty("--sidebar-background", darkenHsl(menuHsl, 0.22));
  root.style.setProperty("--sidebar-border", darkenHsl(menuHsl, 0.35));
}

export function saveTheme(primaryHex, menuHex) {
  localStorage.setItem(
    "app_theme",
    JSON.stringify({ primary: primaryHex, menu: menuHex })
  );
}

export function loadTheme() {
  try {
    const saved = localStorage.getItem("app_theme");
    if (saved) {
      const { primary, menu } = JSON.parse(saved);
      applyTheme(primary, menu);
      return { primary, menu };
    }
  } catch {}
  return null;
}

export function resetTheme() {
  localStorage.removeItem("app_theme");
  const root = document.documentElement;
  [
    "--primary",
    "--accent",
    "--ring",
    "--chart-1",
    "--sidebar-primary",
    "--sidebar-accent",
    "--sidebar-ring",
    "--sidebar-background",
    "--sidebar-border",
  ].forEach((prop) => root.style.removeProperty(prop));
}