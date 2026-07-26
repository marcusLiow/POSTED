const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing bearer token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

module.exports = { signToken, requireAuth };
