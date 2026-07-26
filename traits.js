// Trait taxonomy per multiplayer-persona-design.md §1 — fixed picklist, fixed counts per category.
const PERSONALITY = [
  "anxious", "guarded", "warm", "blunt", "avoidant", "protective", "quick-to-forgive",
  "slow-to-trust", "confrontational", "conflict-avoidant", "affectionate", "sarcastic",
  "earnest", "easily-hurt", "even-tempered", "dramatic", "reserved", "impulsive"
];
const VALUES = [
  "loyalty", "honesty", "humor", "ambition", "independence", "family", "fairness",
  "creativity", "stability", "adventure"
];
const INTERESTS = [
  "food", "gaming", "art", "sports", "music", "movies/tv", "fashion", "fitness",
  "reading", "travel", "tech", "nature"
];
const COUNTS = { personality: 3, values: 2, interests: 3 };
const CURRENT_TRAITS_VERSION = 1;

function validateTraits({ personality, values, interests, free_text }) {
  const errors = [];
  const checkList = (name, list, allowed, count) => {
    if (!Array.isArray(list) || list.length !== count) {
      errors.push(`${name} must be an array of exactly ${count} items`);
      return;
    }
    const bad = list.filter((t) => !allowed.includes(t));
    if (bad.length) errors.push(`${name} contains unknown trait(s): ${bad.join(", ")}`);
    if (new Set(list).size !== list.length) errors.push(`${name} contains duplicates`);
  };
  checkList("personality", personality, PERSONALITY, COUNTS.personality);
  checkList("values", values, VALUES, COUNTS.values);
  checkList("interests", interests, INTERESTS, COUNTS.interests);
  if (free_text != null && (typeof free_text !== "string" || free_text.length > 200)) {
    errors.push("free_text must be a string of 200 characters or fewer");
  }
  return errors;
}

module.exports = { PERSONALITY, VALUES, INTERESTS, COUNTS, CURRENT_TRAITS_VERSION, validateTraits };
