// Persona 3D appearance — a small curated set of options for the chibi character
// builder shared with the main game (see character3d.js / Posted-Demo v16.html's
// makeChibi()), so a player-authored persona can look like an actual character
// instead of just a text description.
const HAIR_COLORS = ["#33291f", "#2b231b", "#3d2f20", "#6e5335", "#efd9a6", "#8a4b38"];
const TOP_COLORS = ["#f2c6be", "#8fa9cf", "#bfd4dc", "#c0a5d3", "#8aa871", "#de9484"];
const SKIRT_COLORS = ["#f6f1e6", "#f3b8c9", "#edbb55"];
const EXPRESSIONS = ["smile", "frown"];

const DEFAULT_APPEARANCE = {
  hair: "#33291f",
  top: "#f2c6be",
  skirt: null,
  hoodie: false,
  clip: false,
  expression: "smile"
};

function validateAppearance(appearance) {
  const errors = [];
  if (appearance == null) return errors;
  if (typeof appearance !== "object" || Array.isArray(appearance)) {
    return ["appearance must be an object"];
  }
  const { hair, top, skirt, hoodie, clip, expression } = appearance;
  if (hair !== undefined && !HAIR_COLORS.includes(hair)) errors.push(`appearance.hair must be one of: ${HAIR_COLORS.join(", ")}`);
  if (top !== undefined && !TOP_COLORS.includes(top)) errors.push(`appearance.top must be one of: ${TOP_COLORS.join(", ")}`);
  if (skirt !== undefined && skirt !== null && !SKIRT_COLORS.includes(skirt)) errors.push(`appearance.skirt must be null or one of: ${SKIRT_COLORS.join(", ")}`);
  if (hoodie !== undefined && typeof hoodie !== "boolean") errors.push("appearance.hoodie must be a boolean");
  if (clip !== undefined && typeof clip !== "boolean") errors.push("appearance.clip must be a boolean");
  if (expression !== undefined && !EXPRESSIONS.includes(expression)) errors.push(`appearance.expression must be one of: ${EXPRESSIONS.join(", ")}`);
  return errors;
}

module.exports = { HAIR_COLORS, TOP_COLORS, SKIRT_COLORS, EXPRESSIONS, DEFAULT_APPEARANCE, validateAppearance };
