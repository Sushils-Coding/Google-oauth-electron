require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();
app.use(cors());

// Store the latest tokens so Electron can fetch it later
let latestRefreshToken = null;
let latestAccessToken = null;
let tokenCreatedAt = null;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// API: Generate OAuth URL
app.get("/auth-url", (req, res) => {
  const scopes = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://mail.google.com/",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });

  res.json({ url });
});

// app.get('/', async(req, res) => {
//     res.send("hello world!");
// })

// API: OAuth Callback (Google redirects here)
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    latestRefreshToken = tokens.refresh_token;
    tokenCreatedAt = new Date().toISOString();

    // Generating access token using refresh token
    const newAccessToken = await oauth2Client.getAccessToken();
    latestAccessToken = newAccessToken.token;

    console.log("Refresh Token:", latestRefreshToken);
    console.log("Access Token:", latestAccessToken);

    return res.send(`
      <h2>Login successful!</h2>
      <p>You can now close this window and return to the Electron app.</p>
    `);
  } catch (err) {
    console.error("Error exchanging code for token:", err);
    return res.status(500).send("Error during authentication");
  }
});

// API: Electron fetches refresh token from here

app.get("/get-latest-tokens", (req, res) => {
  res.json({
    refreshToken: latestRefreshToken,
    accessToken: latestAccessToken,
    idToken: oauth2Client.credentials.id_token,
    expiryDate: oauth2Client.credentials.expiry_date,
    createdAt: tokenCreatedAt,
  });
});

app.listen(8080, () => {
  console.log("Backend running on http://localhost:8080");
});
