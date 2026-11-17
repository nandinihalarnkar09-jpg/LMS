/**
 * Product identity in one place. Screens read the product name, institution
 * and logo from here instead of hard-coding them, so a rebrand is a one-file
 * change (plus the colour tokens in index.css).
 */
export const BRAND = {
  /** Product name. */
  name: "LMS",
  /** Owning institution — shown beside the product name everywhere. */
  institution: "Dempo College",
  institutionFull: "Srinivassa Sinai Dempo College (Autonomous), Goa",
  /** The college crest (public/logo.png). */
  logo: "logo.png",
  positioning: "Coursework, quizzes and marks for Dempo College — built to keep working on campus WiFi.",
  clerk: {
    colorPrimary: "#28358F",
    colorBackground: "#FFFFFF",
    fontFamily: "'Mukta', ui-sans-serif, system-ui, sans-serif",
  },
  copy: {
    signInSubtitle: "Use the email address the college registered for you.",
    signUpSubtitle: "Use the email address your invitation was sent to.",
  },
} as const;
