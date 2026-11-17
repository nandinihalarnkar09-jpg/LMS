/**
 * Product identity in one place. Screens read the product name, institution
 * and logo from here instead of hard-coding them, so a rebrand is a one-file
 * change (plus the colour tokens in index.css).
 */
export const BRAND = {
  name: "Dempo Learn",
  institution: "Dempo",
  logo: "logo.png",
  clerk: {
    colorPrimary: "hsl(40 8% 18%)",
    colorBackground: "hsl(0 0% 100%)",
    fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
  },
  copy: {
    signInSubtitle: "Welcome back! Please sign in to continue",
    signUpSubtitle: "Join the fun — it's free",
  },
} as const;
